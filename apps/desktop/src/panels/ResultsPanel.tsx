import { Fragment, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import {
  CONCRETE_CLASSES,
  COVER_BY_CAA,
  comboReactions,
  polygonArea,
  type AnalysisResults,
  type BeamSpanDesign,
  type GammaZResult,
  type Project,
  type Reaction,
  type SlabDesignOutput,
} from '@hyperframe/engine'
import { useStore, type ResultsTab } from '../store'
import { cm, cm2, fmt, fmtCmDim, ROMAN } from './format'
import { IconClose, IconPrint } from '../components/Icons'
import PranchasPanel from '../drawings/PranchasPanel'

// ---------------------------------------------------------------------------
// helpers compartilhados do painel
// ---------------------------------------------------------------------------

const TABS: [ResultsTab, string][] = [
  ['estabilidade', 'Estabilidade'],
  ['vigas', 'Vigas'],
  ['pilares', 'Pilares'],
  ['lajes', 'Lajes'],
  ['fundacoes', 'Fundações'],
  ['reacoes', 'Reações'],
  ['quantitativos', 'Quantitativos'],
  ['pranchas', 'Pranchas'],
  ['relatorio', 'Relatório'],
]

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: 0.8,
        color: 'var(--text-dim)',
        margin: '16px 0 8px',
      }}
    >
      {children}
    </div>
  )
}

function Footnote({ children }: { children: ReactNode }) {
  return (
    <div className="faint" style={{ fontSize: 11, margin: '12px 0 4px', lineHeight: 1.5 }}>
      {children}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div className="faint" style={{ padding: '8px 0', fontSize: 12 }}>
      {text}
    </div>
  )
}

function StatusChip({ s }: { s: 'ok' | 'atencao' | 'falha' }) {
  if (s === 'ok') return <span className="chip ok">OK</span>
  if (s === 'atencao') return <span className="chip warn">Atenção</span>
  return <span className="chip err">Falha</span>
}

const STATUS_TEXT: Record<'ok' | 'atencao' | 'falha', string> = {
  ok: 'OK',
  atencao: 'Atenção',
  falha: 'FALHA',
}

const GAMMAZ_TEXT: Record<GammaZResult['classification'], string> = {
  'nos-fixos': 'Nós fixos (γz ≤ 1,10)',
  'nos-moveis': 'Nós móveis — majorar esforços horizontais por γz',
  invalido: 'γz > 1,30 — estrutura instável/rever',
}

function GammaZChip({ c }: { c: GammaZResult['classification'] }) {
  const cls = c === 'nos-fixos' ? 'chip ok' : c === 'nos-moveis' ? 'chip warn' : 'chip err'
  return <span className={cls}>{GAMMAZ_TEXT[c]}</span>
}

/** ordena por nome em ordem natural pt-BR (P1, P2, … P10) */
function byName<T extends { name: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }))
}

/** φ em m → rótulo em mm ("8", "12,5") */
function fmtPhi(phiM: number): string {
  const mm = Math.round(phiM * 10000) / 10
  return fmt(mm, Number.isInteger(mm) ? 0 : 1)
}

/** utilização em % → cor do texto */
function utilColor(pct: number): string {
  return pct <= 80 ? 'var(--ok)' : pct <= 100 ? 'var(--warn)' : 'var(--err)'
}

/** armaduras negativas de laje (só onde há engaste) */
function slabNegatives(d: SlabDesignOutput): string {
  const parts: string[] = []
  if (d.dirA.mSupportD > 0) parts.push(`A: ${d.dirA.supportSpec}`)
  if (d.dirB.mSupportD > 0) parts.push(`B: ${d.dirB.supportSpec}`)
  return parts.length > 0 ? parts.join(' · ') : '—'
}

/** condição de apoio das faixas ("A: 2 engastes · B: 1") */
function slabSupports(d: SlabDesignOutput): string {
  const a = d.dirA.fixedEnds
  const b = d.dirB.fixedEnds
  return `A: ${a} ${a === 1 ? 'engaste' : 'engastes'} · B: ${b}`
}

/** agrupa vãos por viga, em ordem natural (V1, V2, … V10) */
function beamGroups(results: AnalysisResults): [string, BeamSpanDesign[]][] {
  const map = new Map<string, BeamSpanDesign[]>()
  for (const d of results.beamDesign) {
    const arr = map.get(d.beamName)
    if (arr) arr.push(d)
    else map.set(d.beamName, [d])
  }
  const groups = [...map.entries()]
  groups.sort((a, b) => a[0].localeCompare(b[0], 'pt-BR', { numeric: true }))
  for (const [, spans] of groups) spans.sort((x, y) => x.spanIndex - y.spanIndex)
  return groups
}

// ---------------------------------------------------------------------------
// aba: estabilidade
// ---------------------------------------------------------------------------

function EstabilidadeTab({ results, project }: { results: AnalysisResults; project: Project }) {
  const st = results.stability
  const sr = project.settings.stiffnessReduction

  return (
    <>
      <SectionTitle>Coeficiente γz (NBR 6118 §15.5.3)</SectionTitle>
      {st.gammaZ.length === 0 ? (
        <Empty text="Sem resultados de γz — ação horizontal (vento) desabilitada?" />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Direção</th>
              <th>Combinação</th>
              <th>M1,d (kN·m)</th>
              <th>ΔM,d (kN·m)</th>
              <th>γz</th>
              <th>Classificação</th>
            </tr>
          </thead>
          <tbody>
            {st.gammaZ.map((g) => (
              <tr key={`${g.dir}-${g.comboId}`}>
                <td>{g.dir}</td>
                <td style={{ fontFamily: 'var(--sans)' }}>{g.comboLabel}</td>
                <td>{fmt(g.m1, 1)}</td>
                <td>{fmt(g.deltaM, 1)}</td>
                <td style={{ fontWeight: 700 }}>{fmt(g.value, 3)}</td>
                <td>
                  <GammaZChip c={g.classification} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <SectionTitle>Parâmetro de instabilidade α (§15.5.2)</SectionTitle>
      {st.alpha.length === 0 ? (
        <Empty text="Sem resultados do parâmetro α." />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Direção</th>
              <th>α</th>
              <th>α1 (limite)</th>
              <th>EI equivalente (kN·m²)</th>
              <th>Verificação</th>
            </tr>
          </thead>
          <tbody>
            {st.alpha.map((a) => (
              <tr key={a.dir}>
                <td>{a.dir.toUpperCase()}</td>
                <td style={{ fontWeight: 700 }}>{fmt(a.value, 3)}</td>
                <td>{fmt(a.limit, 3)}</td>
                <td>{fmt(a.eiEq, 0)}</td>
                <td>
                  {a.ok ? (
                    <span className="chip ok">α ≤ α1 — nós fixos</span>
                  ) : (
                    <span className="chip err">α &gt; α1 — efeitos de 2ª ordem</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <SectionTitle>Deslocamentos laterais (ELS vento — tab. 13.3)</SectionTitle>
      {st.drift.length === 0 ? (
        <Empty text="Sem resultados de deslocamento lateral." />
      ) : (
        st.drift.map((d) => (
          <div key={`${d.comboId}-${d.dir}`} style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 6px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                {d.comboLabel} — direção {d.dir}
              </span>
              {d.topDisp <= d.topLimit ? (
                <span className="chip ok">
                  topo δ = {fmt(d.topDisp * 100, 2)} cm ≤ H/1700 = {fmt(d.topLimit * 100, 2)} cm
                </span>
              ) : (
                <span className="chip err">
                  topo δ = {fmt(d.topDisp * 100, 2)} cm &gt; H/1700 = {fmt(d.topLimit * 100, 2)} cm
                </span>
              )}
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Pavimento</th>
                  <th>δ (cm)</th>
                  <th>δ relativo (cm)</th>
                  <th>Limite hi/850 (cm)</th>
                  <th>Verificação</th>
                </tr>
              </thead>
              <tbody>
                {d.stories.map((s) => (
                  <tr key={s.levelIndex}>
                    <td style={{ fontFamily: 'var(--sans)' }}>{s.levelName}</td>
                    <td>{fmt(s.disp * 100, 2)}</td>
                    <td>{fmt(s.rel * 100, 2)}</td>
                    <td>{fmt(s.relLimit * 100, 2)}</td>
                    <td>
                      {s.ok ? (
                        <span className="chip ok">OK</span>
                      ) : (
                        <span className="chip err">excede</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}

      <Footnote>
        Análise ELU com rigidez reduzida (vigas {fmt(sr.beams, 1)}·EI, pilares {fmt(sr.columns, 1)}
        ·EI) conforme §15.7.3; ELS com EI integral.
      </Footnote>
    </>
  )
}

// ---------------------------------------------------------------------------
// aba: vigas
// ---------------------------------------------------------------------------

function VigasTab({ results }: { results: AnalysisResults }) {
  const groups = useMemo(() => beamGroups(results), [results])
  const service = useMemo(
    () =>
      [...results.beamService].sort(
        (a, b) =>
          a.beamName.localeCompare(b.beamName, 'pt-BR', { numeric: true }) ||
          a.spanIndex - b.spanIndex,
      ),
    [results],
  )

  if (groups.length === 0) return <Empty text="Nenhuma viga dimensionada." />

  return (
    <>
      <table className="table">
        <thead>
          <tr>
            <th>Vão</th>
            <th>L (m)</th>
            <th>Seção (cm)</th>
            <th>Md+ (kN·m)</th>
            <th>As+ (cm²)</th>
            <th>Barras +</th>
            <th>Md− esq/dir (kN·m)</th>
            <th>As− esq/dir (cm²)</th>
            <th>Barras −</th>
            <th>Vd (kN)</th>
            <th>Estribos</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(([name, spans]) => (
            <Fragment key={name}>
              <tr>
                <td
                  colSpan={12}
                  style={{
                    background: 'var(--bg-2)',
                    color: 'var(--accent)',
                    fontWeight: 700,
                    fontFamily: 'var(--sans)',
                  }}
                >
                  {name} · {spans.length} {spans.length === 1 ? 'vão' : 'vãos'}
                </td>
              </tr>
              {spans.map((d) => {
                const notes = [d.positive.note, d.negLeft?.note, d.negRight?.note, d.shear.note]
                  .filter(Boolean)
                  .join(' · ')
                return (
                  <tr key={`${d.beamId}-${d.spanIndex}`} title={notes || undefined}>
                    <td>{d.spanIndex + 1}</td>
                    <td>{fmt(d.length, 2)}</td>
                    <td>
                      {fmtCmDim(d.section.bw)}×{fmtCmDim(d.section.h)}
                    </td>
                    <td>{fmt(d.positive.md, 1)}</td>
                    <td>{fmt(cm2(d.positive.as), 2)}</td>
                    <td>{d.positive.bars || '—'}</td>
                    <td>
                      {d.negLeft ? fmt(d.negLeft.md, 1) : '—'} /{' '}
                      {d.negRight ? fmt(d.negRight.md, 1) : '—'}
                    </td>
                    <td>
                      {d.negLeft ? fmt(cm2(d.negLeft.as), 2) : '—'} /{' '}
                      {d.negRight ? fmt(cm2(d.negRight.as), 2) : '—'}
                    </td>
                    <td>
                      {d.negLeft?.bars ?? '—'} / {d.negRight?.bars ?? '—'}
                    </td>
                    <td>{fmt(d.shear.vd, 1)}</td>
                    <td>{d.shear.spec}</td>
                    <td>
                      <StatusChip s={d.status} />
                    </td>
                  </tr>
                )
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
      <Footnote>
        Flexão simples + cisalhamento (modelo I) por vão, envoltória ELU. Passe o mouse sobre a
        linha para ver as observações do dimensionamento.
      </Footnote>

      <SectionTitle>Flechas em serviço (QP)</SectionTitle>
      {service.length === 0 ? (
        <Empty text="Sem verificação de flechas em serviço." />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Viga</th>
              <th>Vão</th>
              <th>L (m)</th>
              <th>δ elástica (mm)</th>
              <th>Fator fissuração</th>
              <th>δ total (mm)</th>
              <th>Limite L/250 (mm)</th>
              <th>Verificação</th>
            </tr>
          </thead>
          <tbody>
            {service.map((b) => (
              <tr key={`${b.beamId}-${b.spanIndex}`}>
                <td style={{ fontWeight: 600 }}>{b.beamName}</td>
                <td>{b.spanIndex + 1}</td>
                <td>{fmt(b.length, 2)}</td>
                <td>{fmt(b.deltaElastic * 1000, 2)}</td>
                <td>{fmt(b.crackFactor, 2)}</td>
                <td style={{ fontWeight: 700 }}>{fmt(b.deltaTotal * 1000, 2)}</td>
                <td>{fmt(b.limit * 1000, 2)}</td>
                <td>
                  {b.ok ? (
                    <span className="chip ok">OK</span>
                  ) : (
                    <span className="chip err">excede</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Footnote>
        Flecha total = elástica (ELS quase-permanente, EI íntegro) × fator de fissuração (Branson)
        × (1 + αf de fluência).
      </Footnote>
    </>
  )
}

// ---------------------------------------------------------------------------
// aba: pilares
// ---------------------------------------------------------------------------

function PilaresTab({ results }: { results: AnalysisResults }) {
  const items = useMemo(() => byName(results.columnDesign), [results])

  if (items.length === 0) return <Empty text="Nenhum pilar dimensionado." />

  return (
    <>
      <table className="table">
        <thead>
          <tr>
            <th>Pilar</th>
            <th>Seção (cm)</th>
            <th>Nd (kN)</th>
            <th title="u ao longo de bw · v ao longo de h">Md,u / Md,v (kN·m)</th>
            <th>ν</th>
            <th>λ</th>
            <th>As (cm²)</th>
            <th>ρ (%)</th>
            <th>Barras</th>
            <th>Estribo</th>
            <th>Utilização</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => {
            const lambda = Math.max(c.lambdaU, c.lambdaV)
            const utilPct = c.utilization * 100
            const title = [...c.notes, c.governing ? `governante: ${c.governing}` : '']
              .filter(Boolean)
              .join(' · ')
            return (
              <tr key={c.columnId} title={title || undefined}>
                <td style={{ fontWeight: 600 }}>{c.name}</td>
                <td>
                  {fmtCmDim(c.section.bw)}×{fmtCmDim(c.section.h)}
                </td>
                <td>{fmt(c.nd, 0)}</td>
                <td>
                  {fmt(c.mdU, 1)} / {fmt(c.mdV, 1)}
                </td>
                <td>{fmt(c.nu, 2)}</td>
                <td>
                  {fmt(lambda, 1)}
                  {c.needsRigorous && (
                    <span
                      style={{ color: 'var(--warn)', marginLeft: 4 }}
                      title="λ > 90 — exige método rigoroso com curvatura real"
                    >
                      ⚠
                    </span>
                  )}
                </td>
                <td>{fmt(cm2(c.as), 2)}</td>
                <td>{fmt(c.rho * 100, 2)}</td>
                <td>{c.bars || '—'}</td>
                <td>{c.stirrupSpec}</td>
                <td style={{ fontWeight: 700, color: utilColor(utilPct) }}>
                  {Number.isFinite(utilPct) ? `${fmt(utilPct, 0)}%` : '—'}
                </td>
                <td>
                  <StatusChip s={c.status} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <Footnote>
        Flexo-compressão oblíqua por integração da seção (bloco retangular) + pilar-padrão com
        curvatura aproximada (§15.8.3.3.2). Passe o mouse sobre a linha para ver as observações e
        a combinação governante.
      </Footnote>
    </>
  )
}

// ---------------------------------------------------------------------------
// aba: lajes
// ---------------------------------------------------------------------------

function LajesTab({ results }: { results: AnalysisResults }) {
  const items = useMemo(
    () =>
      [...results.slabDesign].sort(
        (a, b) =>
          a.levelName.localeCompare(b.levelName, 'pt-BR', { numeric: true }) ||
          a.name.localeCompare(b.name, 'pt-BR', { numeric: true }),
      ),
    [results],
  )

  if (items.length === 0) return <Empty text="Nenhuma laje no modelo." />

  return (
    <>
      <table className="table">
        <thead>
          <tr>
            <th>Laje</th>
            <th>Pavimento</th>
            <th>lx×ly (m)</th>
            <th>h (cm)</th>
            <th>Apoios</th>
            <th>Md vão A/B (kN·m/m)</th>
            <th>As A/B (cm²/m)</th>
            <th>Malha A/B</th>
            <th>Negativos</th>
            <th>Flecha (mm)</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((s) => {
            const d = s.design
            const title = s.notes.length > 0 ? s.notes.join(' · ') : undefined
            return (
              <tr key={s.slabId} title={title}>
                <td style={{ fontWeight: 600 }}>{s.name}</td>
                <td style={{ fontFamily: 'var(--sans)' }}>{s.levelName}</td>
                <td>
                  {fmt(s.spanA, 2)}×{fmt(s.spanB, 2)}
                </td>
                <td>{fmtCmDim(s.thickness)}</td>
                {d ? (
                  <>
                    <td>{slabSupports(d)}</td>
                    <td>
                      {fmt(d.dirA.mSpanD, 1)} / {fmt(d.dirB.mSpanD, 1)}
                    </td>
                    <td>
                      {fmt(cm2(d.dirA.asSpan), 2)} / {fmt(cm2(d.dirB.asSpan), 2)}
                    </td>
                    <td>
                      {d.dirA.spanSpec} / {d.dirB.spanSpec}
                    </td>
                    <td>{slabNegatives(d)}</td>
                    <td>
                      <span className={`chip ${d.deflectionOk ? 'ok' : 'err'}`}>
                        {fmt(d.deflection * 1000, 1)} {d.deflectionOk ? '≤' : '>'}{' '}
                        {fmt(d.deflectionLimit * 1000, 1)}
                      </span>
                    </td>
                  </>
                ) : (
                  <td colSpan={6} className="faint">
                    manual — {s.notes.join(' · ') || 'laje não retangular: dimensionar à parte'}
                  </td>
                )}
                <td>
                  <StatusChip s={s.status} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <Footnote>
        Marcus sem redução por torção (a favor da segurança); flecha com Branson + fluência
        (αf=1,32).
      </Footnote>
    </>
  )
}

// ---------------------------------------------------------------------------
// aba: fundações
// ---------------------------------------------------------------------------

function FundacoesTab({ results, project }: { results: AnalysisResults; project: Project }) {
  const items = useMemo(() => byName(results.foundations), [results])
  const soil = project.settings.soil

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          margin: '4px 0 10px',
          fontSize: 12,
        }}
      >
        <span>
          Solo: <strong>{soil.label}</strong> — σadm = {fmt(soil.sigmaAdm, 0)} kPa
        </span>
        <span className="chip warn">
          ⚠ valores orientativos — projeto exige sondagem SPT (NBR 6122)
        </span>
      </div>

      {items.length === 0 ? (
        <Empty text="Nenhuma sapata dimensionada." />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Pilar</th>
              <th>Nserv (kN)</th>
              <th>Sapata a×b (m)</th>
              <th>h (m)</th>
              <th>σ (kPa)</th>
              <th>σmax (kPa)</th>
              <th>e no núcleo?</th>
              <th>As dir A</th>
              <th>As dir B</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((f) => {
              const ft = f.footing
              return (
                <tr key={f.columnId} title={ft.notes.join(' · ') || undefined}>
                  <td style={{ fontWeight: 600 }}>{f.name}</td>
                  <td>{fmt(f.nServ, 0)}</td>
                  <td>
                    {fmt(ft.a, 2)}×{fmt(ft.b, 2)}
                  </td>
                  <td>{fmt(ft.h, 2)}</td>
                  <td>{fmt(ft.sigma, 0)}</td>
                  <td>{fmt(ft.sigmaMax, 0)}</td>
                  <td>
                    {ft.insideKern ? (
                      <span className="chip ok">sim</span>
                    ) : (
                      <span className="chip warn">não</span>
                    )}
                  </td>
                  <td>{ft.specA}</td>
                  <td>{ft.specB}</td>
                  <td>
                    <StatusChip s={f.status} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <Footnote>
        Sapatas rígidas isoladas — armadura pelo método das bielas (CG do pilar), tensões de
        serviço com excentricidade (NBR 6118 §22.6 + NBR 6122).
      </Footnote>
    </>
  )
}

// ---------------------------------------------------------------------------
// aba: reações
// ---------------------------------------------------------------------------

function ReacoesTab({ results, project }: { results: AnalysisResults; project: Project }) {
  const eluCombos = useMemo(() => results.combos.filter((c) => c.type === 'ELU'), [results])
  const [comboId, setComboId] = useState(eluCombos[0]?.id ?? '')
  // se os resultados forem regenerados, o id selecionado pode não existir mais
  const effectiveId = eluCombos.some((c) => c.id === comboId)
    ? comboId
    : eluCombos[0]?.id ?? ''

  const reactions = useMemo<Reaction[] | null>(() => {
    if (!effectiveId) return null
    try {
      return comboReactions(results, effectiveId)
    } catch {
      return null
    }
  }, [results, effectiveId])

  const rows = useMemo(() => {
    if (!reactions) return null
    const list = reactions.map((r) => {
      const node = results.model.nodes.find((n) => n.id === r.nodeId)
      const col = node
        ? project.columns.find((c) => Math.hypot(c.pos.x - node.x, c.pos.y - node.y) < 0.1)
        : undefined
      return { r, x: node?.x ?? NaN, y: node?.y ?? NaN, name: col?.name ?? '—' }
    })
    list.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }))
    return list
  }, [reactions, results, project])

  if (eluCombos.length === 0) return <Empty text="Nenhuma combinação ELU disponível." />

  const sum = reactions?.reduce(
    (a, r) => ({ fx: a.fx + r.fx, fy: a.fy + r.fy, fz: a.fz + r.fz }),
    { fx: 0, fy: 0, fz: 0 },
  )

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span className="label" style={{ margin: 0 }}>
          Combinação ELU
        </span>
        <select
          className="select"
          style={{ minWidth: 280 }}
          value={effectiveId}
          onChange={(e) => setComboId(e.target.value)}
        >
          {eluCombos.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      {!rows ? (
        <Empty text="Reações indisponíveis para esta combinação." />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Nó</th>
              <th>Pilar</th>
              <th>x (m)</th>
              <th>y (m)</th>
              <th>Fz (kN)</th>
              <th>Fx (kN)</th>
              <th>Fy (kN)</th>
              <th>Mx (kN·m)</th>
              <th>My (kN·m)</th>
              <th>Mz (kN·m)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ r, x, y, name }) => (
              <tr key={r.nodeId}>
                <td>{r.nodeId}</td>
                <td style={{ fontWeight: 600 }}>{name}</td>
                <td>{fmt(x, 2)}</td>
                <td>{fmt(y, 2)}</td>
                <td style={{ fontWeight: 600 }}>{fmt(r.fz, 1)}</td>
                <td>{fmt(r.fx, 1)}</td>
                <td>{fmt(r.fy, 1)}</td>
                <td>{fmt(r.mx, 1)}</td>
                <td>{fmt(r.my, 1)}</td>
                <td>{fmt(r.mz, 1)}</td>
              </tr>
            ))}
          </tbody>
          {sum && (
            <tfoot>
              <tr>
                <td
                  colSpan={4}
                  style={{ fontWeight: 700, borderTop: '2px solid var(--border-strong)' }}
                >
                  Σ
                </td>
                <td style={{ fontWeight: 700, borderTop: '2px solid var(--border-strong)' }}>
                  {fmt(sum.fz, 1)}
                </td>
                <td style={{ fontWeight: 700, borderTop: '2px solid var(--border-strong)' }}>
                  {fmt(sum.fx, 1)}
                </td>
                <td style={{ fontWeight: 700, borderTop: '2px solid var(--border-strong)' }}>
                  {fmt(sum.fy, 1)}
                </td>
                <td style={{ borderTop: '2px solid var(--border-strong)' }}>—</td>
                <td style={{ borderTop: '2px solid var(--border-strong)' }}>—</td>
                <td style={{ borderTop: '2px solid var(--border-strong)' }}>—</td>
              </tr>
            </tfoot>
          )}
        </table>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// aba: quantitativos
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  unit,
  sub,
}: {
  label: string
  value: string
  unit?: string
  sub?: string
}) {
  return (
    <div style={{ background: 'var(--bg-2)', borderRadius: 8, padding: 14 }}>
      <div
        style={{
          fontSize: 10.5,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          color: 'var(--text-dim)',
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div style={{ marginTop: 6 }}>
        <span className="mono" style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent)' }}>
          {value}
        </span>
        {unit && (
          <span className="muted" style={{ fontSize: 12, marginLeft: 5 }}>
            {unit}
          </span>
        )}
      </div>
      {sub && (
        <div className="faint" style={{ fontSize: 11, marginTop: 5, lineHeight: 1.4 }}>
          {sub}
        </div>
      )}
    </div>
  )
}

/** área aproximada = Σ áreas de laje por pavimento (todos os níveis com planta) */
function approxArea(project: Project): number {
  const byPlan = new Map<string, number>()
  for (const pl of project.plans) {
    byPlan.set(
      pl.id,
      pl.slabs.reduce((a, s) => a + polygonArea(s.polygon), 0),
    )
  }
  return project.levels.reduce(
    (a, l) => a + (l.planId ? byPlan.get(l.planId) ?? 0 : 0),
    0,
  )
}

function QuantitativosTab({ results, project }: { results: AnalysisResults; project: Project }) {
  const q = results.quantities
  const steel = results.detailing.steel
  const area = useMemo(() => approxArea(project), [project])

  return (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(190px, 1fr))',
          gap: 12,
          maxWidth: 980,
        }}
      >
        <StatCard
          label="Concreto total"
          value={fmt(q.concrete.total, 1)}
          unit="m³"
          sub={`pilares ${fmt(q.concrete.columns, 1)} · vigas ${fmt(q.concrete.beams, 1)} · lajes ${fmt(q.concrete.slabs, 1)} m³`}
        />
        <StatCard
          label="Forma"
          value={fmt(q.formwork, 0)}
          unit="m²"
          sub="área de contato estimada"
        />
        <StatCard
          label="Aço total"
          value={fmt(q.steel.total, 0)}
          unit="kg"
          sub={`vigas (dim.) ${fmt(q.steel.beamsDesigned, 0)} · pilares (dim.) ${fmt(q.steel.columnsEstimated, 0)} · lajes (malhas dim.) ${fmt(q.steel.slabsEstimated, 0)} kg`}
        />
        <StatCard
          label="Taxa de aço"
          value={fmt(q.steel.ratePerM3, 1)}
          unit="kg/m³"
          sub="massa de aço / volume de concreto"
        />
        <StatCard
          label="Área construída aprox."
          value={fmt(area, 0)}
          unit="m²"
          sub="Σ áreas de laje por pavimento"
        />
        <StatCard
          label="Aço por área"
          value={area > 0 ? fmt(q.steel.total / area, 1) : '—'}
          unit="kg/m²"
          sub="indicador p/ orçamento preliminar"
        />
      </div>

      <SectionTitle>Resumo do aço por bitola</SectionTitle>
      {steel.byPhi.length === 0 ? (
        <Empty text="Sem tabela de aço — detalhamento indisponível." />
      ) : (
        <table className="table" style={{ maxWidth: 380 }}>
          <thead>
            <tr>
              <th>φ (mm)</th>
              <th>Massa (kg)</th>
            </tr>
          </thead>
          <tbody>
            {steel.byPhi.map((r) => (
              <tr key={r.phi}>
                <td>φ {fmtPhi(r.phi)}</td>
                <td>{fmt(r.kg, 1)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td style={{ fontWeight: 700, borderTop: '2px solid var(--border-strong)' }}>
                Total
              </td>
              <td style={{ fontWeight: 700, borderTop: '2px solid var(--border-strong)' }}>
                {fmt(steel.totalKg, 1)}
              </td>
            </tr>
            <tr>
              <td>Total c/ perdas (10%)</td>
              <td style={{ fontWeight: 700 }}>{fmt(steel.totalWithWaste, 1)}</td>
            </tr>
          </tfoot>
        </table>
      )}

      <Footnote>
        Aço de vigas e pilares dimensionado (detalhamento preliminar); lajes com malhas
        dimensionadas pelo método de Marcus. Valores para orçamento preliminar.
      </Footnote>
    </>
  )
}

// ---------------------------------------------------------------------------
// aba: relatório (imprimível)
// ---------------------------------------------------------------------------

const PRINT_CSS = `@media print { body * { visibility: hidden; } .print-root, .print-root * { visibility: visible; } .print-root { position: fixed; inset: 0; overflow: visible; border-radius: 0; } }`

const AGG_LABEL: Record<string, string> = {
  basalto: 'basalto',
  granito: 'granito',
  calcario: 'calcário',
  arenito: 'arenito',
}

const DIR_LABEL: Record<string, string> = { XP: 'X+', XN: 'X−', YP: 'Y+', YN: 'Y−' }

const rH3: CSSProperties = {
  fontSize: 13.5,
  fontWeight: 700,
  margin: '20px 0 6px',
  borderBottom: '1px solid #bbb',
  paddingBottom: 3,
}
const rTable: CSSProperties = { width: '100%', borderCollapse: 'collapse', margin: '6px 0 10px' }
const rTh: CSSProperties = {
  textAlign: 'left',
  fontSize: 9.5,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: '#555',
  borderBottom: '1.5px solid #888',
  padding: '3px 6px',
}
const rTd: CSSProperties = {
  fontSize: 11,
  padding: '3px 6px',
  borderBottom: '1px solid #ddd',
  fontFamily: 'var(--mono)',
}

function Dl({ rows }: { rows: [string, string][] }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '170px 1fr',
        rowGap: 3,
        columnGap: 10,
        fontSize: 11.5,
        margin: '6px 0 10px',
      }}
    >
      {rows.map(([k, v]) => (
        <Fragment key={k}>
          <div style={{ color: '#555' }}>{k}</div>
          <div>{v}</div>
        </Fragment>
      ))}
    </div>
  )
}

function RelatorioTab({ results, project }: { results: AnalysisResults; project: Project }) {
  const s = project.settings
  const floors = project.levels.filter((l) => l.planId !== null).length
  const height = project.levels[project.levels.length - 1]?.elevation ?? 0
  const concreteLabel =
    CONCRETE_CLASSES.find((c) => c.fck === s.concrete.fck)?.label ??
    `fck ${fmt(s.concrete.fck / 1000, 0)} MPa`
  const cover = COVER_BY_CAA[s.caa]
  const q = results.quantities
  const steel = results.detailing.steel
  const groups = useMemo(() => beamGroups(results), [results])
  const cols = useMemo(() => byName(results.columnDesign), [results])
  const slabs = useMemo(
    () =>
      [...results.slabDesign].sort(
        (a, b) =>
          a.levelName.localeCompare(b.levelName, 'pt-BR', { numeric: true }) ||
          a.name.localeCompare(b.name, 'pt-BR', { numeric: true }),
      ),
    [results],
  )
  const footings = useMemo(() => byName(results.foundations), [results])
  const wind = results.model.wind
  const today = new Date().toLocaleDateString('pt-BR')

  return (
    <>
      <style>{PRINT_CSS}</style>

      <div className="no-print" style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
        <button className="btn btn-primary" onClick={() => window.print()}>
          <IconPrint size={14} />
          Imprimir / Salvar PDF
        </button>
      </div>

      <div
        className="print-root"
        style={{
          background: '#fff',
          color: '#111',
          padding: 32,
          borderRadius: 8,
          maxWidth: 800,
          margin: '0 auto',
        }}
      >
        {/* cabeçalho */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            borderBottom: '2px solid #111',
            paddingBottom: 8,
          }}
        >
          <div>
            <div style={{ fontSize: 17, fontWeight: 800 }}>
              HyperFrame — Memória de Cálculo (Resumo)
            </div>
            <div style={{ fontSize: 12.5, marginTop: 3, fontWeight: 600 }}>{project.name}</div>
          </div>
          <div style={{ fontSize: 10.5, textAlign: 'right', color: '#444' }}>
            {project.author && <div>Autor: {project.author}</div>}
            {project.city && <div>{project.city}</div>}
            <div>{today}</div>
          </div>
        </div>

        {/* 1 — dados */}
        <h3 style={rH3}>1. Dados do projeto</h3>
        <Dl
          rows={[
            ['Pavimentos', `${floors} (altura total ${fmt(height, 2)} m)`],
            [
              'Concreto',
              `${concreteLabel} — agregado ${AGG_LABEL[s.concrete.aggregate] ?? s.concrete.aggregate} — γc ${fmt(s.concrete.gammaC, 2)}`,
            ],
            ['Aço', `CA-50 (fyk 500 MPa · γs ${fmt(s.steel.gammaS, 2)})`],
            [
              'CAA / cobrimentos',
              `${s.caa} — laje ${fmt(cm(cover.slab), 1)} cm · viga ${fmt(cm(cover.beam), 1)} cm · pilar ${fmt(cm(cover.column), 1)} cm`,
            ],
            [
              'Rigidez (ELU global)',
              `vigas ${fmt(s.stiffnessReduction.beams, 1)}·EI · pilares ${fmt(s.stiffnessReduction.columns, 1)}·EI (NBR 6118 §15.7.3)`,
            ],
            [
              'Modelo',
              `${results.model.stats.nodes} nós · ${results.model.stats.members} barras · ${results.model.stats.dofs} GDL`,
            ],
          ]}
        />

        {/* 2 — vento */}
        <h3 style={rH3}>2. Vento (NBR 6123)</h3>
        {s.wind.enabled && wind ? (
          <>
            <Dl
              rows={[
                [
                  'Parâmetros',
                  `V0 = ${fmt(s.wind.v0, 0)} m/s · S1 = ${fmt(s.wind.s1, 2)} · categoria ${ROMAN[s.wind.category - 1]} · classe ${s.wind.windClass} · grupo ${s.wind.s3Group} (S3)`,
                ],
              ]}
            />
            <table style={rTable}>
              <thead>
                <tr>
                  <th style={rTh}>Direção</th>
                  <th style={rTh}>Ca</th>
                  <th style={rTh}>Largura de fachada (m)</th>
                  <th style={rTh}>Força total (kN)</th>
                </tr>
              </thead>
              <tbody>
                {wind.map((w) => (
                  <tr key={w.dir}>
                    <td style={rTd}>{DIR_LABEL[w.dir] ?? w.dir}</td>
                    <td style={rTd}>{fmt(w.ca, 2)}</td>
                    <td style={rTd}>{fmt(w.facadeWidth, 2)}</td>
                    <td style={rTd}>{fmt(w.totalForce, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p style={{ fontSize: 11.5, margin: '6px 0 10px' }}>Ação do vento desconsiderada.</p>
        )}

        {/* 3 — estabilidade */}
        <h3 style={rH3}>3. Estabilidade global</h3>
        {results.stability.gammaZ.length > 0 && (
          <table style={rTable}>
            <thead>
              <tr>
                <th style={rTh}>Direção</th>
                <th style={rTh}>Combinação</th>
                <th style={rTh}>γz</th>
                <th style={rTh}>Classificação</th>
              </tr>
            </thead>
            <tbody>
              {results.stability.gammaZ.map((g) => (
                <tr key={`${g.dir}-${g.comboId}`}>
                  <td style={rTd}>{g.dir}</td>
                  <td style={{ ...rTd, fontFamily: 'inherit' }}>{g.comboLabel}</td>
                  <td style={{ ...rTd, fontWeight: 700 }}>{fmt(g.value, 3)}</td>
                  <td style={{ ...rTd, fontFamily: 'inherit' }}>{GAMMAZ_TEXT[g.classification]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {results.stability.alpha.length > 0 && (
          <Dl
            rows={results.stability.alpha.map((a) => [
              `Parâmetro α (${a.dir.toUpperCase()})`,
              `α = ${fmt(a.value, 3)} · α1 = ${fmt(a.limit, 3)} → ${a.ok ? 'nós fixos' : 'considerar efeitos de 2ª ordem'}`,
            ])}
          />
        )}
        {results.stability.gammaZ.length === 0 && results.stability.alpha.length === 0 && (
          <p style={{ fontSize: 11.5, margin: '6px 0 10px' }}>
            Sem verificações de estabilidade (vento desabilitado).
          </p>
        )}

        {/* 4 — quantitativos */}
        <h3 style={rH3}>4. Quantitativos</h3>
        <table style={rTable}>
          <thead>
            <tr>
              <th style={rTh}>Item</th>
              <th style={rTh}>Quantidade</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ ...rTd, fontFamily: 'inherit' }}>
                Concreto (pilares {fmt(q.concrete.columns, 1)} · vigas {fmt(q.concrete.beams, 1)} ·
                lajes {fmt(q.concrete.slabs, 1)} m³)
              </td>
              <td style={rTd}>{fmt(q.concrete.total, 1)} m³</td>
            </tr>
            <tr>
              <td style={{ ...rTd, fontFamily: 'inherit' }}>Forma (área de contato)</td>
              <td style={rTd}>{fmt(q.formwork, 0)} m²</td>
            </tr>
            <tr>
              <td style={{ ...rTd, fontFamily: 'inherit' }}>
                Aço (vigas dim. {fmt(q.steel.beamsDesigned, 0)} · pilares dim.{' '}
                {fmt(q.steel.columnsEstimated, 0)} · malhas de laje {fmt(q.steel.slabsEstimated, 0)}{' '}
                kg)
              </td>
              <td style={rTd}>{fmt(q.steel.total, 0)} kg</td>
            </tr>
            <tr>
              <td style={{ ...rTd, fontFamily: 'inherit' }}>Taxa média de aço</td>
              <td style={rTd}>{fmt(q.steel.ratePerM3, 1)} kg/m³</td>
            </tr>
          </tbody>
        </table>

        {/* 5 — vigas */}
        <h3 style={rH3}>5. Vigas — dimensionamento (resumo)</h3>
        <table style={rTable}>
          <thead>
            <tr>
              <th style={rTh}>Viga</th>
              <th style={rTh}>Vão</th>
              <th style={rTh}>L (m)</th>
              <th style={rTh}>Seção (cm)</th>
              <th style={rTh}>As+ (cm²)</th>
              <th style={rTh}>As− e/d (cm²)</th>
              <th style={rTh}>Estribos</th>
              <th style={rTh}>Status</th>
            </tr>
          </thead>
          <tbody>
            {groups.flatMap(([name, spans]) =>
              spans.map((d) => (
                <tr key={`${d.beamId}-${d.spanIndex}`}>
                  <td style={rTd}>{name}</td>
                  <td style={rTd}>{d.spanIndex + 1}</td>
                  <td style={rTd}>{fmt(d.length, 2)}</td>
                  <td style={rTd}>
                    {fmtCmDim(d.section.bw)}×{fmtCmDim(d.section.h)}
                  </td>
                  <td style={rTd}>{fmt(cm2(d.positive.as), 2)}</td>
                  <td style={rTd}>
                    {d.negLeft ? fmt(cm2(d.negLeft.as), 2) : '—'} /{' '}
                    {d.negRight ? fmt(cm2(d.negRight.as), 2) : '—'}
                  </td>
                  <td style={rTd}>{d.shear.spec}</td>
                  <td
                    style={{
                      ...rTd,
                      fontFamily: 'inherit',
                      fontWeight: 600,
                      color:
                        d.status === 'falha' ? '#c00' : d.status === 'atencao' ? '#a15c00' : '#0a7d43',
                    }}
                  >
                    {STATUS_TEXT[d.status]}
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>

        {/* 5a — pilares */}
        <h3 style={rH3}>5a. Pilares — dimensionamento (resumo)</h3>
        {cols.length === 0 ? (
          <p style={{ fontSize: 11.5, margin: '6px 0 10px' }}>Nenhum pilar dimensionado.</p>
        ) : (
          <table style={rTable}>
            <thead>
              <tr>
                <th style={rTh}>Pilar</th>
                <th style={rTh}>Seção (cm)</th>
                <th style={rTh}>As (cm²)</th>
                <th style={rTh}>Barras</th>
                <th style={rTh}>Utilização</th>
              </tr>
            </thead>
            <tbody>
              {cols.map((c) => (
                <tr key={c.columnId}>
                  <td style={rTd}>{c.name}</td>
                  <td style={rTd}>
                    {fmtCmDim(c.section.bw)}×{fmtCmDim(c.section.h)}
                  </td>
                  <td style={rTd}>{fmt(cm2(c.as), 2)}</td>
                  <td style={rTd}>{c.bars || '—'}</td>
                  <td style={rTd}>
                    {Number.isFinite(c.utilization) ? `${fmt(c.utilization * 100, 0)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* 5b — lajes */}
        <h3 style={rH3}>5b. Lajes — malhas (resumo)</h3>
        {slabs.length === 0 ? (
          <p style={{ fontSize: 11.5, margin: '6px 0 10px' }}>Nenhuma laje no modelo.</p>
        ) : (
          <table style={rTable}>
            <thead>
              <tr>
                <th style={rTh}>Laje</th>
                <th style={rTh}>Pavimento</th>
                <th style={rTh}>Malha vão A</th>
                <th style={rTh}>Malha vão B</th>
                <th style={rTh}>Negativos</th>
              </tr>
            </thead>
            <tbody>
              {slabs.map((sl) => (
                <tr key={sl.slabId}>
                  <td style={rTd}>{sl.name}</td>
                  <td style={{ ...rTd, fontFamily: 'inherit' }}>{sl.levelName}</td>
                  {sl.design ? (
                    <>
                      <td style={rTd}>{sl.design.dirA.spanSpec}</td>
                      <td style={rTd}>{sl.design.dirB.spanSpec}</td>
                      <td style={rTd}>{slabNegatives(sl.design)}</td>
                    </>
                  ) : (
                    <td colSpan={3} style={{ ...rTd, fontFamily: 'inherit' }}>
                      manual — laje não retangular
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* 5c — fundações */}
        <h3 style={rH3}>5c. Fundações — sapatas (resumo)</h3>
        {footings.length === 0 ? (
          <p style={{ fontSize: 11.5, margin: '6px 0 10px' }}>Nenhuma sapata dimensionada.</p>
        ) : (
          <>
            <p style={{ fontSize: 11.5, margin: '6px 0 4px' }}>
              Solo: {project.settings.soil.label} — σadm = {fmt(project.settings.soil.sigmaAdm, 0)}{' '}
              kPa (orientativo — exige sondagem SPT, NBR 6122).
            </p>
            <table style={rTable}>
              <thead>
                <tr>
                  <th style={rTh}>Pilar</th>
                  <th style={rTh}>Sapata a×b×h (m)</th>
                  <th style={rTh}>σ / σmax (kPa)</th>
                </tr>
              </thead>
              <tbody>
                {footings.map((f) => (
                  <tr key={f.columnId}>
                    <td style={rTd}>{f.name}</td>
                    <td style={rTd}>
                      {fmt(f.footing.a, 2)}×{fmt(f.footing.b, 2)}×{fmt(f.footing.h, 2)}
                    </td>
                    <td style={rTd}>
                      {fmt(f.footing.sigma, 0)} / {fmt(f.footing.sigmaMax, 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {/* 6 — tabela de aço */}
        <h3 style={rH3}>6. Tabela de aço (por bitola)</h3>
        {steel.byPhi.length === 0 ? (
          <p style={{ fontSize: 11.5, margin: '6px 0 10px' }}>Tabela de aço indisponível.</p>
        ) : (
          <table style={{ ...rTable, maxWidth: 320 }}>
            <thead>
              <tr>
                <th style={rTh}>φ (mm)</th>
                <th style={rTh}>Massa (kg)</th>
              </tr>
            </thead>
            <tbody>
              {steel.byPhi.map((r) => (
                <tr key={r.phi}>
                  <td style={rTd}>φ {fmtPhi(r.phi)}</td>
                  <td style={rTd}>{fmt(r.kg, 1)}</td>
                </tr>
              ))}
              <tr>
                <td style={{ ...rTd, fontWeight: 700, borderTop: '1.5px solid #888' }}>Total</td>
                <td style={{ ...rTd, fontWeight: 700, borderTop: '1.5px solid #888' }}>
                  {fmt(steel.totalKg, 1)}
                </td>
              </tr>
              <tr>
                <td style={{ ...rTd, fontFamily: 'inherit' }}>Total c/ perdas (10%)</td>
                <td style={{ ...rTd, fontWeight: 700 }}>{fmt(steel.totalWithWaste, 1)}</td>
              </tr>
            </tbody>
          </table>
        )}
        <p style={{ fontSize: 10.5, margin: '2px 0 10px', color: '#555' }}>
          Detalhamento preliminar — quantidades estimadas a partir dos arranjos dimensionados
          (vigas, pilares e malhas de laje); o detalhamento executivo pode alterar os valores.
        </p>

        {/* 7 — avisos */}
        <h3 style={rH3}>7. Avisos</h3>
        {results.warnings.length > 0 ? (
          <ul style={{ margin: '4px 0 10px', paddingLeft: 18 }}>
            {results.warnings.map((w, i) => (
              <li key={i} style={{ fontSize: 11, marginBottom: 2 }}>
                {w}
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ fontSize: 11.5, margin: '6px 0 10px' }}>Nenhum aviso gerado pela análise.</p>
        )}

        {/* rodapé */}
        <div
          style={{
            borderTop: '1px solid #bbb',
            marginTop: 24,
            paddingTop: 8,
            fontSize: 9.5,
            color: '#666',
          }}
        >
          Gerado por HyperFrame v0.1.0 — este resumo não substitui a memória de cálculo completa
          nem a responsabilidade técnica (ART/TRT).
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// painel (raiz)
// ---------------------------------------------------------------------------

export default function ResultsPanel() {
  const results = useStore((s) => s.results)
  const project = useStore((s) => s.project)
  const tab = useStore((s) => s.resultsTab)
  const setTab = useStore((s) => s.setResultsTab)
  const setResultsOpen = useStore((s) => s.setResultsOpen)
  const [warningsOpen, setWarningsOpen] = useState(false)

  if (!results) return null

  const stats = results.model.stats

  return (
    <div
      style={{
        position: 'fixed',
        left: 44,
        right: 300,
        bottom: 24,
        height: '52vh',
        zIndex: 60,
        background: 'var(--bg-1)',
        borderTop: '2px solid var(--accent)',
        borderRight: '1px solid var(--border)',
        boxShadow: 'var(--shadow)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* cabeçalho */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 12px',
          borderBottom: '1px solid var(--border)',
          flex: 'none',
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 13 }}>Resultados da Análise</span>
        <span className="chip">{stats.nodes} nós</span>
        <span className="chip">{stats.members} barras</span>
        <span className="chip">{stats.dofs} GDL</span>
        <span className="chip">{fmt(results.elapsedMs, 0)} ms</span>
        {results.warnings.length > 0 ? (
          <button
            className="chip warn"
            style={{ cursor: 'pointer', border: 'none' }}
            onClick={() => setWarningsOpen(!warningsOpen)}
            title={warningsOpen ? 'Ocultar avisos' : 'Mostrar avisos'}
          >
            ⚠ {results.warnings.length} {results.warnings.length === 1 ? 'aviso' : 'avisos'}{' '}
            {warningsOpen ? '▴' : '▾'}
          </button>
        ) : (
          <span className="chip ok">sem avisos</span>
        )}
        <button
          className="btn-icon"
          style={{ marginLeft: 'auto', width: 26, height: 26 }}
          title="Fechar painel"
          onClick={() => setResultsOpen(false)}
        >
          <IconClose size={15} />
        </button>
      </div>

      {/* lista de avisos */}
      {warningsOpen && results.warnings.length > 0 && (
        <div
          style={{
            maxHeight: 110,
            overflowY: 'auto',
            padding: '6px 14px',
            background: 'var(--bg-2)',
            borderBottom: '1px solid var(--border)',
            flex: 'none',
          }}
        >
          {results.warnings.map((w, i) => (
            <div
              key={i}
              className="mono"
              style={{ fontSize: 11, color: 'var(--warn)', padding: '2px 0' }}
            >
              • {w}
            </div>
          ))}
        </div>
      )}

      {/* abas */}
      <div className="tabs" style={{ flex: 'none' }}>
        {TABS.map(([id, label]) => (
          <button
            key={id}
            className={`tab ${tab === id ? 'active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* conteúdo */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 16px 16px' }}>
        {tab === 'estabilidade' && <EstabilidadeTab results={results} project={project} />}
        {tab === 'vigas' && <VigasTab results={results} />}
        {tab === 'pilares' && <PilaresTab results={results} />}
        {tab === 'lajes' && <LajesTab results={results} />}
        {tab === 'fundacoes' && <FundacoesTab results={results} project={project} />}
        {tab === 'reacoes' && <ReacoesTab results={results} project={project} />}
        {tab === 'quantitativos' && <QuantitativosTab results={results} project={project} />}
        {tab === 'pranchas' && <PranchasPanel />}
        {tab === 'relatorio' && <RelatorioTab results={results} project={project} />}
      </div>
    </div>
  )
}
