/**
 * Memorial de cálculo completo em PDF — todas as etapas da análise e do
 * dimensionamento (dados, ações, combinações, estabilidade, ELU/ELS por
 * elemento, escadas, reservatórios, fundações, incêndio, quantitativos,
 * avisos e premissas), gerado com o writer PDF próprio (zero dependências).
 */

import { wallLoadFromCalc } from '../model/wallLoad'
import { slabLoadG, slabLoadLength, slabLoadTotal, SLAB_LOAD_SIZE_DEFAULT } from '../analysis/slabLoads'
import type { LatticeNegativeEnd } from '../nbr/nbr6118/latticeSlab'
import { A4, textWidth } from './pdf'
import { CW, Layout, MB, ML, MR, cm2, cmDim, fmt, mm } from './layout'
import { appendDetailedMemorial, type MemorialDetailOptions } from './memorialDetail'
import type { Project } from '../model/types'
import type { AnalysisResults } from '../analysis/types'
import { concreteProps, coverFor, fyd as fydOf } from '../nbr/nbr6118/materials'

export interface MemorialOptions extends MemorialDetailOptions {
  /** data/hora de geração, já formatada (ex.: "10/07/2026 14:32") */
  generatedAt: string
  appVersion?: string
  /**
   * nível de detalhe: 'resumido' = tabelas de resultados e verificações
   * (padrão); 'detalhado' = o resumido + anexo com a memória de cada elemento
   * (origem das cargas, reações, diagramas e desenvolvimento das contas)
   */
  detail?: 'resumido' | 'detalhado'
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
  const detailed = opts.detail === 'detalhado'
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
        'Nível de detalhe',
        detailed
          ? 'detalhado — resultados e verificações + Anexo A com a memória de cada elemento'
          : 'resumido — resultados e verificações por elemento',
      ],
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
  // ligação viga–pilar (issue #13): braços rígidos e trechos rígidos adotados
  {
    const arms = results.model.members.filter((m) => m.offI || m.offJ)
    if (arms.length > 0 || st.rigidEndZones) {
      let eMax = 0
      let eccEnds = 0
      for (const m of arms) {
        for (const o of [m.offI, m.offJ]) {
          if (!o) continue
          const along = o[0] * m.xLocal[0] + o[1] * m.xLocal[1]
          const e = Math.hypot(o[0] - along * m.xLocal[0], o[1] - along * m.xLocal[1])
          if (e > 0.005) eccEnds++
          eMax = Math.max(eMax, e)
        }
      }
      L.para(
        'Ligação viga–pilar (§14.6.2.1): o extremo da viga é ligado ao centro de gravidade do ' +
          'pilar por braço rígido' +
          (eccEnds > 0
            ? ` — ${eccEnds} extremo(s) com excentricidade em planta (máx. ${fmt(eMax * 100, 0)} cm), ` +
              'cuja reação gera o momento V·e no pilar'
            : '') +
          '. ' +
          (st.rigidEndZones
            ? 'Trechos rígidos longitudinais considerados: vão de cálculo ℓ0 + a1 + a2, com a = min(t/2; 0,3·h) (§14.6.2.4).'
            : 'Vão de cálculo das vigas tomado eixo a eixo dos apoios.'),
      )
    }
  }

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
      const beamLen = (id: string): number => {
        const b = plan.beams.find((x) => x.id === id)
        if (!b) return 0
        let len = 0
        for (let i = 0; i + 1 < b.path.length; i++) {
          len += Math.hypot(b.path[i + 1].x - b.path[i].x, b.path[i + 1].y - b.path[i].y)
        }
        return len
      }
      const stretch = (w: (typeof plan.wallLoads)[number]): string =>
        w.x0 !== undefined && w.x1 !== undefined
          ? `${fmt(w.x0, 2)}–${fmt(w.x1, 2)} m`
          : 'viga inteira'
      const wallRows = plan.wallLoads.map((w) => {
        const beam = plan.beams.find((b) => b.id === w.beamId)
        return [beam?.name ?? '?', stretch(w), fmt(w.w, 2), w.label ?? '—']
      })
      L.table(
        [
          { t: 'Alvenaria na viga', w: 18 },
          { t: 'Trecho', w: 18 },
          { t: 'w (kN/m)', w: 12, align: 'r' },
          { t: 'Descrição', w: 46 },
        ],
        wallRows,
      )
      const composed = plan.wallLoads.filter((w) => w.calc)
      if (composed.length > 0) {
        L.table(
          [
            { t: 'Viga', w: 9 },
            { t: 'Bloco', w: 26 },
            { t: 'h (m)', w: 8, align: 'r' },
            { t: 'e (cm)', w: 8, align: 'r' },
            { t: 'γ alv', w: 8, align: 'r' },
            { t: 'Revest. (cm · faces · γ)', w: 23, align: 'c' },
            { t: 'kN/m² parede', w: 14, align: 'r' },
            { t: 'L (m)', w: 8, align: 'r' },
            { t: 'Abert. (m²)', w: 11, align: 'r' },
            { t: 'w (kN/m)', w: 11, align: 'r' },
          ],
          composed.map((w) => {
            const c = w.calc!
            const len =
              w.x0 !== undefined && w.x1 !== undefined ? w.x1 - w.x0 : beamLen(w.beamId)
            const bd = wallLoadFromCalc(c, len)
            return [
              plan.beams.find((b) => b.id === w.beamId)?.name ?? '?',
              c.block,
              fmt(c.height, 2),
              fmt(c.thickness * 100, 1),
              fmt(c.unitWeight, 1),
              `${fmt(c.coatingThickness * 100, 1)} · ${c.coatingFaces} · ${fmt(c.coatingUnitWeight, 1)}`,
              fmt(bd.perArea, 2),
              fmt(len, 2),
              fmt(c.openingsArea, 2),
              fmt(bd.w, 2),
            ]
          }),
          7.0,
        )
        L.para(
          'Memória da carga de alvenaria (ação permanente, NBR 6120): peso por m² de parede = ' +
            'e·γalv + nfaces·erev·γrev; w = (kN/m² de parede)·(h·L − aberturas)/L, com L = ' +
            'comprimento do trecho carregado. γ em kN/m³.',
          7.8,
          'I',
          0.3,
        )
      }
    }
    if ((plan.slabLoads ?? []).length > 0) {
      L.table(
        [
          { t: 'Carga na laje', w: 14 },
          { t: 'Tipo', w: 10 },
          { t: 'Posição (m)', w: 28 },
          { t: 'g', w: 11, align: 'r' },
          { t: 'q', w: 11, align: 'r' },
          { t: 'Resultante (kN)', w: 14, align: 'r' },
          { t: 'Descrição', w: 22 },
        ],
        plan.slabLoads!.map((l) => {
          const tot = slabLoadTotal(l)
          const unit = l.kind === 'line' ? ' kN/m' : ' kN'
          const size = l.size ?? SLAB_LOAD_SIZE_DEFAULT
          return [
            l.name,
            l.kind === 'line' ? 'linear' : 'pontual',
            l.kind === 'line' && l.b
              ? `(${fmt(l.a.x, 2)}; ${fmt(l.a.y, 2)}) – (${fmt(l.b.x, 2)}; ${fmt(l.b.y, 2)}) · ${fmt(slabLoadLength(l), 2)} m`
              : `(${fmt(l.a.x, 2)}; ${fmt(l.a.y, 2)}) · ${fmt(size.bx * 100, 0)}×${fmt(size.by * 100, 0)} cm`,
            fmt(slabLoadG(l), 2) + unit,
            fmt(l.q, 2) + unit,
            fmt(tot.g + tot.q, 1),
            l.calc ? `${l.calc.block} (h = ${fmt(l.calc.height, 2)} m)` : (l.label ?? '—'),
          ]
        }),
        7.4,
      )
      L.para(
        'Cargas concentradas e lineares sobre lajes: a reação em cada viga vem da analogia de ' +
          'grelha da própria laje (regra da alavanca nas lajes unidirecionais) e é aplicada na ' +
          'posição em que ocorre.',
        7.8,
        'I',
        0.3,
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
  L.h2('Flexão — armaduras longitudinais (apoio esquerdo · apoio direito)')
  L.table(
    [
      { t: 'Viga/vão', w: 13 },
      { t: 'Planta', w: 12 },
      { t: 'Seção', w: 10, align: 'c' },
      { t: 'Md+', w: 9, align: 'r' },
      { t: 'As+', w: 9, align: 'r' },
      { t: 'Barras+', w: 13 },
      { t: 'Md− esq', w: 10, align: 'r' },
      { t: 'As− esq', w: 10, align: 'r' },
      { t: 'Barras− esq', w: 14 },
      { t: 'Md− dir', w: 10, align: 'r' },
      { t: 'As− dir', w: 10, align: 'r' },
      { t: 'Barras− dir', w: 14 },
    ],
    results.beamDesign.map((b) => [
      `${b.beamName} v${b.spanIndex + 1}`,
      beamPlanName(b.beamId),
      `${cmDim(b.section.bw)}×${cmDim(b.section.h)}`,
      fmt(b.positive.md, 1),
      cm2(Math.max(b.positive.as, b.positive.asMin)),
      b.positive.bars,
      b.negLeft ? fmt(b.negLeft.md, 1) : '—',
      b.negLeft ? cm2(b.negLeft.as) : '—',
      b.negLeft?.bars ?? '—',
      b.negRight ? fmt(b.negRight.md, 1) : '—',
      b.negRight ? cm2(b.negRight.as) : '—',
      b.negRight?.bars ?? '—',
    ]),
    6.8,
  )
  L.h2('Força cortante, torção e armadura de pele')
  L.table(
    [
      { t: 'Viga/vão', w: 14 },
      { t: 'Seção', w: 11, align: 'c' },
      { t: 'L (m)', w: 9, align: 'r' },
      { t: 'Vd (kN)', w: 11, align: 'r' },
      { t: 'VRd2 (kN)', w: 12, align: 'r' },
      { t: 'Estribo', w: 15 },
      { t: 'Td (kN·m)', w: 12, align: 'r' },
      { t: 'Armadura de pele', w: 20 },
      { t: 'Status', w: 11, align: 'c' },
    ],
    results.beamDesign.map((b) => [
      `${b.beamName} v${b.spanIndex + 1}`,
      `${cmDim(b.section.bw)}×${cmDim(b.section.h)}`,
      fmt(b.length, 2),
      fmt(b.shear.vd, 1),
      fmt(b.shear.vrd2, 0),
      b.shear.spec,
      b.torsion.negligible ? '—' : fmt(b.torsion.td, 1),
      b.skin.required ? b.skin.spec : 'dispensada',
      STATUS_TXT[b.status],
    ]),
    6.8,
  )
  L.para(
    'Momentos em kN·m e áreas de aço em cm² (envoltória ELU). Negativos por apoio: esq = apoio ' +
      'inicial do vão, dir = apoio final. Bitolas, quantidades e comprimentos de corte de todas ' +
      'as posições na tabela de aço (§14). Estribos somam cisalhamento (modelo I, §17.4.2) e torção ' +
      '(§17.5, seção vazada equivalente).',
    7.8,
    'I',
    0.3,
  )
  const skinBeams = results.beamDesign.filter((b) => b.skin.required)
  if (skinBeams.length > 0) {
    L.h2('Armadura de pele (§17.3.5.2.3 — vigas com h > 60 cm)')
    L.table(
      [
        { t: 'Viga/vão', w: 14 },
        { t: 'Seção', w: 11, align: 'c' },
        { t: 'As/face nec. (cm²)', w: 17, align: 'r' },
        { t: 'Barras por face', w: 16 },
        { t: 'As/face ef. (cm²)', w: 16, align: 'r' },
        { t: 'Espaç. vertical (cm)', w: 18, align: 'r' },
        { t: 'Comprimento (m)', w: 16, align: 'r' },
        { t: 'Total (barras)', w: 13, align: 'r' },
      ],
      skinBeams.map((b) => {
        const n = b.skin.n ?? 0
        const phi = b.skin.phi ?? 0.008
        return [
          `${b.beamName} v${b.spanIndex + 1}`,
          `${cmDim(b.section.bw)}×${cmDim(b.section.h)}`,
          cm2(b.skin.asPerFace),
          `${n} φ ${fmt(phi * 1000, 0)}`,
          cm2((n * Math.PI * phi * phi) / 4),
          fmt((b.skin.spacing ?? 0) * 100, 1),
          fmt(b.length, 2),
          String(2 * n),
        ]
      }),
      7.0,
    )
    L.para(
      '0,10 %·Ac,alma por face (limitado a 5 cm²/m), em barras de alta aderência distribuídas ' +
        'na altura da alma entre as armaduras principais, com espaçamento ≤ 20 cm e ancoradas ' +
        'nos apoios. Comprimento = vão teórico (acrescentar a ancoragem nos apoios).',
      7.8,
      'I',
      0.3,
    )
  }

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
      s.kind === 'nervurada'
        ? `${s.name} (nerv.)`
        : s.kind === 'trelicada'
          ? `${s.name} (trel.)`
          : s.name,
      s.levelName,
      cmDim(s.thickness),
      s.rectangular ? `${fmt(s.spanA, 2)}×${fmt(s.spanB, 2)}` : 'não ret.',
      s.design?.dirA.spanSpec ??
        s.gridDesign?.specX ??
        (s.latticeDesign
          ? s.latticeDesign.ribsAlongA
            ? `${s.latticeDesign.bars}/vig.`
            : `tela ${s.latticeDesign.mesh.name}`
          : s.ribbedDesign
            ? `${s.ribbedDesign.dirA.ribBars}/nerv.`
            : 'manual'),
      s.design?.dirB.spanSpec ??
        s.gridDesign?.specY ??
        (s.latticeDesign
          ? s.latticeDesign.ribsAlongA
            ? `tela ${s.latticeDesign.mesh.name}`
            : `${s.latticeDesign.bars}/vig.`
          : s.ribbedDesign
            ? `${s.ribbedDesign.dirB.ribBars}/nerv.`
            : '—'),
      s.latticeDesign
        ? s.latticeDesign.fixedEnds > 0
          ? s.latticeDesign.supportSpec
          : `${s.latticeDesign.negConstructiveSpec} (constr.)`
        : s.design
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
            : s.latticeDesign
              ? s.latticeDesign.deflectionOk
                ? 'OK'
                : s.latticeDesign.counterCamber > 0
                  ? 'contrafl.'
                  : 'excede'
              : '—',
      STATUS_TXT[s.status],
    ]),
    7.0,
  )
  const lattices = results.slabDesign.filter((s) => s.latticeDesign)
  if (lattices.length > 0) {
    L.h2('Lajes treliçadas — vigotas pré-fabricadas (NBR 14859 / NBR 6118)')
    L.table(
      [
        { t: 'Laje', w: 12 },
        { t: 'Composição', w: 19 },
        { t: 'Treliça', w: 14 },
        { t: 'Vão (m)', w: 10, align: 'r' },
        { t: 'g + q (kN/m²)', w: 17, align: 'c' },
        { t: 'Md+ /vig.', w: 13, align: 'r' },
        { t: 'As nec/ef (cm²)', w: 18, align: 'c' },
        { t: 'Armadura por vigota', w: 28 },
        { t: 'Vd / VRd (kN)', w: 17, align: 'c' },
        { t: 'Status', w: 10, align: 'c' },
      ],
      lattices.map((s) => {
        const d = s.latticeDesign!
        return [
          s.name,
          d.designation,
          d.truss,
          fmt(d.span, 2),
          `${fmt(d.g, 2)} + ${fmt(d.q, 2)}`,
          fmt(d.mdSpan, 2),
          `${cm2(d.asReq)} / ${cm2(d.asProvided)}`,
          d.bars,
          `${fmt(d.vd, 1)} / ${fmt(d.usesDiagonals ? d.vrd3 : d.vrd1, 1)}`,
          STATUS_TXT[s.status],
        ]
      }),
      7.0,
    )
    L.table(
      [
        { t: 'Laje', w: 12 },
        { t: 'Intereixo·bw·d (cm)', w: 24, align: 'c' },
        { t: 'Tela da capa', w: 14 },
        { t: 'Negativa (apoios)', w: 30 },
        { t: 'Flecha / lim. (cm)', w: 22, align: 'c' },
        { t: 'Contrafl. (cm)', w: 15, align: 'r' },
        { t: 'wk (mm)', w: 12, align: 'r' },
        { t: 'Reações g · q (kN/m)', w: 32, align: 'c' },
      ],
      lattices.map((s) => {
        const d = s.latticeDesign!
        return [
          s.name,
          `${cmDim(d.spacing)} · ${cmDim(d.bw)} · ${fmt(d.d * 100, 1)}`,
          d.mesh.name,
          d.fixedEnds > 0 ? d.supportSpec : `${d.negConstructiveSpec} (constr.)`,
          `${fmt(d.deflection * 100, 2)} / ${fmt(d.deflectionLimit * 100, 2)}`,
          d.counterCamber > 0 ? fmt(d.counterCamber * 100, 1) : '—',
          fmt(d.wk * 1000, 2),
          `${fmt(d.reactions.g[0], 1)}/${fmt(d.reactions.g[1], 1)} · ${fmt(d.reactions.q[0], 1)}/${fmt(d.reactions.q[1], 1)}`,
        ]
      }),
      7.0,
    )
    const negTxt = (e: LatticeNegativeEnd): string =>
      `${e.spec}${e.phi ? ` · ${e.count !== null ? `${e.count} barras de ` : ''}${fmt(e.length, 2)} m` : ''} (${e.kind}, ${fmt(e.reach, 2)} m no vão)`
    L.table(
      [
        { t: 'Laje', w: 9 },
        { t: 'Vigotas', w: 16 },
        { t: 'Adicional + (por vigota · total)', w: 30 },
        { t: 'Negativa — apoio inicial', w: 40 },
        { t: 'Negativa — apoio final', w: 40 },
        { t: 'Tela (m²)', w: 10, align: 'r' },
      ],
      lattices.map((s) => {
        const d = s.latticeDesign!
        const dt = d.detail
        return [
          s.name,
          `${dt.joists !== null ? `${dt.joists} × ` : ''}${fmt(dt.joistLength, 2)} m`,
          dt.extra
            ? `${dt.extra.n} φ${fmt(dt.extra.phi * 1000, dt.extra.phi * 1000 % 1 === 0 ? 0 : 1)} × ${fmt(dt.extra.length, 2)} m${dt.extra.total !== null ? ` · ${dt.extra.total} barras` : ''}`
            : 'treliça basta',
          negTxt(dt.negStart),
          negTxt(dt.negEnd),
          dt.meshArea !== null ? fmt(dt.meshArea, 1) : '—',
        ]
      }),
      6.6,
    )
    L.table(
      [
        { t: 'Laje', w: 9 },
        { t: 'Nervuras de travamento', w: 22 },
        { t: 'Seção (cm)', w: 12, align: 'c' },
        { t: 'Posição a partir do apoio (m)', w: 28 },
        { t: 'Armadura por nervura', w: 30 },
        { t: 'Comprimento (m)', w: 15, align: 'r' },
      ],
      lattices.map((s) => {
        const b = s.latticeDesign!.bracing
        return [
          s.name,
          b.count === 0
            ? b.recommended > 0
              ? `0 (recomendado ${b.recommended})`
              : 'dispensadas (vão ≤ 4 m)'
            : `${b.count}${b.auto ? ' (automático)' : ''}`,
          b.count > 0 ? `${cmDim(b.width)}×${cmDim(b.height)}` : '—',
          b.count > 0 ? b.positions.map((x) => fmt(x, 2)).join(' · ') : '—',
          b.count > 0 ? b.bars : '—',
          b.count > 0 && b.length !== null ? fmt(b.length, 2) : '—',
        ]
      }),
      7.0,
    )
    L.para(
      'Detalhamento p/ montagem: vigotas e barras adicionais com o comprimento do vão teórico ' +
        '(penetrar ≥ 5 cm em cada apoio). Negativas: por continuidade alcançam 0,25·ℓ + 1,5·d ' +
        '(§19.4.1) p/ dentro do vão; construtivas e de borda, 0,15·ℓ (§20.1); o comprimento da ' +
        'barra sobre apoio com laje vizinha é o dobro do alcance (ajustar se o vão vizinho ' +
        'for diferente). Nervuras transversais de travamento pelo critério usual (vão > 4 m: 1; ' +
        '> 6 m: 2), com armadura mínima da tab. 17.3 — obrigatórias sob cargas concentradas.',
      7.8,
      'I',
      0.3,
    )
    L.para(
      'Treliçadas: cada vigota é dimensionada como viga T (mesa = intereixo × capa) vencendo o vão ' +
        'entre as vigas de apoio; armadura positiva = banzo inferior da treliça (CA-60) + barras ' +
        'adicionais na sapata, em área equivalente CA-60. Cisalhamento por §19.4.1 (VRd1) e, se ' +
        'necessário, com as diagonais da treliça (§19.4.2). Flecha total com Branson + fluência ' +
        '(αf = 1,32) e wk na combinação frequente (§17.3.3.2). As reações características por ' +
        'metro de apoio (inicial/final) são as cargas aplicadas às vigas na análise global — ' +
        'bordas paralelas às vigotas não recebem carga da laje. Fase de montagem (escoramento) ' +
        'conforme o fabricante.',
      7.8,
      'I',
      0.3,
    )
  }
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
  // cargas concentradas/lineares sobre lajes (issue #8)
  const conc = results.slabDesign.filter((s) => s.concentrated)
  if (conc.length > 0) {
    L.h2('Lajes com cargas concentradas ou lineares')
    L.table(
      [
        { t: 'Laje', w: 9 },
        { t: 'Pav.', w: 16 },
        { t: 'Cargas', w: 20 },
        { t: 'G (kN)', w: 9, align: 'r' },
        { t: 'Q (kN)', w: 9, align: 'r' },
        { t: 'Efeito na laje', w: 37 },
        { t: 'Sit.', w: 8, align: 'c' },
      ],
      conc.map((s) => {
        const c = s.concentrated!
        const j = c.joist
        const effect = j
          ? j.spread
            ? `todas as vigotas: +${fmt(j.m, 2)} kN·m, +${fmt(j.v, 2)} kN · carga equiv. ×${fmt(c.factor, 2)}`
            : `vigota crítica: +${fmt(j.m, 2)} kN·m, +${fmt(j.v, 2)} kN · ${j.juxtaposed > 1 ? `${j.juxtaposed} justapostas` : 'sem reforço'}`
          : c.kx !== undefined
            ? `M ×${fmt(c.kx, 2)} (X) · ×${fmt(c.ky ?? 1, 2)} (Y) · flecha ×${fmt(c.kw ?? 1, 2)}`
            : 'não verificado (sem borda apoiada)'
        return [
          s.name,
          s.levelName,
          c.loads.map((l) => l.name).join(', '),
          fmt(c.totalG, 1),
          fmt(c.totalQ, 1),
          effect,
          s.status === 'ok' ? 'OK' : s.status === 'atencao' ? 'atenção' : 'FALHA',
        ]
      }),
      7.4,
    )
    const punch = conc.flatMap((s) => s.concentrated!.punching.map((p) => ({ s, p })))
    if (punch.length > 0) {
      L.table(
        [
          { t: 'Laje', w: 9 },
          { t: 'Carga', w: 12 },
          { t: 'Área (cm)', w: 12, align: 'c' },
          { t: 'FSd (kN)', w: 11, align: 'r' },
          { t: 'u1 (m)', w: 9, align: 'r' },
          { t: 'τSd (C′)', w: 11, align: 'r' },
          { t: 'τRd1', w: 10, align: 'r' },
          { t: 'τSd (C)', w: 11, align: 'r' },
          { t: 'τRd2', w: 10, align: 'r' },
          { t: 'Sit.', w: 13, align: 'c' },
        ],
        punch.map(({ s, p }) => [
          s.name,
          p.name,
          `${fmt(p.bx * 100, 0)}×${fmt(p.by * 100, 0)}`,
          fmt(p.fsd, 1),
          fmt(p.check.u1, 2),
          fmt(p.check.tauSd1, 0),
          fmt(p.check.tauRd1, 0),
          fmt(p.check.tauSd0, 0),
          fmt(p.check.tauRd2, 0),
          !p.check.okC ? 'FALHA' : p.check.needsShearReinf ? 'armar punção' : 'OK',
        ]),
        7.4,
      )
    }
    L.para(
      'Momentos e flecha: razão entre a grelha da laje com e sem as cargas concentradas (bordas ' +
        'apoiadas nos dois casos; pico sob a carga tomado numa faixa de 25 cm). Lajes pelo ' +
        'método de Marcus e nervuradas usam a maior razão como carga uniforme equivalente. ' +
        'Punção sob cargas pontuais: §19.5, contorno C′ a 2d da área carregada, tensões em kPa. ' +
        'Vigotas: esforços característicos adicionais na vigota sob a carga, biapoiada.',
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
        p.reinf
          ? `${p.reinf.lines}×${p.reinf.studsPerLine} φ${Math.round(p.reinf.phi * 1000)}`
          : p.check.needsShearReinf
            ? 'studs'
            : 'disp.',
        STATUS_TXT[
          !p.check.okC || (p.reinf && !p.reinf.ok)
            ? 'falha'
            : p.check.needsShearReinf
              ? 'atencao'
              : 'ok'
        ],
      ]),
      7.0,
    )
    L.para(
      'Contorno C (face do pilar): τSd ≤ τRd2 (esmagamento). Contorno C′ (2d): τSd ≤ τRd1 ' +
        'dispensa armadura; acima, os CONECTORES são dimensionados (coluna Arm.: linhas × ' +
        'conectores φ) por τRd3 (§19.5.3.3, α = 90°, s0 ≤ 0,5d, sr ≤ 0,75d, ≤ 2d na linha) e ' +
        'estendidos até o contorno C″ dispensar (§19.5.3.4). Pilares de borda/canto: perímetro ' +
        'REDUZIDO u* e MSd corrigido por e* com K da tab. 19.2 (§19.5.2); MSd desbalanceado ' +
        'tomado da envoltória do pórtico. Colapso progressivo (§19.5.4): prever armadura ' +
        'inferior atravessando cada pilar com fyd·As ≥ 1,5·FSd (valores nas notas da laje), ' +
        'ancorada além de C′.',
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

  // ------------------------------------------- anexo: memória por elemento
  if (detailed) appendDetailedMemorial(L, project, results, opts)

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
