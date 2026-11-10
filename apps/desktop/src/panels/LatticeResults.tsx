import type { LatticeDesignOutput, SlabDesignResultItem } from '@hyperframe/engine'
import { fmt } from './format'

const cm2 = (a: number) => fmt(a * 1e4, 2)

function Chip({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return <span className={`chip ${ok ? 'ok' : 'err'}`}>{children}</span>
}

/**
 * Diagramas de cálculo da vigota (ELU): momento fletor (positivo p/ baixo) e
 * força cortante, com as reações características por metro de apoio.
 */
function JoistDiagrams({ d }: { d: LatticeDesignOutput }) {
  const L = d.span
  const w = 1.4 * (d.g + d.q) * d.spacing // kN/m por vigota
  const rTot = d.reactions.g[0] + d.reactions.g[1]
  const s0 = rTot > 1e-9 ? d.reactions.g[0] / rTot : 0.5
  const fixedStart = d.fixedEnds === 2 || (d.fixedEnds === 1 && s0 > 0.5)
  const fixedEnd = d.fixedEnds === 2 || (d.fixedEnds === 1 && s0 < 0.5)
  const m0 = d.fixedEnds === 2 ? -(w * L * L) / 12 : fixedStart ? -(w * L * L) / 8 : 0
  const r0 = s0 * w * L
  const N = 40
  const xs = Array.from({ length: N + 1 }, (_, i) => (i * L) / N)
  const M = xs.map((x) => m0 + r0 * x - (w * x * x) / 2)
  const V = xs.map((x) => r0 - w * x)
  const mAbs = Math.max(...M.map(Math.abs), 1e-9)
  const vAbs = Math.max(...V.map(Math.abs), 1e-9)

  const W = 250
  const H = 84
  const x0 = 16
  const x1 = W - 16
  const sx = (x: number) => x0 + ((x1 - x0) * x) / Math.max(L, 1e-9)
  const amp = 26
  const plot = (vals: number[], max: number, sign: 1 | -1, y0: number) =>
    `${x0},${y0} ` +
    vals.map((v, i) => `${sx(xs[i])},${y0 + sign * (v / max) * amp}`).join(' ') +
    ` ${x1},${y0}`
  const lbl = { fontSize: 9.5, fill: 'var(--text-dim)', fontFamily: 'var(--mono)' } as const
  const support = (x: number, fixed: boolean, y: number) =>
    fixed ? (
      <rect x={x - 3} y={y - 9} width={6} height={18} fill="var(--text-dim)" opacity={0.7} />
    ) : (
      <polygon points={`${x},${y} ${x - 5},${y + 8} ${x + 5},${y + 8}`} fill="var(--text-dim)" opacity={0.7} />
    )
  const iMax = M.indexOf(Math.max(...M))

  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ flex: '1 1 220px', maxWidth: 320 }} role="img" aria-label="Diagrama de momento fletor da vigota">
        <text x={W / 2} y={10} textAnchor="middle" {...lbl}>
          Md (kN·m/vigota)
        </text>
        {/* convenção brasileira: positivo desenhado p/ baixo (lado tracionado) */}
        <polygon points={plot(M, mAbs, 1, 34)} fill="var(--accent)" opacity={0.22} />
        <polyline points={plot(M, mAbs, 1, 34)} fill="none" stroke="var(--accent)" strokeWidth={1.3} />
        <line x1={x0} y1={34} x2={x1} y2={34} stroke="var(--text)" strokeWidth={1.4} />
        {support(x0, fixedStart, 34)}
        {support(x1, fixedEnd, 34)}
        <text x={sx(xs[iMax])} y={34 + (M[iMax] / mAbs) * amp + 11} textAnchor="middle" {...lbl} fill="var(--text)">
          +{fmt(d.mdSpan, 2)}
        </text>
        {d.mdSupport > 0 && (
          <text
            x={fixedStart ? x0 + 9 : x1 - 9}
            y={34 - (d.mdSupport / mAbs) * amp + 9}
            textAnchor={fixedStart ? 'start' : 'end'}
            {...lbl}
            fill="var(--text)"
          >
            −{fmt(d.mdSupport, 2)}
          </text>
        )}
        <text x={W / 2} y={H - 2} textAnchor="middle" {...lbl}>
          vão {fmt(L, 2)} m
        </text>
      </svg>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ flex: '1 1 220px', maxWidth: 320 }} role="img" aria-label="Diagrama de força cortante da vigota">
        <text x={W / 2} y={10} textAnchor="middle" {...lbl}>
          Vd (kN/vigota)
        </text>
        <polygon points={plot(V, vAbs, -1, 44)} fill="var(--blue, #4da3ff)" opacity={0.2} />
        <polyline points={plot(V, vAbs, -1, 44)} fill="none" stroke="var(--blue, #4da3ff)" strokeWidth={1.3} />
        <line x1={x0} y1={44} x2={x1} y2={44} stroke="var(--text)" strokeWidth={1.4} />
        <text x={x0 + 4} y={44 - (V[0] / vAbs) * amp - 3} {...lbl} fill="var(--text)">
          {fmt(V[0], 2)}
        </text>
        <text x={x1 - 4} y={44 - (V[N] / vAbs) * amp + 10} textAnchor="end" {...lbl} fill="var(--text)">
          {fmt(V[N], 2)}
        </text>
      </svg>
      <div className="faint" style={{ flexBasis: '100%', fontSize: 11, fontFamily: 'var(--mono)' }}>
        reações nas vigas de apoio (kN/m, características) — início: g {fmt(d.reactions.g[0], 1)} + q{' '}
        {fmt(d.reactions.q[0], 1)} · fim: g {fmt(d.reactions.g[1], 1)} + q {fmt(d.reactions.q[1], 1)}
      </div>
    </div>
  )
}

/** aba Lajes: tabela + diagramas das lajes treliçadas */
export default function LatticeSlabsResults({ items }: { items: SlabDesignResultItem[] }) {
  if (items.length === 0) return null
  return (
    <>
      <h4 style={{ margin: '18px 0 8px' }}>Lajes treliçadas (NBR 14859 — por vigota)</h4>
      <table className="table">
        <thead>
          <tr>
            <th>Laje</th>
            <th>Pavimento</th>
            <th>Composição</th>
            <th>Vão (m)</th>
            <th>Md+ / Md− (kN·m)</th>
            <th>As nec / ef (cm²)</th>
            <th>Armadura por vigota</th>
            <th>Negativa · tela</th>
            <th>VSd/VRd (kN)</th>
            <th>Flecha (mm)</th>
            <th>wk (mm)</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((s) => {
            const d = s.latticeDesign
            const title = s.notes.length > 0 ? s.notes.join(' · ') : undefined
            return (
              <tr key={s.slabId} title={title}>
                <td style={{ fontWeight: 600 }}>{s.name}</td>
                <td style={{ fontFamily: 'var(--sans)' }}>{s.levelName}</td>
                {d ? (
                  <>
                    <td>
                      {d.designation} · {d.truss}
                    </td>
                    <td>{fmt(d.span, 2)}</td>
                    <td>
                      {fmt(d.mdSpan, 2)} / {d.mdSupport > 0 ? fmt(d.mdSupport, 2) : '—'}
                    </td>
                    <td>
                      <Chip ok={d.flexOk}>
                        {cm2(d.asReq)} / {cm2(d.asProvided)}
                      </Chip>
                    </td>
                    <td>{d.bars}</td>
                    <td>
                      {d.fixedEnds > 0 ? d.supportSpec : `${d.negConstructiveSpec} (constr.)`}
                      {d.solidStrip ? ' · faixa maciça' : ''}
                    </td>
                    <td>
                      <Chip ok={d.shearOk}>
                        {fmt(d.vd, 1)}/{fmt(d.usesDiagonals ? d.vrd3 : d.vrd1, 1)}
                      </Chip>
                    </td>
                    <td>
                      <span className={`chip ${d.deflectionOk ? 'ok' : d.counterCamber > 0 ? 'warn' : 'err'}`}>
                        {fmt(d.deflection * 1000, 1)} {d.deflectionOk ? '≤' : '>'}{' '}
                        {fmt(d.deflectionLimit * 1000, 1)}
                        {d.counterCamber > 0 ? ` · cf ${fmt(d.counterCamber * 1000, 0)}` : ''}
                      </span>
                    </td>
                    <td>
                      <Chip ok={d.crackOk}>{fmt(d.wk * 1000, 2)}</Chip>
                    </td>
                  </>
                ) : (
                  <td colSpan={9} className="faint">
                    manual — laje não retangular (as cargas já descem unidirecionais na análise)
                  </td>
                )}
                <td>
                  <span className={`chip ${s.status === 'ok' ? 'ok' : s.status === 'atencao' ? 'warn' : 'err'}`}>
                    {s.status === 'ok' ? 'OK' : s.status === 'atencao' ? 'Atenção' : 'Falha'}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(460px, 1fr))',
          gap: 10,
          marginTop: 10,
        }}
      >
        {items
          .filter((s) => s.latticeDesign)
          .map((s) => {
            const d = s.latticeDesign!
            return (
              <div
                key={s.slabId}
                style={{
                  background: 'var(--bg-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: '10px 12px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, marginBottom: 4 }}>
                  <strong>
                    {s.name} · {s.levelName}
                  </strong>
                  <span className="faint" style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                    g {fmt(d.g, 2)} (pp {fmt(d.g0, 2)}) + q {fmt(d.q, 2)} kN/m² · intereixo{' '}
                    {fmt(d.spacing * 100, 0)} cm
                  </span>
                </div>
                <JoistDiagrams d={d} />
              </div>
            )
          })}
      </div>

      <div className="faint" style={{ fontSize: 11, margin: '12px 0 4px', lineHeight: 1.5 }}>
        Vigota como viga T (mesa = intereixo × capa): As em área equivalente CA-60 (banzo inferior
        da treliça + adicionais na sapata); cortante por §19.4.1 e, se preciso, com as diagonais
        (§19.4.2); flecha total com Branson + fluência (αf = 1,32; “cf” = contraflecha sugerida);
        wk na combinação frequente (§17.3.3.2). As reações mostradas são exatamente as cargas
        aplicadas às vigas de apoio na análise global — passe o mouse na linha p/ ver as notas.
      </div>
    </>
  )
}
