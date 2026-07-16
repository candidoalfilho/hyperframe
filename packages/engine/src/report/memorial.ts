/**
 * Memorial de cálculo completo em PDF — todas as etapas da análise e do
 * dimensionamento (dados, ações, combinações, estabilidade, ELU/ELS por
 * elemento, escadas, reservatórios, fundações, incêndio, quantitativos,
 * avisos e premissas), gerado com o writer PDF próprio (zero dependências).
 */

import { A4, PdfDoc, textWidth, wrapText, type PdfFont } from './pdf'
import type { Project } from '../model/types'
import type { AnalysisResults } from '../analysis/types'
import { concreteProps, coverFor, fyd as fydOf } from '../nbr/nbr6118/materials'

export interface MemorialOptions {
  /** data/hora de geração, já formatada (ex.: "10/07/2026 14:32") */
  generatedAt: string
  appVersion?: string
}

// ---------------------------------------------------------------------------
// formatação pt-BR
// ---------------------------------------------------------------------------

const fmt = (v: number, d = 1): string => (Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '—')
const cmDim = (m: number): string => fmt(m * 100, 0)
const cm2 = (a: number): string => fmt(a * 1e4, 2)
const mm = (m: number, d = 2): string => fmt(m * 1000, d)

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------

const ML = 52
const MR = 52
const MT = 60
const MB = 54
const CW = A4.width - ML - MR

interface Col {
  t: string
  w: number
  align?: 'l' | 'r' | 'c'
}

class Layout {
  doc = new PdfDoc()
  y = A4.height - MT

  ensure(h: number): void {
    if (this.y - h < MB) this.newPage()
  }

  newPage(): void {
    this.doc.addPage()
    this.y = A4.height - MT
  }

  vspace(h: number): void {
    this.y -= h
  }

  h1(txt: string): void {
    this.ensure(30)
    this.vspace(10)
    this.doc.text(ML, this.y - 11, txt, 11.5, 'B', 0.05)
    this.y -= 15
    this.doc.line(ML, this.y, ML + CW, this.y, 0.9, 0.25)
    this.y -= 8
  }

  h2(txt: string): void {
    this.ensure(22)
    this.vspace(6)
    this.doc.text(ML, this.y - 9, txt, 9.5, 'B', 0.12)
    this.y -= 14
  }

  para(txt: string, size = 8.6, font: PdfFont = 'R', gray = 0.15): void {
    const lines = wrapText(txt, size, CW, font)
    for (const line of lines) {
      this.ensure(size + 4)
      this.doc.text(ML, this.y - size, line, size, font, gray)
      this.y -= size + 3
    }
    this.y -= 2
  }

  kv(rows: [string, string][], labelW = 190): void {
    for (const [k, v] of rows) {
      const lines = wrapText(v, 8.6, CW - labelW - 6)
      this.ensure(lines.length * 11.5 + 2)
      this.doc.text(ML, this.y - 8.6, k, 8.6, 'B', 0.2)
      for (const line of lines) {
        this.doc.text(ML + labelW, this.y - 8.6, line, 8.6, 'R', 0.12)
        this.y -= 11.5
      }
    }
    this.y -= 3
  }

  /** trunca com reticências p/ caber na largura */
  private fit(txt: string, size: number, maxW: number, font: PdfFont): string {
    if (textWidth(txt, size, font) <= maxW) return txt
    let t = txt
    while (t.length > 1 && textWidth(`${t}…`, size, font) > maxW) t = t.slice(0, -1)
    return `${t}…`
  }

  table(cols: Col[], rows: string[][], size = 7.4): void {
    const totalW = cols.reduce((s, c) => s + c.w, 0)
    const scale = CW / totalW
    const widths = cols.map((c) => c.w * scale)
    const rowH = size + 4.6
    const pad = 3

    const drawHeader = () => {
      this.ensure(rowH + 4)
      this.doc.fillRect(ML, this.y - rowH, CW, rowH, 0.9)
      let x = ML
      cols.forEach((c, i) => {
        const w = widths[i]
        const tx =
          c.align === 'r'
            ? x + w - pad - textWidth(c.t, size, 'B')
            : c.align === 'c'
              ? x + (w - textWidth(c.t, size, 'B')) / 2
              : x + pad
        this.doc.text(tx, this.y - rowH + 3.2, c.t, size, 'B', 0.1)
        x += w
      })
      this.y -= rowH
      this.doc.line(ML, this.y, ML + CW, this.y, 0.7, 0.35)
    }

    drawHeader()
    for (const row of rows) {
      if (this.y - rowH < MB) {
        this.newPage()
        drawHeader()
      }
      let x = ML
      cols.forEach((c, i) => {
        const w = widths[i]
        const raw = row[i] ?? ''
        const txt = this.fit(raw, size, w - 2 * pad, 'R')
        const tx =
          c.align === 'r'
            ? x + w - pad - textWidth(txt, size, 'R')
            : c.align === 'c'
              ? x + (w - textWidth(txt, size, 'R')) / 2
              : x + pad
        this.doc.text(tx, this.y - rowH + 3.2, txt, size, 'R', 0.12)
        x += w
      })
      this.y -= rowH
      this.doc.line(ML, this.y, ML + CW, this.y, 0.35, 0.82)
    }
    this.y -= 6
  }
}

// ---------------------------------------------------------------------------
// memorial
// ---------------------------------------------------------------------------

const STATUS_TXT: Record<'ok' | 'atencao' | 'falha', string> = {
  ok: 'OK',
  atencao: 'atenção',
  falha: 'FALHA',
}

export function buildMemorialPdf(
  project: Project,
  results: AnalysisResults,
  opts: MemorialOptions,
): Uint8Array {
  const L = new Layout()
  const st = project.settings
  const version = opts.appVersion ?? '0.2.1'
  const cp = concreteProps(st.concrete.fck, st.concrete.aggregate, st.concrete.gammaC)
  const cover = coverFor(st.caa)
  const levels = [...project.levels].sort((a, b) => a.elevation - b.elevation)
  const planName = (id: string | null) =>
    id ? (project.plans.find((p) => p.id === id)?.name ?? '—') : '—'

  // ------------------------------------------------------------------ capa
  L.vspace(6)
  L.doc.text(ML, L.y - 16, 'Memorial de Cálculo Estrutural', 17, 'B', 0)
  L.y -= 24
  L.doc.text(ML, L.y - 10, project.name, 11.5, 'R', 0.15)
  L.y -= 18
  L.doc.line(ML, L.y, ML + CW, L.y, 1.2, 0.2)
  L.y -= 10
  L.kv(
    [
      ['Autor / responsável', project.author || '—'],
      ['Cidade', project.city || '—'],
      ['Gerado em', `${opts.generatedAt} · HyperFrame v${version}`],
      [
        'Normas aplicadas',
        'NBR 6118:2023 · NBR 6120:2019 · NBR 6123 · NBR 8681 · NBR 14432 · NBR 15200 · NBR 6122',
      ],
    ],
    150,
  )
  L.para(
    'Este memorial documenta o modelo, as ações, as combinações, a análise (pórtico espacial ' +
      'com diafragma rígido) e o dimensionamento dos elementos de concreto armado. Os resultados ' +
      'não substituem a análise e a responsabilidade técnica do engenheiro (ART/CREA).',
    8.2,
    'I',
    0.3,
  )

  // ------------------------------------------------------------ 1. materiais
  L.h1('1. Materiais e durabilidade')
  L.kv([
    [
      'Concreto',
      `fck = ${fmt(st.concrete.fck / 1000, 0)} MPa (γc = ${fmt(st.concrete.gammaC, 2)}) · agregado ${st.concrete.aggregate}`,
    ],
    [
      'Propriedades (NBR 6118 §8.2)',
      `fcd = ${fmt(cp.fcd / 1000, 1)} · fctm = ${fmt(cp.fctm / 1000, 2)} · Eci = ${fmt(cp.eci / 1e6, 1)} GPa · Ecs = ${fmt(cp.ecs / 1e6, 1)} GPa`,
    ],
    [
      'Aço',
      `CA-50: fyk = ${fmt(st.steel.fyk / 1000, 0)} MPa (γs = ${fmt(st.steel.gammaS, 2)}) · fyd = ${fmt(fydOf(st.steel) / 1000, 1)} MPa · Es = ${fmt(st.steel.Es / 1e6, 0)} GPa`,
    ],
    [
      'Durabilidade',
      `CAA ${st.caa} — cobrimentos: laje ${cmDim(cover.slab)} · viga ${cmDim(cover.beam)} · pilar ${cmDim(cover.column)} cm (tab. 7.2)`,
    ],
  ])

  // ------------------------------------------------------------ 2. geometria
  L.h1('2. Geometria e modelo de análise')
  L.table(
    [
      { t: 'Nível', w: 30 },
      { t: 'Cota (m)', w: 16, align: 'r' },
      { t: 'Pé-direito (m)', w: 20, align: 'r' },
      { t: 'Planta de forma', w: 34 },
    ],
    levels.map((l, i) => [
      l.name,
      fmt(l.elevation, 2),
      i > 0 ? fmt(l.elevation - levels[i - 1].elevation, 2) : '—',
      planName(l.planId),
    ]),
  )
  const stats = results.model.stats
  L.para(
    `Pórtico espacial (6 GDL/nó) com diafragma rígido por pavimento: ${stats.nodes} nós, ` +
      `${stats.members} barras, ${stats.dofs} GDL. Pilares: ${project.columns.length}. ` +
      `Análise ELU com rigidez reduzida (vigas ${fmt(st.stiffnessReduction.beams, 1)}·EI, ` +
      `pilares ${fmt(st.stiffnessReduction.columns, 1)}·EI — §15.7.3) e ELS com EI integral.`,
  )

  // --------------------------------------------------------------- 3. ações
  L.h1('3. Ações')
  L.h2('3.1 Cargas verticais por planta')
  for (const plan of project.plans) {
    if (!levels.some((l) => l.planId === plan.id)) continue
    L.para(`${plan.name}:`, 8.6, 'B', 0.15)
    if (plan.slabs.length > 0) {
      L.table(
        [
          { t: 'Laje', w: 14 },
          { t: 'h (cm)', w: 12, align: 'r' },
          { t: 'g2 (kN/m²)', w: 16, align: 'r' },
          { t: 'q (kN/m²)', w: 14, align: 'r' },
          { t: 'Uso (NBR 6120)', w: 44 },
        ],
        plan.slabs.map((s) => [
          s.name,
          cmDim(s.thickness),
          fmt(s.finishLoad, 2),
          fmt(s.liveLoad, 2),
          s.liveLoadLabel ?? '—',
        ]),
      )
    }
    if (plan.wallLoads.length > 0) {
      const wallRows = plan.wallLoads.map((w) => {
        const beam = plan.beams.find((b) => b.id === w.beamId)
        return [beam?.name ?? '?', fmt(w.w, 2), w.label ?? '—']
      })
      L.table(
        [
          { t: 'Alvenaria na viga', w: 20 },
          { t: 'w (kN/m)', w: 14, align: 'r' },
          { t: 'Descrição', w: 56 },
        ],
        wallRows,
      )
    }
    if ((plan.loadRegions ?? []).length > 0) {
      L.table(
        [
          { t: 'Região', w: 16 },
          { t: 'Tipo', w: 18 },
          { t: 'g (kN/m²)', w: 14, align: 'r' },
          { t: 'q (kN/m²)', w: 14, align: 'r' },
          { t: 'Descrição', w: 38 },
        ],
        plan.loadRegions.map((r) => [r.name, r.kind, fmt(r.g, 2), fmt(r.q, 2), r.label ?? '—']),
      )
    }
  }

  L.h2('3.2 Vento (NBR 6123)')
  if (results.model.wind && results.model.wind.length > 0) {
    const w = st.wind
    L.para(
      `V0 = ${fmt(w.v0, 0)} m/s · S1 = ${fmt(w.s1, 2)} · categoria ${['I', 'II', 'III', 'IV', 'V'][w.category - 1]} ` +
        `classe ${w.windClass} · S3 = grupo ${w.s3Group}. Forças por pavimento aplicadas nos nós ` +
        'mestres dos diafragmas (as direções ± têm o mesmo módulo).',
    )
    for (const wd of results.model.wind) {
      if (wd.dir !== 'XP' && wd.dir !== 'YP') continue
      L.para(
        `Direção ${wd.dir === 'XP' ? 'X' : 'Y'} — Ca = ${fmt(wd.ca, 2)} · fachada ${fmt(wd.facadeWidth, 1)} m · F total = ${fmt(wd.totalForce, 1)} kN`,
        8.4,
        'B',
        0.2,
      )
      L.table(
        [
          { t: 'Nível', w: 24 },
          { t: 'z (m)', w: 14, align: 'r' },
          { t: 'q(z) (kN/m²)', w: 18, align: 'r' },
          { t: 'Área (m²)', w: 16, align: 'r' },
          { t: 'F (kN)', w: 14, align: 'r' },
        ],
        wd.perLevel.map((lf) => [
          levels[lf.levelIndex]?.name ?? `nível ${lf.levelIndex}`,
          fmt(lf.z, 2),
          fmt(lf.q, 3),
          fmt(lf.area, 1),
          fmt(lf.F, 1),
        ]),
      )
    }
  } else {
    L.para('Vento não considerado.')
  }

  L.h2('3.3 Imperfeições globais — desaprumo (§11.3.3.4.1)')
  const imp = results.model.imperfections
  if (imp) {
    L.para(
      `θ1 = 1/${fmt(1 / imp.theta1, 0)} · θa = 1/${fmt(1 / imp.thetaA, 0)} · momento de tombamento do desaprumo = ${fmt(imp.baseMoment, 1)} kN·m. ` +
        imp.rules
          .map((r) => `${r.dir}: ${r.rule} (Mvento = ${fmt(r.mWind, 1)} kN·m)`)
          .join(' · '),
    )
  } else {
    L.para('Desaprumo não aplicado (vento desabilitado ou opção desativada).')
  }

  // --------------------------------------------------------- 4. combinações
  L.h1('4. Combinações de ações (NBR 8681 / NBR 6118 §11)')
  L.table(
    [
      { t: 'ID', w: 18 },
      { t: 'Tipo', w: 14 },
      { t: 'Expressão', w: 68 },
    ],
    results.combos.map((c) => [c.id, c.type, c.label]),
    7.8,
  )

  // --------------------------------------------------------- 5. estabilidade
  L.h1('5. Estabilidade global')
  if (results.stability.gammaZ.length > 0) {
    L.table(
      [
        { t: 'Direção', w: 12 },
        { t: 'Combinação', w: 40 },
        { t: 'M1,d (kN·m)', w: 18, align: 'r' },
        { t: 'ΔM,d (kN·m)', w: 18, align: 'r' },
        { t: 'γz', w: 10, align: 'r' },
        { t: 'Classificação', w: 22 },
      ],
      results.stability.gammaZ.map((g) => [
        g.dir,
        g.comboLabel,
        fmt(g.m1, 1),
        fmt(g.deltaM, 1),
        fmt(g.value, 3),
        g.classification === 'nos-fixos'
          ? 'nós fixos'
          : g.classification === 'nos-moveis'
            ? 'nós móveis'
            : 'γz > 1,30',
      ]),
    )
    for (const a of results.stability.alpha) {
      L.para(
        `Parâmetro α (${a.dir.toUpperCase()}): α = ${fmt(a.value, 3)} · α1 = ${fmt(a.limit, 3)} → ${a.ok ? 'nós fixos' : '2ª ordem'}`,
      )
    }
    const so = results.stability.secondOrder
    if (so.applied) {
      L.para(
        '2ª ordem global aproximada (§15.7.2): esforços horizontais ELU majorados por 0,95·γz — ' +
          so.factors
            .filter((f) => f.factor > 1)
            .map((f) => `${f.dir}: ×${fmt(f.factor, 3)}`)
            .join(' · '),
        8.6,
        'B',
        0.15,
      )
    }
    for (const d of results.stability.drift) {
      if (d.stories.length === 0) continue
      const worst = d.stories.reduce((w, s) => (Math.abs(s.rel) / s.relLimit > Math.abs(w.rel) / w.relLimit ? s : w), d.stories[0])
      L.para(
        `Deslocamentos (${d.dir}, ${d.comboLabel}): topo ${mm(Math.abs(d.topDisp), 1)} mm ≤ H/1700 = ${mm(d.topLimit, 1)} mm ${d.topDisp <= d.topLimit ? 'OK' : 'EXCEDE'} · pior entre pavimentos: ${worst.levelName} (${mm(Math.abs(worst.rel), 2)} ≤ ${mm(worst.relLimit, 2)} mm)`,
      )
    }
  } else {
    L.para('Sem ação lateral — verificações de estabilidade não geradas.')
  }

  // ------------------------------------------------------------- 6. vigas ELU
  const beamPlanName = (beamId: string): string =>
    project.plans.find((p) => p.beams.some((b) => b.id === beamId))?.name ?? '—'

  L.h1('6. Vigas — dimensionamento ELU (flexão, cortante e torção)')
  L.table(
    [
      { t: 'Viga/vão', w: 14 },
      { t: 'Planta', w: 16 },
      { t: 'Seção', w: 12, align: 'c' },
      { t: 'Md+ ', w: 12, align: 'r' },
      { t: 'As+ (cm²)', w: 13, align: 'r' },
      { t: 'Barras+', w: 16 },
      { t: 'Md− e/d', w: 19, align: 'r' },
      { t: 'As− e/d', w: 17, align: 'r' },
      { t: 'Vd (kN)', w: 12, align: 'r' },
      { t: 'Estribo', w: 14 },
      { t: 'Td', w: 9, align: 'r' },
      { t: 'Status', w: 11, align: 'c' },
    ],
    results.beamDesign.map((b) => [
      `${b.beamName} v${b.spanIndex + 1}`,
      beamPlanName(b.beamId),
      `${cmDim(b.section.bw)}×${cmDim(b.section.h)}`,
      fmt(b.positive.md, 1),
      cm2(Math.max(b.positive.as, b.positive.asMin)),
      b.positive.bars,
      `${b.negLeft ? fmt(b.negLeft.md, 1) : '—'} / ${b.negRight ? fmt(b.negRight.md, 1) : '—'}`,
      `${b.negLeft ? cm2(b.negLeft.as) : '—'} / ${b.negRight ? cm2(b.negRight.as) : '—'}`,
      fmt(b.shear.vd, 1),
      b.shear.spec,
      b.torsion.negligible ? '—' : fmt(b.torsion.td, 1),
      STATUS_TXT[b.status],
    ]),
    6.8,
  )
  L.para(
    'Momentos em kN·m (envoltória ELU). Estribos somam cisalhamento (modelo I, §17.4.2) e torção ' +
      '(§17.5, seção vazada equivalente). Vigas com h > 60 cm recebem armadura de pele de 0,10%·Ac por face (§17.3.5.2.3).',
    7.8,
    'I',
    0.3,
  )

  // ------------------------------------------------- 6.1 furos em vigas
  if (results.beamOpenings.length > 0) {
    L.h2('6.1 Furos em vigas (NBR 6118 §13.2.5)')
    L.table(
      [
        { t: 'Viga', w: 14 },
        { t: 'Planta', w: 18 },
        { t: 'x (m)', w: 10, align: 'r' },
        { t: 'Furo (cm)', w: 16, align: 'c' },
        { t: 'Desvio (cm)', w: 14, align: 'r' },
        { t: 'Situação', w: 24, align: 'c' },
      ],
      results.beamOpenings.map((o) => [
        o.beamName,
        o.planName,
        fmt(o.x, 2),
        `${fmt(o.width * 100, 0)}×${fmt(o.height * 100, 0)}`,
        fmt(o.yOffset * 100, 1),
        o.status === 'dispensada'
          ? 'dispensada (§13.2.5.2)'
          : o.status === 'verificar'
            ? 'VERIFICAR região'
            : 'INADEQUADA',
      ]),
      7.0,
    )
    L.para(
      'Dispensa de verificação quando: distância à face ≥ max(5 cm; 2c); dimensão ≤ 12 cm e h/3; ' +
        'distância ao apoio ≥ 2h; entre furos ≥ 2h (§13.2.5.2). Furos "verificar" exigem análise da região (ex.: modelo de bielas).',
      7.8,
      'I',
      0.3,
    )
  }

  // ------------------------------------------------------------- 7. vigas ELS
  L.h1('7. Vigas — serviço (flechas e fissuração)')
  L.table(
    [
      { t: 'Viga/vão', w: 14 },
      { t: 'Planta', w: 16 },
      { t: 'L (m)', w: 10, align: 'r' },
      { t: 'δ elást. (mm)', w: 16, align: 'r' },
      { t: 'Fator fiss.', w: 13, align: 'r' },
      { t: 'δ total (mm)', w: 15, align: 'r' },
      { t: 'L/250 (mm)', w: 14, align: 'r' },
      { t: 'wk (mm)', w: 12, align: 'r' },
      { t: 'wk lim', w: 10, align: 'r' },
      { t: 'Verif.', w: 10, align: 'c' },
    ],
    results.beamService.map((b) => [
      `${b.beamName} v${b.spanIndex + 1}`,
      beamPlanName(b.beamId),
      fmt(b.length, 2),
      mm(b.deltaElastic),
      fmt(b.crackFactor, 2),
      mm(b.deltaTotal),
      mm(b.limit),
      b.crack ? mm(b.crack.wk) : '—',
      b.crack ? mm(b.crack.wkLimit, 1) : '—',
      b.ok ? 'OK' : 'excede',
    ]),
    7.2,
  )
  L.para(
    'Flecha total = elástica (ELS-QP, EI íntegro) × Branson × (1 + αf). wk estimado no estádio II ' +
      'sob a combinação frequente (§17.3.3.2) vs limite da tab. 13.4.',
    7.8,
    'I',
    0.3,
  )

  // -------------------------------------------------------------- 8. pilares
  L.h1('8. Pilares — flexo-compressão oblíqua')
  L.table(
    [
      { t: 'Pilar', w: 12 },
      { t: 'Seção', w: 14, align: 'c' },
      { t: 'Nd (kN)', w: 13, align: 'r' },
      { t: 'Md,u / Md,v', w: 20, align: 'r' },
      { t: 'ni', w: 9, align: 'r' },
      { t: 'esbeltez', w: 12, align: 'r' },
      { t: 'As (cm²)', w: 13, align: 'r' },
      { t: 'Barras', w: 16 },
      { t: 'Estribo', w: 15 },
      { t: 'Aprov.', w: 10, align: 'r' },
      { t: 'Status', w: 11, align: 'c' },
    ],
    results.columnDesign.map((c) => [
      c.name,
      c.sectionLabel,
      fmt(c.nd, 0),
      `${fmt(c.mdU, 1)} / ${fmt(c.mdV, 1)}`,
      fmt(c.nu, 2),
      fmt(Math.max(c.lambdaU, c.lambdaV), 0),
      cm2(c.as),
      c.bars,
      c.stirrupSpec,
      `${fmt(c.utilization * 100, 0)}%`,
      STATUS_TXT[c.status],
    ]),
    7.0,
  )
  L.para(
    'Curva de interação por integração da seção (bloco retangular); efeitos locais de 2ª ordem ' +
      'pelo pilar-padrão com curvatura aproximada; momentos mínimos (§11.3.3.4.3).',
    7.8,
    'I',
    0.3,
  )

  // ---------------------------------------------------------------- 9. lajes
  L.h1(
    st.slabMethod === 'grelha'
      ? '9. Lajes (analogia de grelha — maciças; nervuradas por Marcus)'
      : '9. Lajes (Marcus — maciças e nervuradas)',
  )
  L.table(
    [
      { t: 'Laje', w: 16 },
      { t: 'Nível', w: 18 },
      { t: 'h (cm)', w: 10, align: 'r' },
      { t: 'Vãos (m)', w: 16, align: 'c' },
      { t: 'As A (vão)', w: 16 },
      { t: 'As B (vão)', w: 16 },
      { t: 'Negativas', w: 22 },
      { t: 'Flecha', w: 12, align: 'c' },
      { t: 'Status', w: 11, align: 'c' },
    ],
    results.slabDesign.map((s) => [
      s.kind === 'nervurada' ? `${s.name} (nerv.)` : s.name,
      s.levelName,
      cmDim(s.thickness),
      s.rectangular ? `${fmt(s.spanA, 2)}×${fmt(s.spanB, 2)}` : 'não ret.',
      s.design?.dirA.spanSpec ??
        s.gridDesign?.specX ??
        (s.ribbedDesign ? `${s.ribbedDesign.dirA.ribBars}/nerv.` : 'manual'),
      s.design?.dirB.spanSpec ??
        s.gridDesign?.specY ??
        (s.ribbedDesign ? `${s.ribbedDesign.dirB.ribBars}/nerv.` : '—'),
      s.design
        ? [
            s.design.dirA.mSupportD > 0 ? `A: ${s.design.dirA.supportSpec}` : '',
            s.design.dirB.mSupportD > 0 ? `B: ${s.design.dirB.supportSpec}` : '',
          ]
            .filter(Boolean)
            .join(' · ') || '—'
        : s.gridDesign
          ? [
              s.gridDesign.specXSup !== '—' ? `X: ${s.gridDesign.specXSup}` : '',
              s.gridDesign.specYSup !== '—' ? `Y: ${s.gridDesign.specYSup}` : '',
            ]
              .filter(Boolean)
              .join(' · ') || '—'
          : s.ribbedDesign
            ? s.ribbedDesign.dirA.stirrup ?? 'estribo disp.'
            : '—',
      s.design
        ? s.design.deflectionOk
          ? 'OK'
          : 'excede'
        : s.gridDesign
          ? s.gridDesign.deflectionOk
            ? 'OK'
            : 'excede'
          : s.ribbedDesign
            ? s.ribbedDesign.deflectionOk
              ? 'OK'
              : 'excede'
            : '—',
      STATUS_TXT[s.status],
    ]),
    7.0,
  )
  if (results.slabDesign.some((s) => s.kind === 'nervurada')) {
    L.para(
      'Nervuradas (§13.2.4.2): peso próprio real (capa + nervuras + enchimento); momento por ' +
        'nervura = Marcus × espaçamento, positivo como seção T (bloco na capa verificado); ' +
        'cisalhamento sem estribos quando l0 ≤ 65 cm e VSd ≤ VRd1 (§19.4.1).',
      7.8,
      'I',
      0.3,
    )
  }
  if (results.slabDesign.some((s) => s.gridDesign)) {
    L.para(
      'Maciças pela analogia de grelha: malha regular de barras cruzadas (3 GDL/nó, flexão + ' +
        'torção) apoiada nas bordas com viga e nos pilares internos; momentos POR METRO ' +
        '(vão/apoio, X/Y) e reações reais substituem os quinhões a 45°; negativas nas bordas ' +
        'contínuas e sobre pilares; flecha com Branson + fluência (αf = 1,32).',
      7.8,
      'I',
      0.3,
    )
  }
  const gridPunch = results.slabDesign.flatMap((s) =>
    (s.gridDesign?.punching ?? []).map((p) => ({ slab: s, p })),
  )
  if (gridPunch.length > 0) {
    L.h2('9.1 Punção nas lajes lisas (§19.5 — reação real da grelha)')
    L.table(
      [
        { t: 'Laje', w: 12 },
        { t: 'Pilar', w: 10 },
        { t: 'Pos.', w: 9, align: 'c' },
        { t: 'Fsd (kN)', w: 12, align: 'r' },
        { t: 'MSd (kN·m)', w: 13, align: 'r' },
        { t: 'τSd/τRd2 — C', w: 19, align: 'c' },
        { t: 'τSd/τRd1 — C′', w: 19, align: 'c' },
        { t: 'Arm.', w: 12, align: 'c' },
        { t: 'Status', w: 10, align: 'c' },
      ],
      gridPunch.map(({ slab, p }) => [
        slab.name,
        p.name,
        p.check.position === 'edge' ? 'borda' : p.check.position === 'corner' ? 'canto' : 'int.',
        fmt(p.fsd, 0),
        p.check.msdUsed ? fmt(p.check.msdUsed, 1) : '—',
        `${fmt(p.check.tauSd0, 0)} / ${fmt(p.check.tauRd2, 0)}`,
        `${fmt(p.check.tauSd1, 0)} / ${fmt(p.check.tauRd1, 0)}`,
        p.check.needsShearReinf ? 'studs' : 'disp.',
        STATUS_TXT[!p.check.okC ? 'falha' : p.check.needsShearReinf ? 'atencao' : 'ok'],
      ]),
      7.0,
    )
    L.para(
      'Contorno C (face do pilar): τSd ≤ τRd2 (esmagamento). Contorno C′ (2d): τSd ≤ τRd1 ' +
        'dispensa armadura de punção; acima, prever studs (detalhar à parte). Pilares de ' +
        'borda/canto: perímetro crítico REDUZIDO u* e momento corrigido MSd = (MSd1 − FSd·e*) ' +
        '≥ 0, com K da tab. 19.2 (§19.5.2); MSd desbalanceado tomado da envoltória do pórtico.',
      7.8,
      'I',
      0.3,
    )
  }

  // -------------------------------------------------------------- 10. escadas
  if (results.stairDesign.length > 0) {
    L.h1('10. Escadas')
    L.table(
      [
        { t: 'Escada', w: 14 },
        { t: 'Nível', w: 18 },
        { t: 'Vão (m)', w: 11, align: 'r' },
        { t: 'θ', w: 8, align: 'r' },
        { t: 'g/q (kN/m²)', w: 16, align: 'r' },
        { t: 'Md (kN·m/m)', w: 15, align: 'r' },
        { t: 'Armadura', w: 16 },
        { t: 'Distribuição', w: 16 },
        { t: 'Status', w: 11, align: 'c' },
      ],
      results.stairDesign.map((s) => [
        s.name,
        s.levelName,
        fmt(s.design.span, 2),
        `${fmt(s.design.thetaDeg, 0)}°`,
        `${fmt(s.design.g, 1)}/${fmt(s.design.q, 1)}`,
        fmt(s.design.md, 1),
        s.design.spec,
        s.design.distSpec,
        STATUS_TXT[s.status],
      ]),
    )
    L.para(
      'Lance dimensionado como laje armada em uma direção, biapoiado no vão em planta; cargas: laje ' +
        'inclinada (γc·t/cos(θ)) + degraus (γc·e/2) + revestimento + sobrecarga (NBR 6120).',
      7.8,
      'I',
      0.3,
    )
  }

  // --------------------------------------------------------- 11. reservatórios
  if (results.tankDesign.length > 0) {
    L.h1('11. Reservatórios')
    for (const t of results.tankDesign) {
      L.h2(
        `${t.name} (${t.levelName}) — ${fmt(t.design.a, 2)}×${fmt(t.design.b, 2)} m · lâmina ${fmt(t.design.waterHeight, 2)} m · ${fmt(t.design.volume, 1)} m³ · peso em operação ${fmt(t.design.totalWeight, 0)} kN`,
      )
      L.table(
        [
          { t: 'Elemento', w: 20 },
          { t: 'Esforço (kN·m/m)', w: 24, align: 'r' },
          { t: 'Armadura', w: 26 },
          { t: 'Verificação', w: 30 },
        ],
        [
          [
            'Paredes (vertical)',
            `Md = ${fmt(t.design.wall.md, 1)} (engaste)`,
            `${t.design.wall.spec} + horiz. ${t.design.wall.horizSpec}`,
            `estanqueidade wk = ${mm(t.design.wall.wk)} ≤ 0,20 mm ${t.design.wall.ok ? 'OK' : 'FALHA'}`,
          ],
          [
            'Fundo',
            `M+ ${fmt(t.design.bottom.dirA.mSpanD, 1)} · M− ${fmt(t.design.bottom.dirA.mSupportD, 1)}`,
            `A: ${t.design.bottom.dirA.spanSpec} · B: ${t.design.bottom.dirB.spanSpec}`,
            t.design.bottom.dirA.ok && t.design.bottom.dirB.ok ? 'OK' : 'rever espessura',
          ],
          [
            'Tampa',
            `M+ ${fmt(t.design.top.dirA.mSpanD, 1)}`,
            `A: ${t.design.top.dirA.spanSpec} · B: ${t.design.top.dirB.spanSpec}`,
            t.design.top.dirA.ok && t.design.top.dirB.ok ? 'OK' : 'rever espessura',
          ],
        ],
      )
    }
    L.para(
      'Paredes: empuxo hidrostático triangular (γw = 10 kN/m³), faixa vertical engastada na base — ' +
        'modelo conservador; validar com tabelas de placas no projeto executivo.',
      7.8,
      'I',
      0.3,
    )
  }

  // ------------------------------------------------------------ 12. fundações
  const usePiles = st.foundation.type === 'estacas'
  const useCaissons = st.foundation.type === 'tubulao'
  L.h1(
    `12. Fundações — ${usePiles ? 'blocos sobre estacas (Blévot)' : useCaissons ? 'tubulões a céu aberto' : 'sapatas rígidas'}`,
  )
  L.para(
    usePiles
      ? `Estacas ${st.foundation.pileLabel}: Ø ${cmDim(st.foundation.pileDiameter)} cm · carga admissível ${fmt(st.foundation.pileCapacity, 0)} kN · espaçamento ${fmt(st.foundation.pileSpacingFactor, 1)}Ø. Valores geotécnicos orientativos — exigem laudo (NBR 6122).`
      : useCaissons
        ? `Tubulões: σadm da base = ${fmt(st.soil.sigmaAdm, 0)} kPa · σ concreto do fuste = ${fmt(st.foundation.caissonSigmaConcrete ?? 5000, 0)} kPa · profundidade ${fmt(st.foundation.pileLength ?? 10, 1)} m. Fuste não armado; base alargada com rasante 60° (NBR 6122).`
        : `Solo: ${st.soil.label} — σadm = ${fmt(st.soil.sigmaAdm, 0)} kPa (orientativo — exige sondagem SPT, NBR 6122).`,
  )
  if (useCaissons) {
    L.table(
      [
        { t: 'Pilar', w: 11 },
        { t: 'Nserv (kN)', w: 14, align: 'r' },
        { t: 'Fuste Ø (m)', w: 14, align: 'r' },
        { t: 'Base Ø (m)', w: 14, align: 'r' },
        { t: 'H base (m)', w: 13, align: 'r' },
        { t: 'σ fuste (kPa)', w: 16, align: 'r' },
        { t: 'σ base (kPa)', w: 15, align: 'r' },
        { t: 'Status', w: 11, align: 'c' },
      ],
      results.foundations.map((f) => {
        const cs = f.caisson
        if (!cs) return [f.name, fmt(f.nServ, 0), '—', '—', '—', '—', '—', '—']
        return [
          f.name,
          fmt(f.nServ, 0),
          fmt(cs.shaftD, 2),
          fmt(cs.baseD, 2),
          fmt(cs.baseH, 2),
          fmt(cs.sigmaShaft, 0),
          fmt(cs.sigmaBase, 0),
          STATUS_TXT[f.status],
        ]
      }),
      7.0,
    )
  } else if (usePiles) {
    L.table(
      [
        { t: 'Pilar', w: 11 },
        { t: 'Nserv (kN)', w: 14, align: 'r' },
        { t: 'Estacas', w: 11, align: 'c' },
        { t: 'kN/estaca', w: 14, align: 'r' },
        { t: 'Bloco a×b×h (m)', w: 24, align: 'c' },
        { t: 'α', w: 8, align: 'r' },
        { t: 'σ pil/est ≤ lim (kPa)', w: 28, align: 'r' },
        { t: 'Tirante', w: 14 },
        { t: 'Status', w: 11, align: 'c' },
      ],
      results.foundations.map((f) => {
        const pc = f.pileCap
        if (!pc) return [f.name, fmt(f.nServ, 0), '—', '—', '—', '—', '—', '—', '—']
        return [
          f.name,
          fmt(f.nServ, 0),
          String(pc.nPiles),
          fmt(pc.pileLoad, 0),
          `${fmt(pc.planA, 2)}×${fmt(pc.planB, 2)}×${fmt(pc.h, 2)}`,
          pc.nPiles > 1 ? `${fmt(pc.alphaDeg, 0)}°` : '—',
          `${fmt(pc.sigmaPil, 0)}/${fmt(pc.sigmaEst, 0)} ≤ ${fmt(pc.sigmaLim, 0)}`,
          pc.mainSpec,
          STATUS_TXT[f.status],
        ]
      }),
      7.0,
    )
  } else {
    L.table(
      [
        { t: 'Pilar', w: 11 },
        { t: 'Nserv (kN)', w: 14, align: 'r' },
        { t: 'Sapata a×b×h (m)', w: 24, align: 'c' },
        { t: 'σ (kPa)', w: 12, align: 'r' },
        { t: 'σmax (kPa)', w: 14, align: 'r' },
        { t: 'As dir A', w: 18 },
        { t: 'As dir B', w: 18 },
        { t: 'Status', w: 11, align: 'c' },
      ],
      results.foundations.map((f) => {
        const ft = f.footing
        if (!ft) return [f.name, fmt(f.nServ, 0), '—', '—', '—', '—', '—', '—']
        return [
          f.name,
          fmt(f.nServ, 0),
          `${fmt(ft.a, 2)}×${fmt(ft.b, 2)}×${fmt(ft.h, 2)}`,
          fmt(ft.sigma, 0),
          fmt(ft.sigmaMax, 0),
          ft.specA,
          ft.specB,
          STATUS_TXT[f.status],
        ]
      }),
      7.0,
    )
  }

  // ---------------------------------------------- 12.1 cargas na fundação
  if (results.foundationLoads.length > 0) {
    L.h2('12.1 Planta de cargas — reações características por pilar (kN, kN·m)')
    L.table(
      [
        { t: 'Pilar', w: 11 },
        { t: 'G Fz', w: 11, align: 'r' },
        { t: 'Q Fz', w: 11, align: 'r' },
        { t: 'W Fx máx', w: 13, align: 'r' },
        { t: 'W Fy máx', w: 13, align: 'r' },
        { t: 'Mx máx', w: 12, align: 'r' },
        { t: 'My máx', w: 12, align: 'r' },
        { t: 'ELU Fz máx', w: 14, align: 'r' },
      ],
      results.foundationLoads.map((r) => {
        const g = r.cases.find((c) => c.caseId === 'G')
        const q2 = r.cases.find((c) => c.caseId === 'Q')
        let wfx = 0
        let wfy = 0
        let mx = Math.abs(g?.mx ?? 0) + Math.abs(q2?.mx ?? 0)
        let my = Math.abs(g?.my ?? 0) + Math.abs(q2?.my ?? 0)
        for (const c of r.cases) {
          if (!c.caseId.startsWith('W')) continue
          wfx = Math.max(wfx, Math.abs(c.fx))
          wfy = Math.max(wfy, Math.abs(c.fy))
          mx = Math.max(mx, Math.abs(c.mx))
          my = Math.max(my, Math.abs(c.my))
        }
        return [
          r.name,
          fmt(g?.fz ?? 0, 0),
          fmt(q2?.fz ?? 0, 0),
          fmt(wfx, 0),
          fmt(wfy, 0),
          fmt(mx, 0),
          fmt(my, 0),
          fmt(r.fzEluMax, 0),
        ]
      }),
      7.0,
    )
  }

  // ------------------------------------------ 12.2 interação solo-estrutura
  if (results.soilInteraction.enabled && results.soilInteraction.items.length > 0) {
    const si = results.soilInteraction
    L.h2('12.2 Interação solo-estrutura — molas de apoio e recalques')
    const siSoil = st.soilInteraction
    L.para(
      `Sondagem (${siSoil.layers.length} camada(s)): ` +
        siSoil.layers
          .map((l) => `${l.label ?? l.soil} ${fmt(l.thickness, 1)} m (NSPT ${fmt(l.nspt, 0)})`)
          .join(' · ') +
        `. CRH = ${fmt(siSoil.chFactor, 2)}·CRV; ν = ${fmt(siSoil.poisson, 2)}.`,
    )
    L.table(
      [
        { t: 'Pilar', w: 11 },
        { t: 'Fundação', w: 13, align: 'c' },
        { t: 'CRV (MN/m)', w: 15, align: 'r' },
        { t: 'CRH (MN/m)', w: 15, align: 'r' },
        { t: 'Krx (MN·m/rad)', w: 18, align: 'r' },
        { t: 'Kry (MN·m/rad)', w: 18, align: 'r' },
        { t: 'Recalque QP (mm)', w: 19, align: 'r' },
      ],
      si.items.map((it) => [
        it.name,
        it.kind,
        fmt(it.kv / 1000, 1),
        fmt(it.kh / 1000, 1),
        fmt(it.krx / 1000, 1),
        fmt(it.kry / 1000, 1),
        fmt(it.settlementQP * 1000, 1),
      ]),
      7.0,
    )
    const distTxt = si.maxDistortion
      ? ` Distorção angular máxima ${si.maxDistortion.pair}: 1/${Math.round(1 / Math.max(si.maxDistortion.value, 1e-9))} (limite usual 1/500).`
      : ''
    L.para(
      `Recalque máximo (ELS-QP): ${fmt(si.maxSettlement * 1000, 1)} mm.${distTxt}`,
    )
    for (const n of si.notes) L.para(n, 7.6, 'I', 0.32)
  }

  // -------------------------------------------------------------- 13. incêndio
  L.h1('13. Situação de incêndio (NBR 14432 / NBR 15200)')
  if (results.fire.enabled) {
    L.para(
      `TRRF adotado: ${results.fire.trrf} min — grupo ${results.fire.occupancy}, altura ${fmt(results.fire.buildingHeight, 1)} m (sugerido ${results.fire.trrfSuggested} min). ` +
        (results.fire.allOk
          ? 'Todos os elementos verificados ATENDEM.'
          : `${results.fire.items.filter((i) => !i.ok).length} elemento(s) NÃO atendem.`),
    )
    L.table(
      [
        { t: 'Elemento', w: 30 },
        { t: 'Tipo', w: 10 },
        { t: 'b|h (mm)', w: 13, align: 'r' },
        { t: 'mín (mm)', w: 13, align: 'r' },
        { t: 'c1 (mm)', w: 12, align: 'r' },
        { t: 'c1 req.', w: 12, align: 'r' },
        { t: 'TRF (min)', w: 13, align: 'r' },
        { t: 'Verif.', w: 12, align: 'c' },
      ],
      results.fire.items.map((i) => [
        i.element,
        i.kind,
        fmt(i.dim, 0),
        fmt(i.dimRequired, 0),
        fmt(i.c1, 0),
        fmt(i.c1Required, 0),
        i.trf !== undefined ? fmt(i.trf, 0) : '—',
        i.ok ? 'atende' : 'NÃO',
      ]),
      7.0,
    )
    for (const n of results.fire.notes) L.para(n, 7.6, 'I', 0.32)
  } else {
    L.para('Verificação de incêndio desativada nas configurações do projeto.')
  }

  // --------------------------------------------------------- 14. quantitativos
  L.h1('14. Quantitativos e tabela de aço')
  const q = results.quantities
  L.kv([
    [
      'Concreto (m³)',
      `pilares ${fmt(q.concrete.columns, 1)} · vigas ${fmt(q.concrete.beams, 1)} · lajes ${fmt(q.concrete.slabs, 1)} · total ${fmt(q.concrete.total, 1)}`,
    ],
    ['Fôrmas (m²)', fmt(q.formwork, 0)],
    [
      'Aço (kg)',
      `vigas ${fmt(q.steel.beamsDesigned, 0)} · pilares ${fmt(q.steel.columnsEstimated, 0)} · lajes ${fmt(q.steel.slabsEstimated, 0)} · total ${fmt(q.steel.total, 0)} (${fmt(q.steel.ratePerM3, 0)} kg/m³)`,
    ],
  ])
  if (q.cost.enabled) {
    L.h2('14.1 Estimativa de custo da estrutura')
    L.kv([
      [
        'Concreto',
        `R$ ${fmt(q.cost.concrete, 0)} (${fmt(st.costs.concretePerM3, 0)} R$/m³)`,
      ],
      ['Aço (c/ 10% perdas)', `R$ ${fmt(q.cost.steel, 0)} (${fmt(st.costs.steelPerKg, 2)} R$/kg)`],
      ['Fôrmas', `R$ ${fmt(q.cost.formwork, 0)} (${fmt(st.costs.formworkPerM2, 0)} R$/m²)`],
      [
        'TOTAL estimado',
        `R$ ${fmt(q.cost.total, 0)}${q.cost.perSlabArea ? ` (≈ R$ ${fmt(q.cost.perSlabArea, 0)}/m² de laje)` : ''}`,
      ],
    ])
    L.para(
      'Estimativa com custos unitários configuráveis — não substitui orçamento executivo.',
      7.8,
      'I',
      0.3,
    )
  }
  L.table(
    [
      { t: 'Ø (mm)', w: 16, align: 'r' },
      { t: 'Massa (kg)', w: 20, align: 'r' },
    ],
    [
      ...results.detailing.steel.byPhi.map((r) => [
        fmt(r.phi * 1000, r.phi * 1000 % 1 === 0 ? 0 : 1),
        fmt(r.kg, 1),
      ]),
      ['Total', fmt(results.detailing.steel.totalKg, 1)],
      ['Total c/ perdas (10%)', fmt(results.detailing.steel.totalWithWaste, 1)],
    ],
  )

  // ------------------------------------------------------------- 15. avisos
  L.h1('15. Avisos da análise e premissas')
  if (results.warnings.length > 0) {
    for (const w of results.warnings) L.para(`• ${w}`, 7.8, 'R', 0.2)
  } else {
    L.para('Nenhum aviso gerado pela análise.')
  }
  L.vspace(4)
  L.para(
    'Premissas: ' +
      (st.slabMethod === 'grelha'
        ? 'cargas de laje pelas reações da analogia de grelha (bordas apoiadas e pilares internos); '
        : 'quinhões de laje por área de influência (45°); ') +
      'lajes não participam da rigidez ' +
      '(apenas carga e diafragma); ' +
      (results.soilInteraction.enabled
        ? 'apoios sobre molas estimadas da sondagem (interação solo-estrutura); '
        : 'apoios engastados na fundação; ') +
      'detalhamento preliminar. ' +
      'Este documento foi gerado automaticamente pelo HyperFrame e deve ser conferido, ' +
      'complementado e assinado pelo engenheiro responsável (ART/CREA).',
    7.8,
    'I',
    0.3,
  )

  // ------------------------------------------------------- cabeçalho/rodapé
  L.doc.forEachPage((i, total) => {
    if (i > 0) {
      L.doc.text(ML, A4.height - 34, project.name, 7.5, 'R', 0.4)
      const right = 'Memorial de Cálculo'
      L.doc.text(A4.width - MR - textWidth(right, 7.5, 'R'), A4.height - 34, right, 7.5, 'R', 0.4)
      L.doc.line(ML, A4.height - 40, A4.width - MR, A4.height - 40, 0.5, 0.75)
    }
    L.doc.line(ML, MB - 14, A4.width - MR, MB - 14, 0.5, 0.75)
    L.doc.text(
      ML,
      MB - 24,
      `HyperFrame v${version} — os resultados não substituem o engenheiro responsável`,
      7,
      'R',
      0.45,
    )
    const pg = `página ${i + 1} de ${total}`
    L.doc.text(A4.width - MR - textWidth(pg, 7, 'R'), MB - 24, pg, 7, 'R', 0.45)
  })

  return L.doc.build()
}
