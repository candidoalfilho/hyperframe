#!/usr/bin/env node
/**
 * Publica uma versão no site: copia os binários (mac dmg + win exe) dos
 * diretórios de build do Tauri p/ site/downloads, gera os .sha256 e atualiza
 * as três páginas (landing PT, EN e /downloads) com asserts — falha ALTO se
 * qualquer âncora não bater, em vez de publicar silenciosamente errado.
 *
 * Uso:  node site/tools/publish.mjs 0.2.16 "Destaque da versão em uma frase."
 * Depois: git add -A && git commit && git push (o script não toca no git).
 */
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'

const [version, highlight] = process.argv.slice(2)
if (!version || !highlight) {
  console.error('uso: node site/tools/publish.mjs <versão> "<destaque>"')
  process.exit(1)
}

const MAC_SRC = `apps/desktop/src-tauri/target/release/bundle/dmg/HyperFrame_${version}_aarch64.dmg`
const WIN_SRC = `apps/desktop/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/HyperFrame_${version}_x64-setup.exe`
const MAC = `HyperFrame_${version}_aarch64.dmg`
const WIN = `HyperFrame_${version}_x64-setup.exe`

for (const f of [MAC_SRC, WIN_SRC]) {
  if (!existsSync(f)) {
    console.error(`binário não encontrado: ${f} — rode os builds antes.`)
    process.exit(1)
  }
}
copyFileSync(MAC_SRC, `site/downloads/${MAC}`)
copyFileSync(WIN_SRC, `site/downloads/${WIN}`)

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
const macSha = sha(`site/downloads/${MAC}`)
const winSha = sha(`site/downloads/${WIN}`)
writeFileSync(`site/downloads/${MAC}.sha256`, macSha + '\n')
writeFileSync(`site/downloads/${WIN}.sha256`, winSha + '\n')
const short = (h) => `${h.slice(0, 8)}…${h.slice(60)}`

const must = (cond, msg) => {
  if (!cond) {
    console.error(`ERRO: ${msg}`)
    process.exit(1)
  }
}

// versão atual publicada (lida da própria landing)
let pt = readFileSync('site/index.html', 'utf8')
const curMatch = pt.match(/downloads\/HyperFrame_([\d.]+)_aarch64\.dmg" download>Baixar/)
must(curMatch, 'não achei a versão atual na landing')
const old = curMatch[1]
must(old !== version, `versão ${version} já publicada`)

const today = new Date().toLocaleDateString('pt-BR')
const replaceCount = (s, from, to, n, ctx) => {
  const c = s.split(from).length - 1
  must(c === n, `${ctx}: esperado ${n}× ${JSON.stringify(from).slice(0, 70)}, achei ${c}`)
  return s.split(from).join(to)
}

// ---- landing PT ----
pt = replaceCount(pt, `v${old} · NBR 6118:2023`, `v${version} · NBR 6118:2023`, 1, 'PT frame-tag')
pt = replaceCount(pt, `>v${old}</div>`, `>v${version}</div>`, 2, 'PT cards versão')
pt = replaceCount(pt, `downloads/HyperFrame_${old}_aarch64.dmg" download>Baixar para macOS`,
  `downloads/HyperFrame_${version}_aarch64.dmg" download>Baixar para macOS`, 1, 'PT link mac')
pt = replaceCount(pt, `downloads/HyperFrame_${old}_x64-setup.exe" download>Baixar para Windows`,
  `downloads/HyperFrame_${version}_x64-setup.exe" download>Baixar para Windows`, 1, 'PT link win')
{
  const shas = pt.match(/sha256 [0-9a-f]{8}…[0-9a-f]{4}/g) ?? []
  must(shas.length === 2, `PT: esperava 2 shas curtos, achei ${shas.length}`)
  pt = pt.replace(shas[0], `sha256 ${short(macSha)}`).replace(shas[1], `sha256 ${short(winSha)}`)
}
pt = pt.replace(/Anterior: <a href="downloads\/HyperFrame_[\d.]+_aarch64\.dmg" download>v[\d.]+ ↓<\/a>/,
  `Anterior: <a href="downloads/HyperFrame_${old}_aarch64.dmg" download>v${old} ↓</a>`)
writeFileSync('site/index.html', pt)

// ---- landing EN ----
let en = readFileSync('site/en/index.html', 'utf8')
en = replaceCount(en, `v${old} · NBR 6118:2023`, `v${version} · NBR 6118:2023`, 1, 'EN frame-tag')
en = replaceCount(en, `<li>v${old} · .dmg`, `<li>v${version} · .dmg`, 1, 'EN mac li')
en = replaceCount(en, `<li>v${old} · .exe`, `<li>v${version} · .exe`, 1, 'EN win li')
en = replaceCount(en, `../downloads/HyperFrame_${old}_aarch64.dmg" download>Download for macOS`,
  `../downloads/HyperFrame_${version}_aarch64.dmg" download>Download for macOS`, 1, 'EN link mac')
en = replaceCount(en, `../downloads/HyperFrame_${old}_x64-setup.exe" download>Download for Windows`,
  `../downloads/HyperFrame_${version}_x64-setup.exe" download>Download for Windows`, 1, 'EN link win')
{
  const shas = en.match(/sha256 [0-9a-f]{8}…[0-9a-f]{4}/g) ?? []
  must(shas.length === 2, `EN: esperava 2 shas curtos, achei ${shas.length}`)
  en = en.replace(shas[0], `sha256 ${short(macSha)}`).replace(shas[1], `sha256 ${short(winSha)}`)
}
en = en.replace(/Previous: <a href="\.\.\/downloads\/HyperFrame_[\d.]+_aarch64\.dmg" download>v[\d.]+ ↓<\/a>/,
  `Previous: <a href="../downloads/HyperFrame_${old}_aarch64.dmg" download>v${old} ↓</a>`)
writeFileSync('site/en/index.html', en)

// ---- página /downloads ----
let dl = readFileSync('site/downloads/index.html', 'utf8')
const oldHead = `<h2>v${old} <span class="badge">atual</span></h2>`
must(dl.includes(oldHead), 'downloads: entrada atual não encontrada')
dl = dl.replace(oldHead, `<h2>v${old}</h2>`)
const anchor = `  <div class="ver">\n    <h2>v${old}</h2>`
must(dl.includes(anchor), 'downloads: âncora de inserção não encontrada')
const entry = `  <div class="ver">
    <h2>v${version} <span class="badge">atual</span></h2>
    <p class="meta">${today} · licença MIT</p>
    <p class="hl">${highlight}</p>
    <div class="row">
      <a class="btn" href="${MAC}" download>macOS (Apple Silicon) ↓</a>
      <span class="sha">${macSha}</span>
    </div>
    <div class="row">
      <a class="btn" href="${WIN}" download>Windows 10/11 (x64) ↓</a>
      <span class="sha">${winSha}</span>
    </div>
  </div>

`
dl = dl.replace(anchor, entry + anchor)
writeFileSync('site/downloads/index.html', dl)

console.log(`publicado v${version} (anterior v${old})`)
console.log(`  mac ${short(macSha)}  win ${short(winSha)}`)
console.log('agora: git add -A && git commit && git push')
