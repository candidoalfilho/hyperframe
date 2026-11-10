import {
  LATTICE_COMPOSITIONS,
  LATTICE_FILLER_LABEL,
  LATTICE_FILLER_WEIGHT,
  LATTICE_TRUSSES,
  WELDED_MESHES,
  latticeDesignation,
  latticeRibbed,
  latticeSection,
  ribbedSelfWeight,
  type LatticeParams,
  type Slab,
} from '@hyperframe/engine'
import { useStore } from '../store'
import { NumberField } from './NumberField'
import { cm, fmt } from './format'

const FILLER_FILL: Record<LatticeParams['filler'], string> = {
  ceramico: '#c8743a',
  eps: '#dfe6ee',
  concreto: '#8f959e',
}

const EXTRA_PHIS = [0.005, 0.006, 0.0063, 0.008, 0.01, 0.0125]
const phiLabel = (phi: number) => fmt(phi * 1000, phi * 1000 % 1 === 0 ? 0 : 1)

/**
 * Corte transversal da laje treliçada, em escala (unidades do viewBox = cm):
 * capa + vigotas (sapata, alma e treliça) + enchimento, com H, hf, bw e
 * intereixo cotados — atualiza a cada edição.
 */
export function LatticeSectionPreview({ lattice, topping }: { lattice: LatticeParams; topping: number }) {
  const sec = latticeSection(lattice, topping)
  const c = (m: number) => m * 100 // m → cm
  const I = c(sec.spacing)
  const H = c(sec.h)
  const hf = c(topping)
  const bw = c(sec.bw)
  const bv = c(lattice.baseWidth)
  const hv = c(Math.min(lattice.baseHeight, lattice.fillerHeight))
  const ht = c(lattice.trussHeight)
  const W = 1.6 * I
  const ribs = [0.3 * I, 1.3 * I]
  const padTop = 5
  const padBottom = 8
  const padRight = 13
  const yBars = H - hv / 2
  const stroke = 'var(--text-dim)'
  const txt = { fontSize: 3.1, fill: 'var(--text-dim)', fontFamily: 'var(--mono)' } as const

  return (
    <svg
      viewBox={`${-2} ${-padTop} ${W + padRight + 2} ${H + padTop + padBottom}`}
      style={{ width: '100%', display: 'block' }}
      role="img"
      aria-label={`Corte da laje treliçada ${latticeDesignation(lattice, topping)}`}
    >
      <defs>
        <clipPath id="hf-lattice-clip">
          <rect x={0} y={0} width={W} height={H} />
        </clipPath>
      </defs>
      <g clipPath="url(#hf-lattice-clip)">
        {/* enchimento em toda a faixa abaixo da capa; o concreto é desenhado por cima */}
        <rect x={0} y={hf} width={W} height={H - hf} fill={FILLER_FILL[lattice.filler]} opacity={0.55} />
        {/* capa */}
        <rect x={0} y={0} width={W} height={hf} fill="#7d8695" stroke={stroke} strokeWidth={0.25} />
        {ribs.map((cx) => (
          <g key={cx}>
            <rect x={cx - bw / 2} y={hf - 0.1} width={bw} height={H - hf + 0.1} fill="#7d8695" />
            <rect x={cx - bv / 2} y={H - hv} width={bv} height={hv} fill="#7d8695" stroke={stroke} strokeWidth={0.25} />
            {/* treliça: banzo superior + 2 inferiores + diagonais */}
            <polyline
              points={`${cx - bv / 2 + 2.2},${yBars} ${cx},${yBars - ht} ${cx + bv / 2 - 2.2},${yBars}`}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={0.45}
            />
            <circle cx={cx} cy={yBars - ht} r={0.75} fill="var(--accent)" />
            <circle cx={cx - bv / 2 + 2.2} cy={yBars} r={0.7} fill="var(--accent)" />
            <circle cx={cx + bv / 2 - 2.2} cy={yBars} r={0.7} fill="var(--accent)" />
            {lattice.extraBars &&
              Array.from({ length: Math.min(lattice.extraBars.n, 3) }, (_, i) => (
                <circle
                  key={i}
                  cx={cx + (i - (Math.min(lattice.extraBars!.n, 3) - 1) / 2) * 2.2}
                  cy={yBars}
                  r={0.8}
                  fill="var(--err)"
                />
              ))}
          </g>
        ))}
        {/* tela da capa */}
        <line x1={0} y1={hf / 2} x2={W} y2={hf / 2} stroke="var(--accent)" strokeWidth={0.3} strokeDasharray="1.6 1.2" />
      </g>
      <rect x={0} y={0} width={W} height={H} fill="none" stroke={stroke} strokeWidth={0.3} />

      {/* cotas: H e hf à direita, intereixo e bw embaixo */}
      <line x1={W + 2} y1={0} x2={W + 2} y2={H} stroke={stroke} strokeWidth={0.25} />
      <line x1={W + 1} y1={0} x2={W + 3} y2={0} stroke={stroke} strokeWidth={0.25} />
      <line x1={W + 1} y1={H} x2={W + 3} y2={H} stroke={stroke} strokeWidth={0.25} />
      <text x={W + 3.6} y={H / 2 + 1.1} {...txt}>
        H={fmt(H, 0)}
      </text>
      <text x={W + 3.6} y={hf / 2 + 1.1 - (H / 2 - hf / 2 < 3.4 ? 3.4 : 0)} {...txt}>
        hf={fmt(hf, hf % 1 === 0 ? 0 : 1)}
      </text>
      <line x1={ribs[0]} y1={H + 2.4} x2={ribs[1]} y2={H + 2.4} stroke={stroke} strokeWidth={0.25} />
      <line x1={ribs[0]} y1={H + 1.2} x2={ribs[0]} y2={H + 3.6} stroke={stroke} strokeWidth={0.25} />
      <line x1={ribs[1]} y1={H + 1.2} x2={ribs[1]} y2={H + 3.6} stroke={stroke} strokeWidth={0.25} />
      <text x={(ribs[0] + ribs[1]) / 2} y={H + 6.4} textAnchor="middle" {...txt}>
        intereixo {fmt(I, 0)} · bw {fmt(bw, bw % 1 === 0 ? 0 : 1)}
      </text>
      <text x={0} y={-1.6} {...txt} fill="var(--text)" fontWeight={600}>
        {latticeDesignation(lattice, topping)} · {lattice.truss}
      </text>
    </svg>
  )
}

/** campos da laje treliçada no inspetor (vigota, enchimento, capa, tela, adicionais) */
export default function LatticeSlabFields({ slab }: { slab: Slab }) {
  const updateSlab = useStore((s) => s.updateSlab)
  const concreteWeight = useStore((s) => s.project.settings.concreteUnitWeight)
  const ribbed = slab.ribbed!
  const lat = ribbed.lattice!
  const dirs = ribbed.dirs === 'y' ? 'y' : 'x'

  /** aplica mudanças mantendo ribbed/thickness derivados da vigota */
  const apply = (
    patch: Partial<LatticeParams>,
    opts: { topping?: number; dirs?: 'x' | 'y'; fillerWeight?: number } = {},
  ) => {
    const next = { ...lat, ...patch }
    const fw =
      opts.fillerWeight ??
      (patch.filler ? LATTICE_FILLER_WEIGHT[patch.filler] : ribbed.fillerWeight)
    const r = latticeRibbed(next, opts.topping ?? ribbed.topping, opts.dirs ?? dirs, fw)
    updateSlab(slab.id, { ribbed: r.ribbed, thickness: r.thickness })
  }

  const composition = LATTICE_COMPOSITIONS.find(
    (c) =>
      Math.abs(c.fillerHeight - lat.fillerHeight) < 1e-9 &&
      Math.abs(c.topping - ribbed.topping) < 1e-9 &&
      c.truss === lat.truss,
  )
  const trussMatch = LATTICE_TRUSSES.find(
    (t) =>
      t.name === lat.truss &&
      Math.abs(t.h - lat.trussHeight) < 1e-9 &&
      Math.abs(t.top - lat.phiTop) < 1e-9 &&
      Math.abs(t.diag - lat.phiDiag) < 1e-9 &&
      Math.abs(t.bottom - lat.phiBottom) < 1e-9,
  )
  const setTruss = (name: string) => {
    const t = LATTICE_TRUSSES.find((x) => x.name === name)
    if (t) apply({ truss: t.name, trussHeight: t.h, phiTop: t.top, phiDiag: t.diag, phiBottom: t.bottom })
  }
  const g0 = ribbedSelfWeight(slab.thickness, ribbed, concreteWeight)
  const extraKey = lat.extraBars ? `${lat.extraBars.n}x${lat.extraBars.phi}` : 'auto'

  return (
    <>
      <div
        style={{
          background: 'var(--bg-2)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '8px 8px 4px',
          margin: '4px 0 10px',
        }}
      >
        <LatticeSectionPreview lattice={lat} topping={ribbed.topping} />
      </div>

      <div className="field">
        <label className="label">Composição</label>
        <select
          className="select"
          style={{ width: '100%' }}
          value={composition?.label ?? 'custom'}
          onChange={(e) => {
            const c = LATTICE_COMPOSITIONS.find((x) => x.label === e.target.value)
            const t = c && LATTICE_TRUSSES.find((x) => x.name === c.truss)
            if (c && t)
              apply(
                {
                  fillerHeight: c.fillerHeight,
                  truss: t.name,
                  trussHeight: t.h,
                  phiTop: t.top,
                  phiDiag: t.diag,
                  phiBottom: t.bottom,
                },
                { topping: c.topping },
              )
          }}
        >
          {!composition && (
            <option value="custom" disabled>
              Personalizada — {latticeDesignation(lat, ribbed.topping)}
            </option>
          )}
          {LATTICE_COMPOSITIONS.map((c) => (
            <option key={c.label} value={c.label}>
              {c.label} · {c.truss}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="label">Vigotas vencem o vão em</label>
        <select
          className="select"
          style={{ width: '100%' }}
          value={dirs}
          onChange={(e) => apply({}, { dirs: e.target.value as 'x' | 'y' })}
        >
          <option value="x">X — apoiam nas vigas verticais da planta</option>
          <option value="y">Y — apoiam nas vigas horizontais da planta</option>
        </select>
      </div>

      <div className="field">
        <label className="label">Armação treliçada</label>
        <select
          className="select"
          style={{ width: '100%' }}
          value={trussMatch?.name ?? 'custom'}
          onChange={(e) => setTruss(e.target.value)}
        >
          {!trussMatch && (
            <option value="custom" disabled>
              Especial — {lat.truss}
            </option>
          )}
          {LATTICE_TRUSSES.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name} — h {fmt(t.h * 100, 0)} · φ {phiLabel(t.top)}/{phiLabel(t.diag)}/{phiLabel(t.bottom)}
            </option>
          ))}
        </select>
        <label className="label" style={{ marginTop: 6 }}>
          Altura (cm) · φ sup · diag · inf (mm)
        </label>
        <div className="field-row">
          <NumberField
            value={cm(lat.trussHeight)}
            digits={1}
            min={6}
            max={40}
            title="Altura da treliça"
            onCommit={(v) => apply({ trussHeight: v / 100, truss: 'Especial' })}
          />
          <NumberField
            value={lat.phiTop * 1000}
            digits={1}
            min={4.2}
            max={12.5}
            title="φ do banzo superior"
            onCommit={(v) => apply({ phiTop: v / 1000, truss: 'Especial' })}
          />
          <NumberField
            value={lat.phiDiag * 1000}
            digits={1}
            min={3.4}
            max={8}
            title="φ das diagonais"
            onCommit={(v) => apply({ phiDiag: v / 1000, truss: 'Especial' })}
          />
          <NumberField
            value={lat.phiBottom * 1000}
            digits={1}
            min={4.2}
            max={12.5}
            title="φ do banzo inferior (2 fios)"
            onCommit={(v) => apply({ phiBottom: v / 1000, truss: 'Especial' })}
          />
        </div>
      </div>

      <div className="field">
        <label className="label">Sapata da vigota bv × hv (cm)</label>
        <div className="field-row">
          <NumberField
            value={cm(lat.baseWidth)}
            digits={1}
            min={8}
            max={30}
            onCommit={(v) => apply({ baseWidth: v / 100 })}
          />
          <NumberField
            value={cm(lat.baseHeight)}
            digits={1}
            min={2}
            max={6}
            onCommit={(v) => apply({ baseHeight: v / 100 })}
          />
        </div>
      </div>

      <div className="field">
        <label className="label">Enchimento</label>
        <select
          className="select"
          style={{ width: '100%' }}
          value={lat.filler}
          onChange={(e) => apply({ filler: e.target.value as LatticeParams['filler'] })}
        >
          {(Object.keys(LATTICE_FILLER_LABEL) as LatticeParams['filler'][]).map((k) => (
            <option key={k} value={k}>
              {LATTICE_FILLER_LABEL[k]}
            </option>
          ))}
        </select>
        <label className="label" style={{ marginTop: 6 }}>
          he · be · aba ah (cm) · peso (kN/m³)
        </label>
        <div className="field-row">
          <NumberField
            value={cm(lat.fillerHeight)}
            digits={1}
            min={6}
            max={40}
            title="Altura do enchimento (he)"
            onCommit={(v) => apply({ fillerHeight: v / 100 })}
          />
          <NumberField
            value={cm(lat.fillerWidth)}
            digits={1}
            min={15}
            max={60}
            title="Largura livre do enchimento entre sapatas (be)"
            onCommit={(v) => apply({ fillerWidth: v / 100 })}
          />
          <NumberField
            value={cm(lat.fillerLedge)}
            digits={1}
            min={0}
            max={3}
            title="Apoio do enchimento sobre a sapata (ah) — bw = bv − 2·ah"
            onCommit={(v) => apply({ fillerLedge: v / 100 })}
          />
          <NumberField
            value={ribbed.fillerWeight}
            digits={2}
            min={0}
            max={25}
            title="Peso específico aparente do enchimento"
            onCommit={(v) => apply({}, { fillerWeight: v })}
          />
        </div>
      </div>

      <div className="field">
        <label className="label">Capa hf (cm) · tela soldada</label>
        <div className="field-row">
          <NumberField
            value={cm(ribbed.topping)}
            digits={1}
            min={3}
            max={12}
            onCommit={(v) => apply({}, { topping: v / 100 })}
          />
          <select
            className="select"
            style={{ flex: 1.4, minWidth: 0 }}
            value={lat.mesh}
            onChange={(e) => apply({ mesh: e.target.value })}
          >
            {WELDED_MESHES.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name} — {fmt(m.as * 1e4, 2)} cm²/m
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label className="label">Armadura adicional por vigota</label>
        <select
          className="select"
          style={{ width: '100%' }}
          value={extraKey}
          onChange={(e) => {
            if (e.target.value === 'auto') return apply({ extraBars: undefined })
            const [n, phi] = e.target.value.split('x').map(Number)
            apply({ extraBars: { n, phi } })
          }}
        >
          <option value="auto">Automática (menor área que atende)</option>
          {[1, 2, 3].flatMap((n) =>
            EXTRA_PHIS.map((phi) => (
              <option key={`${n}x${phi}`} value={`${n}x${phi}`}>
                {n} φ {phiLabel(phi)} {phi <= 0.006 ? '(CA-60)' : '(CA-50)'}
              </option>
            )),
          )}
        </select>
      </div>

      <label
        style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, padding: '3px 0', cursor: 'pointer' }}
        title="Desligado (padrão): vigotas biapoiadas com negativa construtiva. Ligado: engaste por continuidade onde há laje vizinha no apoio — dimensiona o negativo e redistribui as reações (5/8–3/8)."
      >
        <input
          type="checkbox"
          checked={!!lat.continuous}
          style={{ marginTop: 2 }}
          onChange={(e) => apply({ continuous: e.target.checked || undefined })}
        />
        Considerar continuidade com lajes vizinhas
      </label>

      <div className="faint" style={{ fontSize: 10.5, marginTop: 6, lineHeight: 1.5 }}>
        Peso próprio real {fmt(g0, 2)} kN/m² (capa + vigotas + enchimento). As reações das vigotas
        descem só nas vigas de apoio e seguem p/ pilares e fundações na análise — NBR 14859 / NBR
        6118 §13.2.4.2.
      </div>
    </>
  )
}
