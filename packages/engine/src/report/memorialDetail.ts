/**
 * Memorial DETALHADO (issue #11) — anexo com a memória de cada elemento: de
 * onde vêm as cargas, as reações, os diagramas de esforços (envoltória ELU,
 * com escala, unidade e a combinação crítica) e o desenvolvimento das contas
 * com os valores substituídos. Os números são os mesmos do dimensionamento:
 * este módulo só os apresenta (não recalcula armaduras).
 */

import type { Project } from '../model/types'
import type { AnalysisResults, BeamSpanDesign, CaseId, FlexureDesign } from '../analysis/types'
import { beamKey, computeLoadPath, slabKey, type LoadPath } from '../analysis/loadPath'
import { slabExtraLoads, slabOpeningsArea } from '../analysis/buildModel'
import { slabSelfWeight } from '../analysis/slabWeight'
import { polygonArea } from '../geometry/geometry'
import { concreteProps, coverFor, fyd as fydOf } from '../nbr/nbr6118/materials'
import { cm2, cmDim, fmt, mm, type Layout } from './layout'

export type MemorialDetailSection = 'vigas' | 'pilares' | 'lajes' | 'fundacoes' | 'global'
export type MemorialDiagram = 'M' | 'V' | 'N' | 'T'

export const MEMORIAL_SECTIONS: MemorialDetailSection[] = ['vigas', 'pilares', 'lajes', 'fundacoes', 'global']
export const MEMORIAL_DIAGRAMS: MemorialDiagram[] = ['M', 'V', 'N', 'T']

export interface MemorialDetailOptions {
  /** grupos de elementos do anexo (padrão: todos) */
  sections?: MemorialDetailSection[]
  /** diagramas junto de cada viga e pilar (padrão: todos; [] = nenhum) */
  diagrams?: MemorialDiagram[]
  /** restringe a memória a estes elementos (ids de modelagem); ausente = todos */
  only?: { beams?: string[]; columns?: string[]; slabs?: string[] }
}

const byName = <T extends { name: string }>(list: T[]): T[] =>
  [...list].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }))

const FIXITY = ['apoiada nos dois lados', 'engastada de um lado', 'engastada dos dois lados']

/** trecho contínuo de barras do pórtico que forma uma viga (num pavimento) ou um pilar */
export interface ElementRun {
  memberIds: number[]
  /** posição do início de cada barra ao longo do elemento, m */
  offsets: number[]
  total: number
  levelIndex: number
}

/**
 * Barras de cada viga no pavimento em que ela é dimensionada: o 1º nível que
 * usa a planta (mesma regra do dimensionamento).
 */
export function beamRuns(results: AnalysisResults): Map<string, ElementRun> {
  const { model } = results
  const out = new Map<string, ElementRun>()
  model.members.forEach((m, mi) => {
    if (m.ref.kind !== 'beam') return
    const li = model.nodes[m.ni].levelIndex
    let run = out.get(m.ref.sourceId)
    if (!run) {
      run = { memberIds: [], offsets: [], total: 0, levelIndex: li }
      out.set(m.ref.sourceId, run)
    }
    if (run.levelIndex !== li) return
    run.memberIds.push(mi)
    run.offsets.push(run.total)
    run.total += m.length
  })
  return out
}

/** barras de um pilar, da base ao topo */
export function columnRun(results: AnalysisResults, columnId: string): ElementRun | null {
  const { model } = results
  const ids = model.members
    .map((m, mi) => ({ m, mi }))
    .filter((x) => x.m.ref.kind === 'column' && x.m.ref.sourceId === columnId)
    .sort((a, b) => model.nodes[a.m.ni].z - model.nodes[b.m.ni].z)
  if (ids.length === 0) return null
  const run: ElementRun = { memberIds: [], offsets: [], total: 0, levelIndex: 0 }
  for (const { m, mi } of ids) {
    run.memberIds.push(mi)
    run.offsets.push(run.total)
    run.total += m.length
  }
  return run
}

export interface EnvelopeSeries {
  x: number[]
  min: number[]
  max: number[]
  /** onde ocorrem os extremos: barra e estação */
  at: { max: { mi: number; s: number; v: number }; min: { mi: number; s: number; v: number } }
}

/** envoltória ELU de um esforço ao longo do elemento (`sign` = −1 inverte o sinal) */
export function envelopeAlong(
  results: AnalysisResults,
  run: ElementRun,
  field: 'N' | 'Vy' | 'Vz' | 'My' | 'Mz' | 'T',
  sign: 1 | -1 = 1,
): EnvelopeSeries {
  const x: number[] = []
  const min: number[] = []
  const max: number[] = []
  const at = { max: { mi: -1, s: 0, v: -Infinity }, min: { mi: -1, s: 0, v: Infinity } }
  run.memberIds.forEach((mi, i) => {
    const e = results.envelopeELU[field][mi]
    const len = results.model.members[mi].length
    const n = e.max.length
    for (let s = 0; s < n; s++) {
      const hi = sign === 1 ? e.max[s] : -e.min[s]
      const lo = sign === 1 ? e.min[s] : -e.max[s]
      x.push(run.offsets[i] + (n > 1 ? (len * s) / (n - 1) : 0))
      max.push(hi)
      min.push(lo)
      if (hi > at.max.v) at.max = { mi, s, v: hi }
      if (lo < at.min.v) at.min = { mi, s, v: lo }
    }
  })
  return { x, min, max, at }
}

/** combinação ELU que produz o valor `target` na barra/estação indicada */
export function governingCombo(
  results: AnalysisResults,
  mi: number,
  s: number,
  field: 'N' | 'Vy' | 'Vz' | 'My' | 'Mz' | 'T',
  target: number,
  sign: 1 | -1 = 1,
): string {
  let best = ''
  let bestD = Infinity
  for (const combo of results.combos) {
    if (combo.type !== 'ELU') continue
    let v = 0
    for (const [caseId, factor] of Object.entries(combo.factors)) {
      const cr = results.cases.elu[caseId as CaseId]
      if (cr) v += factor * cr.memberDiagrams[mi][field][s]
    }
    const d = Math.abs(sign * v - target)
    if (d < bestD) {
      bestD = d
      best = combo.label
    }
  }
  return best
}

export function appendDetailedMemorial(
  L: Layout,
  project: Project,
  results: AnalysisResults,
  opts: MemorialDetailOptions = {},
): void {
  const sections = new Set(opts.sections ?? MEMORIAL_SECTIONS)
  const diagrams = new Set(opts.diagrams ?? MEMORIAL_DIAGRAMS)
  const st = project.settings
  const cp = concreteProps(st.concrete.fck, st.concrete.aggregate, st.concrete.gammaC)
  const fydV = fydOf(st.steel)
  const cover = coverFor(st.caa)
  const { model } = results
  const levels = [...project.levels].sort((a, b) => a.elevation - b.elevation)
  const levelName = (i: number) => levels[i]?.name ?? `nível ${i}`
  const want = (list: string[] | undefined, id: string) => !list || list.includes(id)

  // caminho das cargas: G e Q característicos separados, e a soma
  const lpG = computeLoadPath(project, results, { label: 'G', factors: { G: 1 }, stiffness: 'els' })
  const lpQ = computeLoadPath(project, results, { label: 'Q', factors: { Q: 1 }, stiffness: 'els' })
  const lpGQ = computeLoadPath(project, results, {
    label: 'G + Q',
    factors: { G: 1, Q: 1 },
    stiffness: 'els',
  })
  const nameOf = (lp: LoadPath, key: string): string => {
    const e = lp.elements.find((x) => x.key === key)
    if (!e) return '—'
    return e.kind === 'slab'
      ? `Laje ${e.name}`
      : e.kind === 'beam'
        ? `Viga ${e.name}`
        : e.kind === 'column'
          ? `Pilar ${e.name}`
          : e.name
  }
  /** soma, por elemento vizinho, do que entra (dir 'in') ou sai de `key` */
  const exchange = (lp: LoadPath, key: string, dir: 'in' | 'out'): Map<string, number> => {
    const out = new Map<string, number>()
    for (const f of lp.flows) {
      const other = dir === 'in' ? (f.to === key ? f.from : null) : f.from === key ? f.to : null
      if (other) out.set(other, (out.get(other) ?? 0) + f.value)
    }
    return out
  }

  L.newPage()
  L.h1('Anexo A — Memória detalhada por elemento')
  L.para(
    'Para cada elemento: origem das cargas e reações (valores característicos, G e Q), ' +
      'diagramas da envoltória das combinações ELU com a combinação que produz cada extremo, e ' +
      'o desenvolvimento do dimensionamento com os valores substituídos. Os números são os ' +
      'mesmos das tabelas-resumo.',
    7.8,
    'I',
    0.3,
  )
  L.kv(
    [
      ['Concreto', `fck = ${fmt(cp.fck / 1000, 0)} MPa · fcd = ${fmt(cp.fcd / 1000, 2)} MPa · fctd = ${fmt(cp.fctd / 1000, 3)} MPa`],
      ['Aço', `fyk = ${fmt(st.steel.fyk / 1000, 0)} MPa · fyd = ${fmt(fydV / 1000, 1)} MPa`],
      ['Cobrimentos (CAA ' + st.caa + ')', `viga ${cmDim(cover.beam)} cm · pilar ${cmDim(cover.column)} cm · laje ${cmDim(cover.slab)} cm`],
    ],
    150,
  )

  // =================================================================== vigas
  if (sections.has('vigas')) {
    const runs = beamRuns(results)
    const items = project.plans.flatMap((pl) =>
      byName(pl.beams)
        .filter((b) => runs.has(b.id) && want(opts.only?.beams, b.id))
        .map((b) => ({ plan: pl, beam: b, run: runs.get(b.id)! })),
    )
    if (items.length > 0) L.h1('A.1 Vigas')
    for (const { plan, beam, run } of items) {
      const li = run.levelIndex
      const key = beamKey(li, beam.id)
      L.ensure(170) // título + a tabela de cargas começam na mesma página
      L.h2(
        `${beam.name} — ${cmDim(beam.section.bw)}×${cmDim(beam.section.h)} cm — ${plan.name} (${levelName(li)}) — L = ${fmt(run.total, 2)} m`,
      )

      // ---- cargas e origem
      const eG = lpG.elements.find((e) => e.key === key)
      const eQ = lpQ.elements.find((e) => e.key === key)
      const rowsLoad: string[][] = []
      const labels = new Set([...(eG?.parts ?? []), ...(eQ?.parts ?? [])].map((p) => p.label))
      let sumG = 0
      let sumQ = 0
      for (const label of labels) {
        const g = eG?.parts.find((p) => p.label === label)?.value ?? 0
        const q = eQ?.parts.find((p) => p.label === label)?.value ?? 0
        sumG += g
        sumQ += q
        rowsLoad.push([label, 'aplicada na viga', fmt(g, 1), fmt(q, 1), fmt(g + q, 1)])
      }
      const inG = exchange(lpG, key, 'in')
      const inQ = exchange(lpQ, key, 'in')
      for (const other of new Set([...inG.keys(), ...inQ.keys()])) {
        const g = inG.get(other) ?? 0
        const q = inQ.get(other) ?? 0
        sumG += g
        sumQ += q
        const kind = (lpG.elements.find((e) => e.key === other) ?? lpQ.elements.find((e) => e.key === other))?.kind
        rowsLoad.push([
          nameOf(lpG, other) !== '—' ? nameOf(lpG, other) : nameOf(lpQ, other),
          kind === 'slab' ? 'quinhão da laje' : kind === 'beam' ? 'viga apoiada nesta' : 'pilar que nasce na viga',
          fmt(g, 1),
          fmt(q, 1),
          fmt(g + q, 1),
        ])
      }
      rowsLoad.push(['Total sobre a viga', '', fmt(sumG, 1), fmt(sumQ, 1), fmt(sumG + sumQ, 1)])
      L.para('Cargas características e origem (resultante sobre a viga inteira):', 8, 'B', 0.2)
      L.table(
        [
          { t: 'Origem', w: 30 },
          { t: 'Tipo', w: 30 },
          { t: 'G (kN)', w: 13, align: 'r' },
          { t: 'Q (kN)', w: 13, align: 'r' },
          { t: 'G + Q (kN)', w: 14, align: 'r' },
        ],
        rowsLoad,
        7.2,
      )

      // ---- reações
      const outG = exchange(lpG, key, 'out')
      const outQ = exchange(lpQ, key, 'out')
      const rowsR: string[][] = []
      let rG = 0
      let rQ = 0
      for (const other of new Set([...outG.keys(), ...outQ.keys()])) {
        const g = outG.get(other) ?? 0
        const q = outQ.get(other) ?? 0
        rG += g
        rQ += q
        rowsR.push([nameOf(lpGQ, other), fmt(g, 1), fmt(q, 1), fmt(g + q, 1)])
      }
      rowsR.sort((a, b) => a[0].localeCompare(b[0], 'pt-BR', { numeric: true }))
      rowsR.push(['Soma das reações', fmt(rG, 1), fmt(rQ, 1), fmt(rG + rQ, 1)])
      L.para('Reações nos apoios (características):', 8, 'B', 0.2)
      L.table(
        [
          { t: 'Apoio', w: 40 },
          { t: 'G (kN)', w: 20, align: 'r' },
          { t: 'Q (kN)', w: 20, align: 'r' },
          { t: 'G + Q (kN)', w: 20, align: 'r' },
        ],
        rowsR,
        7.2,
      )

      // ---- diagramas (envoltória ELU)
      const marks = supportMarks(results, run, lpGQ, key)
      const plotOf = (
        field: 'Mz' | 'Vy' | 'T' | 'N',
        title: string,
        unit: string,
        invert: boolean,
        threshold: number,
      ) => {
        const env = envelopeAlong(results, run, field)
        const peak = Math.max(Math.abs(env.at.max.v), Math.abs(env.at.min.v))
        if (peak < threshold) return
        const hi = governingCombo(results, env.at.max.mi, env.at.max.s, field, env.at.max.v)
        const lo = governingCombo(results, env.at.min.mi, env.at.min.s, field, env.at.min.v)
        L.plot({
          title: `${beam.name} — ${title} — envoltória ELU (${unit})`,
          unit,
          x: env.x,
          max: env.max,
          min: env.min,
          invert,
          marks,
          note: `máx ${fmt(env.at.max.v, 1)} em ${hi} · mín ${fmt(env.at.min.v, 1)} em ${lo}`,
        })
      }
      if (diagrams.has('M')) plotOf('Mz', 'momento fletor', 'kN·m', true, 0)
      if (diagrams.has('V')) plotOf('Vy', 'força cortante', 'kN', false, 0)
      if (diagrams.has('T')) plotOf('T', 'momento torçor', 'kN·m', false, 0.5)
      if (diagrams.has('N')) plotOf('N', 'força normal (tração +)', 'kN', false, 1)

      // ---- dimensionamento por vão
      const spans = results.beamDesign
        .filter((b) => b.beamId === beam.id)
        .sort((a, b) => a.spanIndex - b.spanIndex)
      for (const sp of spans) beamSpanMemo(L, sp, results, { cover: cover.beam, fyd: fydV, cp })
      L.vspace(6)
    }
  }

  // ================================================================= pilares
  if (sections.has('pilares')) {
    const items = byName(results.columnDesign).filter((c) => want(opts.only?.columns, c.columnId))
    if (items.length > 0) L.h1('A.2 Pilares')
    for (const c of items) {
      L.ensure(170)
      L.h2(`${c.name} — ${c.sectionLabel} cm`)
      const desc = lpGQ.columns.find((x) => x.columnId === c.columnId)
      if (desc) {
        L.para('Descida de cargas (G + Q característica):', 8, 'B', 0.2)
        L.table(
          [
            { t: 'Tramo sob', w: 26 },
            { t: 'N de cima (kN)', w: 17, align: 'r' },
            { t: 'vigas (kN)', w: 15, align: 'r' },
            { t: 'lajes (kN)', w: 15, align: 'r' },
            { t: 'peso próprio (kN)', w: 18, align: 'r' },
            { t: 'N na base (kN)', w: 17, align: 'r' },
          ],
          [
            ...desc.steps.map((s) => [
              s.key.endsWith('|-1') ? 'arranque (até a sapata)' : s.levelName,
              fmt(s.fromAbove, 1),
              fmt(s.fromBeams, 1),
              fmt(s.fromSlabs, 1),
              fmt(s.own, 1),
              fmt(s.nBase, 1),
            ]),
            ['Reação na fundação', '', '', '', '', desc.foundation === null ? '—' : fmt(desc.foundation, 1)],
          ],
          7.2,
        )
      }
      const run = columnRun(results, c.columnId)
      if (run) {
        // pavimentos ao longo da altura
        const marks = run.memberIds.map((mi, i) => ({
          x: run.offsets[i] + model.members[mi].length,
          label: levelName(model.nodes[model.members[mi].nj].levelIndex),
        }))
        const plotCol = (
          field: 'N' | 'My' | 'Mz',
          title: string,
          unit: string,
          sign: 1 | -1,
          threshold: number,
        ) => {
          const env = envelopeAlong(results, run, field, sign)
          const peak = Math.max(Math.abs(env.at.max.v), Math.abs(env.at.min.v))
          if (peak < threshold) return
          const hi = governingCombo(results, env.at.max.mi, env.at.max.s, field, env.at.max.v, sign)
          L.plot({
            title: `${c.name} — ${title} — envoltória ELU (${unit}) · eixo horizontal = altura desde a base`,
            unit,
            x: env.x,
            max: env.max,
            min: env.min,
            marks,
            height: 64,
            note:
              field === 'N'
                ? `máx ${fmt(env.at.max.v, 1)} em ${hi}`
                : `máx ${fmt(env.at.max.v, 1)} em ${hi} · mín ${fmt(env.at.min.v, 1)} em ${governingCombo(results, env.at.min.mi, env.at.min.s, field, env.at.min.v, sign)}`,
          })
        }
        if (diagrams.has('N')) plotCol('N', 'força normal de compressão', 'kN', -1, 0)
        if (diagrams.has('M')) {
          plotCol('Mz', 'momento fletor Mz (flexão na direção de h)', 'kN·m', 1, 0.5)
          plotCol('My', 'momento fletor My (flexão na direção de bw)', 'kN·m', 1, 0.5)
        }
      }
      L.para('Dimensionamento (flexo-compressão oblíqua, §17.2.5):', 8, 'B', 0.2)
      L.kv(
        [
          ['Solicitação governante', `${c.governing} — Nd = ${fmt(c.nd, 1)} kN · Md,u = ${fmt(c.mdU, 1)} kN·m · Md,v = ${fmt(c.mdV, 1)} kN·m (com 2ª ordem local e momentos mínimos)`],
          ['Força normal reduzida', `ν = Nd / (Ac·fcd) = ${fmt(c.nu, 3)}`],
          [
            'Esbeltez',
            `λu = ${fmt(c.lambdaU, 1)} · λv = ${fmt(c.lambdaV, 1)}${c.needsRigorous ? ' — λ > 90: exige método mais rigoroso (§15.8.3)' : ''}`,
          ],
          ['Armadura longitudinal', `As = ${cm2(c.as)} cm² (ρ = ${fmt(c.rho * 100, 2)}%) — ${c.bars}`],
          ['Estribos', c.stirrupSpec],
          ['Aproveitamento', `${fmt(c.utilization * 100, 0)}% — ${STATUS[c.status]}`],
          ...(c.wall
            ? ([
                [
                  'Pilar-parede (§15.9)',
                  `${c.wall.laminas} lâminas · λmáx = ${fmt(c.wall.lambdaMax, 0)} · vertical ${c.wall.vSpec} · horizontal ${c.wall.hSpec}`,
                ],
              ] as [string, string][])
            : []),
        ],
        150,
      )
      for (const n of c.notes) L.para(`• ${n}`, 7.6, 'R', 0.25)
      L.vspace(4)
    }
  }

  // =================================================================== lajes
  if (sections.has('lajes')) {
    const items = results.slabDesign.filter((s) => want(opts.only?.slabs, s.slabId))
    if (items.length > 0) L.h1('A.3 Lajes')
    for (const s of items) {
      const li = levels.findIndex((l) => l.name === s.levelName)
      const plan = project.plans.find((p) => p.id === levels[li]?.planId)
      const slab = plan?.slabs.find((x) => x.id === s.slabId)
      L.ensure(150)
      L.h2(`${s.name} — ${s.levelName} — h = ${cmDim(s.thickness)} cm (${SLAB_KIND[s.kind]})`)
      if (slab && plan) {
        const area = polygonArea(slab.polygon)
        const net = area > 1e-9 ? (area - Math.min(slabOpeningsArea(plan, slab), area)) / area : 1
        const extras = slabExtraLoads(plan, slab)
        const pp = slabSelfWeight(slab, st.concreteUnitWeight)
        const g = (pp + slab.finishLoad) * net + extras.g
        const q = slab.liveLoad * net + extras.q
        L.kv(
          [
            ['Área', `${fmt(area, 2)} m²${net < 1 - 1e-6 ? ` (${fmt(net * 100, 0)}% útil — furos descontados)` : ''}`],
            [
              'Permanente g',
              `peso próprio ${fmt(pp, 2)} + revestimento ${fmt(slab.finishLoad, 2)}${extras.g > 1e-9 ? ` + regiões de carga ${fmt(extras.g, 2)}` : ''} = ${fmt(g, 2)} kN/m²`,
            ],
            [
              'Variável q',
              `${fmt(slab.liveLoad, 2)}${extras.q > 1e-9 ? ` + regiões de carga ${fmt(extras.q, 2)}` : ''} = ${fmt(q, 2)} kN/m² (${slab.liveLoadLabel})`,
            ],
            ['Carga de cálculo', `pd = 1,4·(g + q) = 1,4 × ${fmt(g + q, 2)} = ${fmt(1.4 * (g + q), 2)} kN/m²`],
          ],
          150,
        )
      }
      if (s.design) {
        const d = s.design
        L.table(
          [
            { t: 'Dir.', w: 6 },
            { t: 'Vão (m)', w: 10, align: 'r' },
            { t: 'Vínculo', w: 27 },
            { t: 'quinhão (kN/m²)', w: 17, align: 'r' },
            { t: 'Md vão', w: 10, align: 'r' },
            { t: 'As vão (cm²/m)', w: 17, align: 'r' },
            { t: 'Armadura', w: 14 },
            { t: 'Md apoio', w: 11, align: 'r' },
            { t: 'Negativa (cm²/m)', w: 26 },
          ],
          (['A', 'B'] as const).map((k) => {
            const r = k === 'A' ? d.dirA : d.dirB
            return [
              k,
              fmt(r.span, 2),
              FIXITY[r.fixedEnds],
              fmt(r.w, 2),
              fmt(r.mSpanD, 2),
              `${cm2(Math.max(r.asSpan, r.asSpanMin))}${r.asSpan < r.asSpanMin ? ' (mín)' : ''}`,
              r.spanSpec,
              r.mSupportD > 0 ? fmt(r.mSupportD, 2) : '—',
              r.mSupportD > 0 ? `${cm2(r.asSupport)} — ${r.supportSpec}` : '—',
            ]
          }),
          7,
        )
        L.kv(
          [
            [
              'Flecha (combinação quase-permanente)',
              `${mm(d.deflection, 1)} mm ${d.deflectionOk ? '≤' : '>'} limite ${mm(d.deflectionLimit, 1)} mm (L/250) — ${d.deflectionOk ? 'OK' : 'EXCEDE'}`,
            ],
          ],
          190,
        )
      } else if (s.gridDesign) {
        const gd = s.gridDesign
        L.kv(
          [
            ['Momentos de cálculo (grelha)', `vão: mx = ${fmt(gd.mxSpan, 2)} · my = ${fmt(gd.mySpan, 2)} kN·m/m — apoio: mx = ${fmt(gd.mxSupport, 2)} · my = ${fmt(gd.mySupport, 2)} kN·m/m`],
            ['Armaduras no vão', `X: ${cm2(gd.asX)} cm²/m — ${gd.specX} · Y: ${cm2(gd.asY)} cm²/m — ${gd.specY}`],
            ['Armaduras nos apoios', `X: ${cm2(gd.asXSup)} cm²/m — ${gd.specXSup} · Y: ${cm2(gd.asYSup)} cm²/m — ${gd.specYSup}`],
            ['Flecha', `${mm(gd.deflection, 1)} mm ${gd.deflectionOk ? '≤' : '>'} limite ${mm(gd.deflectionLimit, 1)} mm — ${gd.deflectionOk ? 'OK' : 'EXCEDE'}`],
          ],
          170,
        )
      } else {
        L.para(
          s.latticeDesign
            ? 'Laje treliçada: desenvolvimento completo na seção 9 (vigotas pré-fabricadas).'
            : s.ribbedDesign
              ? 'Laje nervurada: esforços e armaduras por nervura na seção 9.'
              : 'Laje de contorno não retangular pelo método de Marcus: dimensionamento manual (use o método da grelha).',
          7.8,
          'I',
          0.3,
        )
      }
      // reações nas bordas (o que a laje entrega)
      const edges = lpGQ.slabEdges.filter((e) => e.slabKey === slabKey(li, s.slabId) && e.value > 1e-6)
      if (edges.length > 0) {
        L.para('Reações nas bordas (G + Q característica):', 8, 'B', 0.2)
        L.table(
          [
            { t: 'Borda', w: 34 },
            { t: 'Comprimento (m)', w: 16, align: 'r' },
            { t: 'Entrega a', w: 22 },
            { t: 'kN/m', w: 14, align: 'r' },
            { t: 'kN', w: 14, align: 'r' },
          ],
          edges.map((e) => [
            `(${fmt(e.a.x, 2)}; ${fmt(e.a.y, 2)}) a (${fmt(e.b.x, 2)}; ${fmt(e.b.y, 2)})`,
            fmt(Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y), 2),
            e.beamKeys.map((k) => nameOf(lpGQ, k)).join(', '),
            fmt(e.perMeter, 2),
            fmt(e.value, 1),
          ]),
          7,
        )
      }
      for (const n of s.notes) L.para(`• ${n}`, 7.6, 'R', 0.25)
      L.vspace(4)
    }
  }

  // =============================================================== fundações
  if (sections.has('fundacoes')) {
    const items = byName(results.foundations).filter((f) => want(opts.only?.columns, f.columnId))
    if (items.length > 0) L.h1('A.4 Fundações')
    for (const f of items) {
      const kindLabel = f.kind === 'sapata' ? 'sapata' : f.kind === 'bloco' ? 'bloco sobre estacas' : 'tubulão'
      L.ensure(150)
      L.h2(`Fundação de ${f.name} — ${kindLabel}${f.manual ? ' (dimensões informadas pelo usuário)' : ''}`)
      const row = results.foundationLoads.find((r) => r.columnId === f.columnId)
      if (row) {
        L.para('Cargas do pilar na fundação (características, por caso):', 8, 'B', 0.2)
        L.table(
          [
            { t: 'Caso', w: 14 },
            { t: 'Fz (kN)', w: 14, align: 'r' },
            { t: 'Fx (kN)', w: 14, align: 'r' },
            { t: 'Fy (kN)', w: 14, align: 'r' },
            { t: 'Mx (kN·m)', w: 16, align: 'r' },
            { t: 'My (kN·m)', w: 16, align: 'r' },
          ],
          [
            ...row.cases.map((c) => [c.caseId, fmt(c.fz, 1), fmt(c.fx, 1), fmt(c.fy, 1), fmt(c.mx, 1), fmt(c.my, 1)]),
            ['G + Q', fmt(row.fzServ, 1), '', '', '', ''],
            ['ELU máx', fmt(row.fzEluMax, 1), '', '', '', ''],
          ],
          7.2,
        )
      }
      const rows: [string, string][] = [['Carga vertical de serviço', `Nserv = ${fmt(f.nServ, 1)} kN`]]
      if (f.footing) {
        const t = f.footing
        rows.push(
          ['Dimensões', `${cmDim(t.a)} × ${cmDim(t.b)} cm · h = ${cmDim(t.h)} cm (borda ${cmDim(t.h0)} cm) · d = ${cmDim(t.d)} cm`],
          [
            'Tensão no solo',
            `média ${fmt(t.sigma, 0)} kPa · máxima ${fmt(t.sigmaMax, 0)} kPa ${t.sigmaMax <= 1.3 * st.soil.sigmaAdm + 1e-6 ? '≤' : '>'} 1,3·σadm = ${fmt(1.3 * st.soil.sigmaAdm, 0)} kPa (σadm = ${fmt(st.soil.sigmaAdm, 0)} kPa)`,
          ],
          [
            'Excentricidades',
            `ea = ${cmDim(t.ea)} cm · eb = ${cmDim(t.eb)} cm — ${t.insideKern ? 'dentro do núcleo central (base toda comprimida)' : 'FORA do núcleo central'}`,
          ],
          ['Armadura', `direção a: ${cm2(t.asA)} cm² — ${t.specA} · direção b: ${cm2(t.asB)} cm² — ${t.specB}`],
        )
        for (const n of t.notes) rows.push(['', n])
      }
      if (f.pileCap) {
        const b = f.pileCap
        rows.push(
          ['Estacas', `${b.nPiles} × φ${cmDim(b.pileDiameter)} cm · espaçamento ${cmDim(b.e)} cm`],
          [
            'Carga por estaca',
            `${fmt(b.pileLoad, 1)} kN ${b.pileLoad <= b.pileCapacity + 1e-6 ? '≤' : '>'} capacidade ${fmt(b.pileCapacity, 0)} kN`,
          ],
          ['Bloco', `${cmDim(b.planA)} × ${cmDim(b.planB)} cm · h = ${cmDim(b.h)} cm · d = ${cmDim(b.d)} cm · biela a ${fmt(b.alphaDeg, 1)}°`],
          [
            'Bielas',
            `junto ao pilar ${fmt(b.sigmaPil / 1000, 2)} MPa · junto à estaca ${fmt(b.sigmaEst / 1000, 2)} MPa · limite ${fmt(b.sigmaLim / 1000, 2)} MPa`,
          ],
          ['Tirante', `As = ${cm2(b.asMain)} cm² — ${b.mainSpec}`],
        )
        for (const n of b.notes) rows.push(['', n])
      }
      if (f.caisson) {
        const t = f.caisson
        rows.push(
          ['Tubulão', `fuste φ${cmDim(t.shaftD)} cm · base φ${cmDim(t.baseD)} cm · altura da base ${cmDim(t.baseH)} cm`],
          ['Tensões', `fuste ${fmt(t.sigmaShaft / 1000, 2)} MPa · base ${fmt(t.sigmaBase, 0)} kPa`],
        )
        for (const n of t.notes) rows.push(['', n])
      }
      rows.push(['Situação', STATUS[f.status]])
      L.kv(rows, 150)
      L.vspace(4)
    }
  }

  // ================================================================== global
  if (sections.has('global') && results.stability.drift.length > 0) {
    L.h1('A.5 Deslocamentos horizontais da estrutura')
    L.para(
      'Deformada lateral: deslocamento do diafragma de cada pavimento nas combinações de serviço ' +
        'com vento (§13.3 — limites H/1700 no topo e hi/850 entre pavimentos).',
      7.8,
      'I',
      0.3,
    )
    for (const d of results.stability.drift) {
      if (d.stories.length === 0) continue
      const zs = [0, ...d.stories.map((s) => s.z)]
      const disp = [0, ...d.stories.map((s) => s.disp * 1000)]
      L.plot({
        title: `Vento ${d.dir} — deslocamento horizontal por pavimento (mm) · eixo horizontal = altura`,
        unit: 'mm',
        x: zs,
        max: disp,
        min: disp,
        marks: d.stories.map((s) => ({ x: s.z, label: s.levelName })),
        height: 58,
        digits: 2,
        note: `${d.comboLabel} · topo ${mm(Math.abs(d.topDisp), 2)} mm ${d.ok ? '≤' : '>'} limite ${mm(d.topLimit, 2)} mm`,
      })
    }
  }
}

const SLAB_KIND = { macica: 'maciça', nervurada: 'nervurada', trelicada: 'treliçada' } as const

const STATUS: Record<'ok' | 'atencao' | 'falha', string> = {
  ok: 'OK',
  atencao: 'atenção',
  falha: 'FALHA',
}

/** apoios ao longo da viga: nós onde ela entrega (ou recebe) carga, com o nome do vizinho */
function supportMarks(
  results: AnalysisResults,
  run: ElementRun,
  lp: LoadPath,
  key: string,
): { x: number; label: string }[] {
  const { model } = results
  const nodesAt: { x: number; node: number }[] = []
  run.memberIds.forEach((mi, i) => {
    const m = model.members[mi]
    if (i === 0) nodesAt.push({ x: 0, node: m.ni })
    nodesAt.push({ x: run.offsets[i] + m.length, node: m.nj })
  })
  const out: { x: number; label: string }[] = []
  for (const f of lp.flows) {
    const other = f.from === key ? f.to : f.to === key ? f.from : null
    if (!other) continue
    const e = lp.elements.find((x) => x.key === other)
    if (!e || e.kind === 'slab') continue
    let best: { x: number; d: number } | null = null
    for (const n of nodesAt) {
      const nd = model.nodes[n.node]
      const d = Math.hypot(nd.x - f.at.x, nd.y - f.at.y)
      if (!best || d < best.d) best = { x: n.x, d }
    }
    if (best && best.d < 0.5 && !out.some((o) => Math.abs(o.x - best!.x) < 1e-6)) {
      out.push({ x: best.x, label: e.kind === 'foundation' ? e.name.replace('Fundação de ', '') : e.name })
    }
  }
  return out.sort((a, b) => a.x - b.x)
}

/** altura útil usada no dimensionamento das vigas: estribo φ6,3 e meia barra φ16 */
export const beamEffectiveDepth = (h: number, cover: number): number =>
  Math.max(h - cover - 0.0063 - 0.008, 0.5 * h)

/** As = Md / (fyd·z), z = d − 0,4x — a conta escrita no memorial (§17.2.2, seção retangular) */
export const flexureAs = (md: number, xd: number, d: number, fyd: number): number =>
  md / (fyd * (d - 0.4 * Math.min(xd, 0.45) * d))

/** desenvolvimento do dimensionamento de um vão de viga */
function beamSpanMemo(
  L: Layout,
  sp: BeamSpanDesign,
  results: AnalysisResults,
  ctx: { cover: number; fyd: number; cp: ReturnType<typeof concreteProps> },
): void {
  const { bw, h } = sp.section
  const d = beamEffectiveDepth(h, ctx.cover)
  const { cp } = ctx
  L.ensure(90) // o título do vão não fica órfão no pé da página
  L.para(
    `Vão ${sp.spanIndex + 1} — L = ${fmt(sp.length, 2)} m · bw = ${cmDim(bw)} cm · h = ${cmDim(h)} cm · d = h − c − φt − φ/2 = ${fmt(d * 100, 1)} cm`,
    8,
    'B',
    0.2,
  )
  const flex = (label: string, f: FlexureDesign | null): [string, string][] => {
    if (!f) return []
    if (f.md < 0.1) return [[label, `Md desprezível — armadura mínima ${cm2(f.asMin)} cm² — ${f.bars}`]]
    const x = f.xd * d
    const z = d - 0.4 * x
    const dev = f.flange
      ? `seção T (mesa bf = ${cmDim(f.flange.bf)} cm, hf = ${cmDim(f.flange.hf)} cm) · x/d = ${fmt(f.xd, 3)} · As (já ≥ mínima) = ${cm2(f.as)} cm²`
      : `x/d = ${fmt(f.xd, 3)} ${f.xd <= 0.45 ? '≤' : '>'} 0,45 · z = d − 0,4x = ${fmt(z * 100, 1)} cm · As = Md / (fyd·z) = ${fmt(f.md, 1)} / (${fmt(ctx.fyd / 1000, 1)} × ${fmt(z, 3)}) = ${cm2(flexureAs(f.md, f.xd, d, ctx.fyd))} cm²`
    return [
      [
        label,
        `Md = ${fmt(f.md, 1)} kN·m · ${dev} · As,mín = ${cm2(f.asMin)} cm² · adotado ${f.bars} (As,ef = ${cm2(f.asProvided)} cm²)${f.note ? ` — ${f.note}` : ''}`,
      ],
    ]
  }
  const sh = sp.shear
  const rows: [string, string][] = [
    ...flex('Flexão — positivo no vão', sp.positive),
    ...flex('Flexão — negativo, apoio esquerdo', sp.negLeft),
    ...flex('Flexão — negativo, apoio direito', sp.negRight),
    [
      'Cortante (§17.4.2.2, modelo I)',
      `Vd = ${fmt(sh.vd, 1)} kN · VRd2 = 0,27·αv2·fcd·bw·d = ${fmt(sh.vrd2, 1)} kN (αv2 = ${fmt(1 - cp.fck / 1000 / 250, 2)}) · Vc = 0,6·fctd·bw·d = ${fmt(sh.vc, 1)} kN · ` +
        (sh.vd <= sh.vc
          ? `Vd ≤ Vc ⇒ só a armadura mínima: (Asw/s)mín = 0,2·(fctm/fywk)·bw = ${fmt(sh.aswSMin * 1e4, 2)} cm²/m`
          : `Asw/s = (Vd − Vc) / (0,9·d·fywd) = ${fmt(((sh.vd - sh.vc) / (0.9 * d * Math.min(ctx.fyd, 435_000))) * 1e4, 2)} cm²/m · mínimo ${fmt(sh.aswSMin * 1e4, 2)} cm²/m`) +
        (sp.torsion.negligible ? '' : ` · com os estribos de torção: ${fmt(sh.aswS * 1e4, 2)} cm²/m`) +
        ` · adotado ${sh.spec}${sh.note ? ` — ${sh.note}` : ''}`,
    ],
  ]
  const t = sp.torsion
  if (!t.negligible) {
    rows.push([
      'Torção (§17.5)',
      `Td = ${fmt(t.td, 2)} kN·m · he = ${fmt(t.he * 100, 1)} cm · TRd2 = ${fmt(t.trd2, 1)} kN·m · A90/s = ${fmt(t.a90S * 1e4, 2)} cm²/m · Asl = ${cm2(t.asl)} cm² · Vd/VRd2 + Td/TRd2 = ${fmt(t.interaction, 2)} ${t.interaction <= 1 ? '≤' : '>'} 1`,
    ])
  }
  if (sp.skin.required) rows.push(['Armadura de pele (§17.3.5.2.3)', `${cm2(sp.skin.asPerFace)} cm² por face — ${sp.skin.spec}`])
  const sv = results.beamService.find((b) => b.beamId === sp.beamId && b.spanIndex === sp.spanIndex)
  if (sv) {
    rows.push([
      'Flecha (ELS, quase-permanente)',
      `elástica ${mm(sv.deltaElastic, 2)} mm × fissuração ${fmt(sv.crackFactor, 2)} × fluência ⇒ total ${mm(sv.deltaTotal, 2)} mm ${sv.ok ? '≤' : '>'} limite ${mm(sv.limit, 2)} mm`,
    ])
    if (sv.crack) {
      rows.push([
        'Fissuração (ELS-W, frequente)',
        `M = ${fmt(sv.crack.mFreq, 1)} kN·m · σs = ${fmt(sv.crack.sigmaS / 1000, 0)} MPa · wk = ${mm(sv.crack.wk, 2)} mm ${sv.crack.ok ? '≤' : '>'} ${mm(sv.crack.wkLimit, 2)} mm`,
      ])
    }
  }
  L.kv(rows, 150)
}
