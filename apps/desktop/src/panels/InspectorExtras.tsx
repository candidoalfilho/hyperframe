import { useMemo, useState } from 'react'
import {
  WALL_BLOCK_PRESETS,
  WALL_CALC_DEFAULTS,
  WALL_COATING_PRESETS,
  dist,
  isRectangular,
  simplifyPolygon,
  wallLoadFromCalc,
  type Beam,
  type Column,
  type ElementRef,
  type Slab,
  type WallLoad,
  type WallLoadCalc,
} from '@hyperframe/engine'
import { useStore } from '../store'
import {
  ALIGN_LABEL,
  ANCHOR_LABEL,
  COLUMN_ANCHORS,
  type AlignMode,
  type ColumnAnchor,
} from '../store/align'
import { NumberField } from './NumberField'
import { cm, fmt } from './format'

const beamLengthOf = (beam: Beam | undefined): number => {
  if (!beam) return 0
  let len = 0
  for (let i = 0; i + 1 < beam.path.length; i++) len += dist(beam.path[i], beam.path[i + 1])
  return len
}

/** comprimento carregado: trecho x0–x1 ou a viga inteira */
export const wallLength = (wl: WallLoad, beam: Beam | undefined): number =>
  wl.x0 !== undefined && wl.x1 !== undefined ? Math.max(wl.x1 - wl.x0, 0) : beamLengthOf(beam)

/** recalcula w a partir da composição (2 casas) */
export function wallFromCalc(calc: WallLoadCalc, length: number): { w: number; label: string } {
  const w = Math.round(wallLoadFromCalc(calc, length).w * 100) / 100
  return {
    w,
    label: `${calc.block} ${Number((calc.thickness * 100).toFixed(1)).toString().replace('.', ',')} cm · h ${fmt(calc.height, 2)} m`,
  }
}

/**
 * Composição da carga de alvenaria: altura, espessura, bloco, revestimento e
 * aberturas → kN/m, com a conta aberta (vai também p/ o memorial).
 */
export function WallCalcFields({ wl, beam }: { wl: WallLoad; beam: Beam | undefined }) {
  const updateWallLoad = useStore((s) => s.updateWallLoad)
  const length = wallLength(wl, beam)
  const calc = wl.calc

  const apply = (patch: Partial<WallLoadCalc>) => {
    const next = { ...(calc ?? WALL_CALC_DEFAULTS), ...patch }
    updateWallLoad(wl.id, { calc: next, ...wallFromCalc(next, length) })
  }

  if (!calc) {
    return (
      <button className="btn" style={{ width: '100%', marginBottom: 10 }} onClick={() => apply({})}>
        Calcular pela composição da parede…
      </button>
    )
  }

  const bd = wallLoadFromCalc(calc, length)
  const blockMatch = WALL_BLOCK_PRESETS.find(
    (p) => p.label === calc.block && Math.abs(p.unitWeight - calc.unitWeight) < 1e-9,
  )
  const coatMatch = WALL_COATING_PRESETS.find(
    (p) => Math.abs(p.unitWeight - calc.coatingUnitWeight) < 1e-9,
  )

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '10px 10px 6px',
        margin: '4px 0 10px',
        background: 'var(--bg-2)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span className="label" style={{ margin: 0 }}>
          Composição da parede
        </span>
        <button
          className="btn-icon"
          title="Voltar a informar w diretamente"
          style={{ fontSize: 12 }}
          onClick={() => updateWallLoad(wl.id, { calc: undefined })}
        >
          ✕
        </button>
      </div>

      <div className="field">
        <label className="label">Altura da parede (m) · espessura do bloco (cm)</label>
        <div className="field-row">
          <NumberField value={calc.height} digits={2} min={0.2} max={12} onCommit={(v) => apply({ height: v })} />
          <NumberField
            value={cm(calc.thickness)}
            digits={1}
            min={5}
            max={40}
            onCommit={(v) => apply({ thickness: v / 100 })}
          />
        </div>
      </div>

      <div className="field">
        <label className="label">Bloco · peso específico (kN/m³)</label>
        <div className="field-row">
          <select
            className="select"
            style={{ flex: 2, minWidth: 0 }}
            value={blockMatch?.label ?? 'custom'}
            onChange={(e) => {
              const p = WALL_BLOCK_PRESETS.find((x) => x.label === e.target.value)
              if (p) apply({ block: p.label, unitWeight: p.unitWeight })
            }}
          >
            {!blockMatch && (
              <option value="custom" disabled>
                Personalizado
              </option>
            )}
            {WALL_BLOCK_PRESETS.map((p) => (
              <option key={p.label} value={p.label}>
                {p.label}
              </option>
            ))}
          </select>
          <NumberField
            value={calc.unitWeight}
            digits={1}
            min={1}
            max={30}
            onCommit={(v) => apply({ unitWeight: v, block: blockMatch ? `${calc.block} (γ ajustado)` : calc.block })}
          />
        </div>
      </div>

      <div className="field">
        <label className="label">Revestimento: espessura por face (cm) · faces · γ (kN/m³)</label>
        <div className="field-row">
          <NumberField
            value={cm(calc.coatingThickness)}
            digits={1}
            min={0}
            max={6}
            onCommit={(v) => apply({ coatingThickness: v / 100 })}
          />
          <select
            className="select"
            value={calc.coatingFaces}
            onChange={(e) => apply({ coatingFaces: Number(e.target.value) })}
          >
            <option value={0}>sem</option>
            <option value={1}>1 face</option>
            <option value={2}>2 faces</option>
          </select>
          <NumberField
            value={calc.coatingUnitWeight}
            digits={1}
            min={5}
            max={30}
            title={coatMatch?.label ?? 'Peso específico do revestimento'}
            onCommit={(v) => apply({ coatingUnitWeight: v })}
          />
        </div>
        <select
          className="select"
          style={{ width: '100%', marginTop: 6 }}
          value={coatMatch?.label ?? 'custom'}
          onChange={(e) => {
            const p = WALL_COATING_PRESETS.find((x) => x.label === e.target.value)
            if (p) apply({ coatingUnitWeight: p.unitWeight })
          }}
        >
          {!coatMatch && (
            <option value="custom" disabled>
              Revestimento personalizado
            </option>
          )}
          {WALL_COATING_PRESETS.map((p) => (
            <option key={p.label} value={p.label}>
              {p.label} — {fmt(p.unitWeight, 1)} kN/m³
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="label">Aberturas a descontar — portas e janelas (m²)</label>
        <NumberField
          value={calc.openingsArea}
          digits={2}
          min={0}
          max={200}
          style={{ width: '100%' }}
          onCommit={(v) => apply({ openingsArea: v })}
        />
      </div>

      <div className="faint" style={{ fontSize: 10.5, lineHeight: 1.6, fontFamily: 'var(--mono)' }}>
        alvenaria {fmt(bd.blockPerArea, 2)} + revest. {fmt(bd.coatingPerArea, 2)} = {fmt(bd.perArea, 2)} kN/m²
        <br />
        área {fmt(bd.grossArea, 2)} − {fmt(calc.openingsArea, 2)} = {fmt(bd.netArea, 2)} m² em {fmt(length, 2)} m
        <br />
        <span style={{ color: 'var(--text)' }}>w = {fmt(bd.w, 2)} kN/m</span>
      </div>
    </div>
  )
}

/** painel da viga: cargas de parede sobre ela (editar, remover, adicionar) */
export function BeamWallLoads({ beam }: { beam: Beam }) {
  const loads = useStore((s) =>
    s.project.plans.find((pl) => pl.beams.some((b) => b.id === beam.id))?.wallLoads,
  )
  const addWallLoad = useStore((s) => s.addWallLoad)
  const updateWallLoad = useStore((s) => s.updateWallLoad)
  const deleteElement = useStore((s) => s.deleteElement)
  const select = useStore((s) => s.select)
  const mine = useMemo(() => (loads ?? []).filter((w) => w.beamId === beam.id), [loads, beam.id])

  return (
    <div className="field" style={{ marginTop: 10 }}>
      <label className="label">Cargas de parede nesta viga</label>
      {mine.length === 0 && (
        <div className="faint" style={{ fontSize: 11.5, padding: '2px 0 6px' }}>
          Nenhuma.
        </div>
      )}
      {mine.map((w) => (
        <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}>
          <NumberField
            value={w.w}
            digits={2}
            min={0}
            max={100}
            style={{ width: 62 }}
            disabled={!!w.calc}
            title={w.calc ? 'Calculada pela composição da parede — edite em "Editar"' : 'kN/m'}
            onCommit={(v) => updateWallLoad(w.id, { w: v })}
          />
          <span className="faint" style={{ fontSize: 11, flex: 1, minWidth: 0 }}>
            kN/m ·{' '}
            {w.x0 !== undefined && w.x1 !== undefined
              ? `${fmt(w.x0, 2)}–${fmt(w.x1, 2)} m`
              : 'viga inteira'}
          </span>
          <button className="btn" style={{ padding: '3px 8px', fontSize: 11.5 }} onClick={() => select({ kind: 'wallLoad', id: w.id })}>
            Editar
          </button>
          <button
            className="btn-icon"
            title="Remover esta carga de parede"
            style={{ color: 'var(--err)', fontSize: 12 }}
            onClick={() => {
              deleteElement({ kind: 'wallLoad', id: w.id })
              select({ kind: 'beam', id: beam.id })
            }}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        className="btn"
        style={{ width: '100%', marginTop: 4 }}
        onClick={() => {
          addWallLoad(beam.id, true)
          // continua na viga: a carga nova aparece na lista acima
          select({ kind: 'beam', id: beam.id })
        }}
      >
        + Adicionar carga de parede
      </button>
    </div>
  )
}

/** dimensões lineares do painel de laje (lados do contorno, sem vértices colineares) */
export function SlabDims({ slab }: { slab: Slab }) {
  const info = useMemo(() => {
    const p = simplifyPolygon(slab.polygon)
    const sides = p.map((a, i) => dist(a, p[(i + 1) % p.length]))
    const xs = p.map((q) => q.x)
    const ys = p.map((q) => q.y)
    return {
      rect: isRectangular(slab.polygon),
      sides,
      bx: Math.max(...xs) - Math.min(...xs),
      by: Math.max(...ys) - Math.min(...ys),
      perimeter: sides.reduce((a, b) => a + b, 0),
    }
  }, [slab.polygon])
  const row = (label: string, value: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '2px 0' }}>
      <span className="faint">{label}</span>
      <span style={{ fontFamily: 'var(--mono)' }}>{value}</span>
    </div>
  )
  return (
    <>
      {info.rect
        ? row('Dimensões', `${fmt(info.sides[0], 2)} × ${fmt(info.sides[1], 2)} m`)
        : row('Envolvente (x × y)', `${fmt(info.bx, 2)} × ${fmt(info.by, 2)} m`)}
      {!info.rect && row('Lados', info.sides.map((v) => fmt(v, 2)).join(' · ') + ' m')}
      {row('Perímetro', `${fmt(info.perimeter, 2)} m`)}
    </>
  )
}

const KIND_LABEL: Record<ElementRef['kind'], [string, string]> = {
  column: ['pilar', 'pilares'],
  beam: ['viga', 'vigas'],
  slab: ['laje', 'lajes'],
  loadRegion: ['região de carga', 'regiões de carga'],
  wallLoad: ['carga de parede', 'cargas de parede'],
}

/** painel da seleção múltipla: mover por valor, girar pilares, excluir */
/**
 * Mudanças de seção/rotação do pilar respeitando o ponto de referência
 * escolhido: com face ou canto, esse ponto fica parado e o centro se desloca.
 */
export function useColumnGeomUpdate() {
  const updateColumn = useStore((s) => s.updateColumn)
  const resizeColumn = useStore((s) => s.resizeColumn)
  const anchor = useStore((s) => s.defaults.columnAnchor ?? 'c')
  return (id: string, patch: Partial<Pick<Column, 'section' | 'rotationDeg'>>) =>
    anchor === 'c' ? updateColumn(id, patch) : resizeColumn(id, patch, anchor)
}

/** seletor 3×3 do ponto de referência do pilar: centro, meio de face ou canto */
export function AnchorPicker({ hint }: { hint: string }) {
  const anchor = useStore((s) => s.defaults.columnAnchor ?? 'c')
  const setDefaults = useStore((s) => s.setDefaults)
  const set = (a: ColumnAnchor) => setDefaults({ columnAnchor: a === 'c' ? undefined : a })
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 18px)',
          gridTemplateRows: 'repeat(3, 18px)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          background: 'var(--bg-2)',
          flex: 'none',
        }}
      >
        {COLUMN_ANCHORS.map((a) => (
          <button
            key={a}
            title={ANCHOR_LABEL[a]}
            aria-label={ANCHOR_LABEL[a]}
            aria-pressed={a === anchor}
            onClick={() => set(a)}
            style={{
              display: 'grid',
              placeItems: 'center',
              padding: 0,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
            }}
          >
            <span
              style={{
                width: a === anchor ? 9 : 5,
                height: a === anchor ? 9 : 5,
                borderRadius: '50%',
                background: a === anchor ? 'var(--accent)' : 'var(--text-faint, #7d8596)',
              }}
            />
          </button>
        ))}
      </div>
      <div style={{ fontSize: 11.5, lineHeight: 1.45 }}>
        <div style={{ fontWeight: 600 }}>{ANCHOR_LABEL[anchor]}</div>
        <div className="faint">{hint}</div>
      </div>
    </div>
  )
}

const ALIGN_BUTTONS: { mode: AlignMode; glyph: string; key: string }[] = [
  { mode: 'left', glyph: '⇤', key: 'L' },
  { mode: 'centerX', glyph: '↔', key: 'C' },
  { mode: 'right', glyph: '⇥', key: 'R' },
  { mode: 'top', glyph: '⤒', key: 'T' },
  { mode: 'centerY', glyph: '↕', key: 'E' },
  { mode: 'bottom', glyph: '⤓', key: 'B' },
]

/** alinhar pela âncora e distribuir — atua sobre a seleção múltipla */
function AlignTools({ refs }: { refs: ElementRef[] }) {
  const selection = useStore((s) => s.selection)
  const project = useStore((s) => s.project)
  const alignSelection = useStore((s) => s.alignSelection)
  const distributeSelection = useStore((s) => s.distributeSelection)
  const [msg, setMsg] = useState<string | null>(null)

  const anchorName = useMemo(() => {
    if (!selection) return null
    if (selection.kind === 'column')
      return project.columns.find((c) => c.id === selection.id)?.name ?? null
    for (const pl of project.plans) {
      if (selection.kind === 'beam') {
        const b = pl.beams.find((x) => x.id === selection.id)
        if (b) return b.name
      }
      if (selection.kind === 'loadRegion') {
        const r = pl.loadRegions.find((x) => x.id === selection.id)
        if (r) return r.name
      }
    }
    return null
  }, [selection, project])

  const report = (r: 'ok' | 'none' | 'duplicate') =>
    setMsg(
      r === 'duplicate'
        ? 'Um pilar cairia sobre outro que fica parado.'
        : r === 'none'
          ? 'Nada a mover: os elementos já estão nessa posição.'
          : null,
    )
  const movable = refs.filter(
    (r) => r.kind === 'column' || r.kind === 'beam' || r.kind === 'loadRegion',
  ).length

  return (
    <div className="field">
      <label className="label">
        {anchorName
          ? `Alinhar pela âncora — ${anchorName} fica parado`
          : 'Alinhar — Shift+clique no pilar ou viga de referência'}
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4 }}>
        {ALIGN_BUTTONS.map((b) => (
          <button
            key={b.mode}
            className="btn"
            disabled={!anchorName || movable < 2}
            title={`Alinhar ${ALIGN_LABEL[b.mode]} (Alt+${b.key})`}
            style={{ padding: '4px 0', fontSize: 15, lineHeight: 1 }}
            onClick={() => report(alignSelection(b.mode))}
          >
            {b.glyph}
          </button>
        ))}
      </div>
      <div className="field-row" style={{ marginTop: 6 }}>
        <button
          className="btn"
          disabled={movable < 3}
          title="Centros igualmente espaçados em X; os dois extremos ficam parados"
          onClick={() => report(distributeSelection('x'))}
        >
          Distribuir em X
        </button>
        <button
          className="btn"
          disabled={movable < 3}
          title="Centros igualmente espaçados em Y; os dois extremos ficam parados"
          onClick={() => report(distributeSelection('y'))}
        >
          Distribuir em Y
        </button>
      </div>
      {msg && <div style={{ color: 'var(--err)', fontSize: 11.5, marginTop: 4 }}>{msg}</div>}
      <div className="faint" style={{ fontSize: 11, lineHeight: 1.5, marginTop: 4 }}>
        A âncora é o último elemento clicado com Shift. O alinhamento usa as faces da seção do
        pilar e a largura da viga; lajes acompanham as vigas.
      </div>
    </div>
  )
}

export function MultiInspector({ refs }: { refs: ElementRef[] }) {
  const moveElements = useStore((s) => s.moveElements)
  const rotateColumns = useStore((s) => s.rotateColumns)
  const deleteElements = useStore((s) => s.deleteElements)
  const select = useStore((s) => s.select)
  const [dx, setDx] = useState(0)
  const [dy, setDy] = useState(0)
  const [msg, setMsg] = useState<string | null>(null)

  const counts = new Map<ElementRef['kind'], number>()
  for (const r of refs) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1)
  const colIds = refs.filter((r) => r.kind === 'column').map((r) => r.id)

  return (
    <>
      <h3 className="panel-title">{refs.length} elementos selecionados</h3>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {[...counts].map(([kind, n]) => (
          <span key={kind} className="chip">
            {n} {KIND_LABEL[kind][n === 1 ? 0 : 1]}
          </span>
        ))}
      </div>

      <div className="field">
        <label className="label">Mover o conjunto — Δx · Δy (m)</label>
        <div className="field-row">
          <NumberField value={dx} digits={2} min={-500} max={500} onCommit={setDx} />
          <NumberField value={dy} digits={2} min={-500} max={500} onCommit={setDy} />
          <button
            className="btn"
            disabled={Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9}
            onClick={() => {
              const r = moveElements(refs, { x: dx, y: dy })
              setMsg(r === 'duplicate' ? 'Há um pilar parado na posição de destino.' : null)
            }}
          >
            Mover
          </button>
        </div>
        {msg && (
          <div style={{ color: 'var(--err)', fontSize: 11.5, marginTop: 4 }}>{msg}</div>
        )}
      </div>

      <AlignTools refs={refs} />

      {colIds.length > 0 && (
        <button className="btn" style={{ width: '100%', marginBottom: 8 }} onClick={() => rotateColumns(colIds)}>
          Girar {colIds.length === 1 ? 'o pilar' : `os ${colIds.length} pilares`} 90° (G)
        </button>
      )}

      <div className="faint" style={{ fontSize: 11, lineHeight: 1.6, marginBottom: 12 }}>
        Arraste qualquer elemento do conjunto para mover todos (F8 ou ⟂ restringe a X/Y). Vértices
        de elementos fora da seleção que coincidem com os pontos movidos acompanham. Shift+clique
        soma ou retira; arraste no vazio abre a janela de seleção (da direita para a esquerda
        pega também o que a janela toca).
      </div>

      <button className="btn" style={{ width: '100%', marginBottom: 6 }} onClick={() => select(null)}>
        Limpar seleção (Esc)
      </button>
      <button
        className="btn"
        style={{ width: '100%', color: 'var(--err)', borderColor: 'rgba(255, 92, 105, 0.45)' }}
        onClick={() => deleteElements(refs)}
      >
        Excluir os {refs.length} elementos
      </button>
    </>
  )
}
