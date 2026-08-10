// Captura screenshots do HyperFrame (dev server em :5183) p/ o site — v2.
// Cenas novas (alvenaria, fundações 3D, unifilar) + recaptura das 5 antigas.
// Uso: node shots2.mjs [caminho/do/autosave-demo.json]
//   O JSON (payload de autosave: {when,fileName,projectName,data}) é injetado
//   no localStorage antes do load; o app abre com "Recuperar trabalho não salvo".
import { chromium } from 'playwright-core'
import { mkdirSync, readFileSync } from 'node:fs'

const OUT = new URL('./out/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const AUTOSAVE_KEY = 'hyperframe.autosave.v1'
const autosavePath = process.argv[2]
const autosaveJson = autosavePath ? readFileSync(autosavePath, 'utf8') : null

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--hide-scrollbars'],
})
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,
})

if (autosaveJson) {
  await page.addInitScript(
    ([key, value]) => {
      try {
        localStorage.setItem(key, value)
      } catch {}
    },
    [AUTOSAVE_KEY, autosaveJson],
  )
}

const shot = async (name) => {
  await sleep(500)
  await page.screenshot({ path: `${OUT}${name}.png` })
  console.log('✓', name)
}

try {
  await page.goto('http://localhost:5183', { waitUntil: 'networkidle', timeout: 30000 })

  // 1) carrega o projeto-demo injetado via módulos do próprio app (dev server).
  //    loadProject + select no MESMO tick: o overview do inspetor com paredes de
  //    alvenaria tem um selector instável (MasonryWallRow) que derruba o React —
  //    manter uma seleção ativa evita que esse painel monte.
  if (autosaveJson) {
    await page.waitForSelector('.modal-overlay', { timeout: 10000 }).catch(() => {})
    await page.evaluate(async () => {
      const { readAutosave } = await import('/src/io/fileio.ts')
      const { useStore } = await import('/src/store/index.ts')
      const r = readAutosave()
      if (!r) throw new Error('autosave não encontrado')
      const st = useStore.getState()
      st.loadProject(r.project, null)
      const col = r.project.columns[0]
      useStore.getState().select({ kind: 'column', id: col.id })
    })
  } else {
    const sample = page.getByText('Abrir projeto de exemplo', { exact: false }).first()
    if (await sample.isVisible({ timeout: 5000 }).catch(() => false)) await sample.click()
  }
  await page
    .locator('.modal-overlay')
    .waitFor({ state: 'detached', timeout: 10000 })
    .catch(() => {})
  await sleep(2500) // editor 2D + 3D montam (three.js compila shaders)

  // vista dividida (padrão) = modelagem, com paredes de alvenaria roxas na planta
  await shot('screenshot-modeling')

  // 2) analisar e esperar os resultados
  await page.locator('button', { hasText: 'Analisar' }).first().click()
  await page.locator('button', { hasText: 'Resultados' }).first().waitFor({ timeout: 120000 })
  await sleep(800)

  // painel de resultados (abre sozinho ao fim da análise; garante aberto)
  const tabEst = page.locator('button.tab', { hasText: 'Estabilidade' })
  if (!(await tabEst.isVisible().catch(() => false))) {
    await page.locator('button', { hasText: 'Resultados' }).first().click()
    await sleep(600)
  }

  // 3) estabilidade global
  await tabEst.click()
  await shot('screenshot-results')

  // 4) pilares dimensionados
  await page.locator('button.tab', { hasText: 'Pilares' }).click()
  await shot('screenshot-pilares')

  // 5) alvenaria estrutural — aba de resultados (planta com paredes roxas atrás)
  const tabAlv = page.locator('button.tab', { hasText: 'Alvenaria' })
  if (await tabAlv.isVisible().catch(() => false)) {
    await tabAlv.click()
    await sleep(600)
    await shot('screenshot-alvenaria')
  } else {
    console.warn('aba Alvenaria não encontrada — cena pulada')
  }

  // 6) prancha de viga com quadro de ferros + editor de armaduras
  await page.locator('button.tab', { hasText: 'Pranchas' }).click()
  await sleep(400)
  const tipoSel = page.locator('select', { has: page.locator('option[value="forma"]') })
  await tipoSel.first().selectOption('vigas')
  await sleep(600)
  const editor = page.locator('text=Editor de armaduras')
  if ((await editor.count()) > 0) await editor.first().click()
  await sleep(600)
  await shot('screenshot-prancha')

  // 7) prancha "Alvenaria — elevação" (blocos fiada a fiada)
  const alvOpt = page.locator('option[value="alv-elev"]')
  if ((await alvOpt.count()) > 0 && !(await alvOpt.first().isDisabled().catch(() => true))) {
    await tipoSel.first().selectOption('alv-elev')
    await sleep(1200)
    await shot('screenshot-alvenaria-elevacao')
  } else {
    console.warn('prancha alv-elev indisponível — cena pulada')
  }

  // fecha o painel de resultados p/ liberar o 3D
  await page.locator('button', { hasText: 'Resultados' }).first().click()
  await sleep(400)

  // 8) 3D em tela cheia
  await page.locator('[title="3D"]').click()
  await sleep(1500)

  // checkboxes do painel "Exibição" — setChecked p/ não depender do estado inicial
  const check = (labelText) =>
    page.locator('label', { hasText: labelText }).first().locator('input[type="checkbox"]')

  // deformada + 1ª combinação ELU
  await check('Deformada').setChecked(true)
  const comboSel = page.locator('select', {
    has: page.locator('option', { hasText: '— selecione —' }),
  })
  if ((await comboSel.count()) > 0) {
    const val = await comboSel
      .first()
      .locator('optgroup >> option')
      .first()
      .getAttribute('value')
    if (val) await comboSel.first().selectOption(val)
  }
  await sleep(1800)
  await shot('screenshot-deformed')
  await check('Deformada').setChecked(false)

  // 9) fundações (sapatas troncopiramidais)
  if ((await check('Fundações').count()) > 0) {
    await check('Fundações').setChecked(true)
    await sleep(1500)
    await shot('screenshot-3d-fundacoes')
  } else {
    console.warn('checkbox Fundações não encontrado — cena pulada')
  }

  // 10) modo unifilar + diagrama Mz (combinação já selecionada)
  if ((await check('Modo unifilar').count()) > 0) {
    await check('Modo unifilar').setChecked(true)
    const diagSel = page.locator('select', { has: page.locator('option[value="Mz"]') })
    if ((await diagSel.count()) > 0) await diagSel.first().selectOption('Mz')
    await sleep(1800)
    await shot('screenshot-unifilar')
  } else {
    console.warn('checkbox Modo unifilar não encontrado — cena pulada')
  }
} catch (err) {
  console.error('ERRO:', err.message)
  await page.screenshot({ path: `${OUT}_debug.png` })
  const body = await page.locator('body').innerText().catch(() => '?')
  console.error('BODY (1º kB):', body.slice(0, 1000))
  process.exitCode = 1
} finally {
  await browser.close()
}
