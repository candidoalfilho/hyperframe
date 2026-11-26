import { describe, expect, it } from 'vitest'
import { createSampleProject } from '../src/model/factory'
import { analyze } from '../src/analyze'
import { buildMemorialPdf } from '../src/report/memorial'
import {
  beamEffectiveDepth,
  beamRuns,
  columnRun,
  envelopeAlong,
  flexureAs,
  governingCombo,
} from '../src/report/memorialDetail'
import { Layout } from '../src/report/layout'
import { beamKey, computeLoadPath } from '../src/analysis/loadPath'
import { coverFor, fyd as fydOf } from '../src/nbr/nbr6118/materials'
import type { CaseId } from '../src/analysis/types'

/** issue #11 — memorial resumido/detalhado, com diagramas por elemento */

const project = createSampleProject()
const results = analyze(project)
const base = { generatedAt: '26/11/2026 18:30', appVersion: '0.2.61' }

/** bytes 0x80–0x9F do CP1252 usados nos textos */
const CP1252: Record<number, string> = { 0x85: '…', 0x95: '•', 0x96: '–', 0x97: '—' }

/** textos escritos no PDF, na ordem (desfaz os escapes \ooo, \( e \)) */
const textsOf = (pdf: Uint8Array): string[] => {
  const raw = new TextDecoder('latin1').decode(pdf)
  const out: string[] = []
  for (const m of raw.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)) {
    out.push(
      m[1]
        .replace(/\\(\d{3})/g, (_, o: string) => {
          const b = parseInt(o, 8)
          return CP1252[b] ?? String.fromCharCode(b)
        })
        .replace(/\\([()\\])/g, '$1'),
    )
  }
  return out
}
const pagesOf = (pdf: Uint8Array) =>
  (new TextDecoder('latin1').decode(pdf).match(/\/Type \/Page /g) ?? []).length

const resumido = buildMemorialPdf(project, results, base)
const detalhado = buildMemorialPdf(project, results, { ...base, detail: 'detalhado' })
const tR = textsOf(resumido)
const tD = textsOf(detalhado)

describe('nível de detalhe', () => {
  it('resumido é o padrão e não muda: sem anexo', () => {
    expect(textsOf(buildMemorialPdf(project, results, { ...base, detail: 'resumido' }))).toEqual(tR)
    expect(tR.some((t) => t.startsWith('resumido'))).toBe(true)
    expect(tR.some((t) => t.includes('Anexo A'))).toBe(false)
  })

  it('detalhado = o resumido inteiro + o Anexo A com as cinco partes', () => {
    expect(pagesOf(detalhado)).toBeGreaterThan(pagesOf(resumido) + 10)
    for (const title of [
      'Anexo A — Memória detalhada por elemento',
      'A.1 Vigas',
      'A.2 Pilares',
      'A.3 Lajes',
      'A.4 Fundações',
      'A.5 Deslocamentos horizontais da estrutura',
    ])
      expect(tD).toContain(title)
    // as seções do resumido continuam lá, antes do anexo
    const iAnexo = tD.indexOf('Anexo A — Memória detalhada por elemento')
    const iAvisos = tD.indexOf('15. Avisos da análise e premissas')
    expect(iAvisos).toBeGreaterThan(0)
    expect(iAvisos).toBeLessThan(iAnexo)
  })

  it('todo caractere do anexo existe na fonte do PDF (nenhum "?" no lugar de símbolo)', () => {
    const annex = tD.slice(tD.indexOf('Anexo A — Memória detalhada por elemento'))
    expect(annex.filter((t) => t.includes('?'))).toEqual([])
  })
})

describe('escolha do conteúdo', () => {
  it('só as seções pedidas', () => {
    const t = textsOf(buildMemorialPdf(project, results, { ...base, detail: 'detalhado', sections: ['vigas'] }))
    expect(t).toContain('A.1 Vigas')
    for (const x of ['A.2 Pilares', 'A.3 Lajes', 'A.4 Fundações', 'A.5 Deslocamentos horizontais da estrutura'])
      expect(t).not.toContain(x)
  })

  it('só os diagramas pedidos; nenhum = sem gráficos', () => {
    const plots = (t: string[]) => t.filter((x) => x.includes('envoltória ELU ('))
    const all = plots(tD)
    expect(all.some((x) => x.includes('momento fletor'))).toBe(true)
    expect(all.some((x) => x.includes('força cortante'))).toBe(true)
    expect(all.some((x) => x.includes('força normal de compressão'))).toBe(true)
    const onlyM = plots(textsOf(buildMemorialPdf(project, results, { ...base, detail: 'detalhado', diagrams: ['M'] })))
    expect(onlyM.length).toBeGreaterThan(0)
    expect(onlyM.every((x) => x.includes('momento'))).toBe(true)
    const none = textsOf(buildMemorialPdf(project, results, { ...base, detail: 'detalhado', diagrams: [], sections: ['vigas', 'pilares'] }))
    expect(plots(none)).toEqual([])
    expect(none.some((x) => x.startsWith('Escalas:'))).toBe(false)
  })

  it('só os elementos pedidos', () => {
    const beam = project.plans[0].beams[0]
    const col = project.columns[2]
    const t = textsOf(
      buildMemorialPdf(project, results, {
        ...base,
        detail: 'detalhado',
        only: { beams: [beam.id], columns: [col.id], slabs: [] },
      }),
    )
    const beamTitles = t.filter((x) => / cm — .* — L = /.test(x))
    expect(beamTitles).toHaveLength(1)
    expect(beamTitles[0].startsWith(`${beam.name} — `)).toBe(true)
    expect(t.filter((x) => x.startsWith('Fundação de '))).toEqual([expect.stringContaining(`Fundação de ${col.name} — `)])
    expect(t).not.toContain('A.3 Lajes')
  })
})

describe('diagramas: a envoltória e a combinação crítica', () => {
  const runs = beamRuns(results)

  it('cada viga é lida no 1º pavimento que usa a planta, com as barras em sequência', () => {
    const beam = project.plans[0].beams[0]
    const run = runs.get(beam.id)!
    expect(run.levelIndex).toBe(1)
    const len = Math.hypot(
      beam.path[beam.path.length - 1].x - beam.path[0].x,
      beam.path[beam.path.length - 1].y - beam.path[0].y,
    )
    expect(run.total).toBeCloseTo(len, 6)
    expect(run.offsets[0]).toBe(0)
    for (let i = 1; i < run.offsets.length; i++) expect(run.offsets[i]).toBeGreaterThan(run.offsets[i - 1])
  })

  it('extremos da série = extremos da envoltória das barras; x vai de 0 ao comprimento', () => {
    for (const [, run] of runs) {
      const env = envelopeAlong(results, run, 'Mz')
      expect(env.x[0]).toBe(0)
      expect(env.x[env.x.length - 1]).toBeCloseTo(run.total, 9)
      const hi = Math.max(...run.memberIds.flatMap((mi) => results.envelopeELU.Mz[mi].max))
      const lo = Math.min(...run.memberIds.flatMap((mi) => results.envelopeELU.Mz[mi].min))
      expect(env.at.max.v).toBeCloseTo(hi, 9)
      expect(env.at.min.v).toBeCloseTo(lo, 9)
      // o maior positivo é o Md que dimensiona algum vão da viga
      break
    }
  })

  it('a combinação apontada reproduz o valor extremo', () => {
    const run = runs.get(project.plans[0].beams[0].id)!
    for (const field of ['Mz', 'Vy'] as const) {
      const env = envelopeAlong(results, run, field)
      for (const pick of [env.at.max, env.at.min]) {
        const label = governingCombo(results, pick.mi, pick.s, field, pick.v)
        const combo = results.combos.find((c) => c.label === label)!
        expect(combo.type).toBe('ELU')
        let v = 0
        for (const [caseId, factor] of Object.entries(combo.factors)) {
          const cr = results.cases.elu[caseId as CaseId]
          if (cr) v += factor * cr.memberDiagrams[pick.mi][field][pick.s]
        }
        expect(v).toBeCloseTo(pick.v, 9)
      }
    }
  })

  it('pilar: normal de compressão positiva, crescente para a base', () => {
    const run = columnRun(results, project.columns[0].id)!
    const levels = project.levels.length
    expect(run.memberIds).toHaveLength(levels - 1)
    const env = envelopeAlong(results, run, 'N', -1)
    expect(env.at.max.v).toBeGreaterThan(0)
    // o máximo está no tramo de baixo (x pequeno)
    const first = results.model.members[run.memberIds[0]]
    expect(env.at.max.mi).toBe(first.id)
    expect(env.max[0]).toBeGreaterThan(env.max[env.max.length - 1])
  })

  it('gráfico: curva, faixa preenchida, marcas dos apoios e escalas na legenda', () => {
    const L = new Layout()
    const before = L.y
    L.plot({
      title: 'teste',
      unit: 'kN·m',
      x: [0, 2, 4],
      max: [0, 10, 0],
      min: [-5, 2, -5],
      invert: true,
      marks: [
        { x: 0, label: 'P1' },
        { x: 4, label: 'P2' },
      ],
      note: 'nota',
    })
    expect(L.y).toBeLessThan(before - 100)
    const raw = new TextDecoder('latin1').decode(L.doc.build())
    expect(raw).toMatch(/ h f\n/) // faixa preenchida
    expect(raw).toMatch(/\[2 2\] 0 d/) // tracejado dos apoios
    const t = textsOf(L.doc.build())
    expect(t).toEqual(expect.arrayContaining(['teste', 'P1', 'P2', '10,0', '-5,0']))
    const legend = t.find((x) => x.startsWith('Escalas:'))!
    // 4 m em (largura útil − 38 pt): 1 cm = 4 / ((491,28 − 38) / 28,3465) m
    expect(legend).toContain(`1 cm = ${(4 / ((595.28 - 104 - 38) / 28.3465)).toFixed(2).replace('.', ',')} m`)
    expect(legend).toContain('positivo para baixo')
  })
})

describe('as contas escritas são as do dimensionamento', () => {
  const cover = coverFor(project.settings.caa).beam
  const fyd = fydOf(project.settings.steel)

  it('As = Md / (fyd·z) reproduz a armadura calculada de cada apoio (seção retangular)', () => {
    let checked = 0
    for (const sp of results.beamDesign) {
      const d = beamEffectiveDepth(sp.section.h, cover)
      for (const f of [sp.negLeft, sp.negRight]) {
        if (!f || f.md < 0.1 || f.flange) continue
        const as = flexureAs(f.md, f.xd, d, fyd)
        // a armadura final do dimensionamento é o maior entre a calculada e a mínima
        expect(Math.max(as, f.asMin)).toBeCloseTo(f.as, 9)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(10)
  })

  it('tabela de cargas da viga fecha com as reações (mesmos números do caminho das cargas)', () => {
    const beam = project.plans[0].beams[0]
    const lp = computeLoadPath(project, results, { label: 'G+Q', factors: { G: 1, Q: 1 }, stiffness: 'els' })
    const e = lp.elements.find((x) => x.key === beamKey(1, beam.id))!
    const total = (e.own + e.received).toFixed(1).replace('.', ',')
    const i = tD.findIndex((x) => x.startsWith(`${beam.name} — `) && x.includes('— L = '))
    const block = tD.slice(i, i + 80)
    const iTot = block.indexOf('Total sobre a viga')
    const iSum = block.indexOf('Soma das reações')
    expect(iTot).toBeGreaterThan(0)
    expect(iSum).toBeGreaterThan(iTot)
    // última coluna (G + Q) das duas linhas
    // (a linha do total tem a coluna "Tipo" vazia)
    expect(block[iTot + 4]).toBe(total)
    expect(block[iSum + 3]).toBe(total)
  })

  it('descida de cargas do pilar termina na reação da planta de cargas', () => {
    const col = [...project.columns].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }))[0]
    const fz = results.foundationLoads.find((f) => f.columnId === col.id)!.fzServ
    const i = tD.indexOf('A.2 Pilares')
    const block = tD.slice(i, i + 120)
    const k = block.indexOf('Reação na fundação')
    // quatro colunas vazias antes do valor
    expect(block[k + 5]).toBe(fz.toFixed(1).replace('.', ','))
  })
})
