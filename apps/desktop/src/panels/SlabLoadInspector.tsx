import { useMemo } from 'react'
import {
  SLAB_LOAD_SIZE_DEFAULT,
  pointInPolygon,
  slabLoadG,
  slabLoadLength,
  slabLoadTotal,
  wallLoadFromCalc,
  type SlabLoad,
  type WallLoadCalc,
} from '@hyperframe/engine'
import { useStore } from '../store'
import { NumberField } from './NumberField'
import { cm, fmt } from './format'
import { WallCompositionFields } from './InspectorExtras'

/** padrões de inserção da ferramenta "Carga na laje" (painel do projeto) */
export function SlabLoadDefaults() {
  const defaults = useStore((s) => s.defaults)
  const setDefaults = useStore((s) => s.setDefaults)
  const kind = defaults.slabLoadKind ?? 'point'
  const unit = kind === 'line' ? 'kN/m' : 'kN'
  return (
    <div className="field">
      <label className="label">Carga na laje — tipo · g · q ({unit})</label>
      <div className="field-row">
        <select
          className="select"
          style={{ flex: 1.6, minWidth: 0 }}
          value={kind}
          onChange={(e) =>
            setDefaults({
              slabLoadKind: e.target.value as 'point' | 'line',
              // os valores padrão trocam de unidade junto com o tipo
              slabLoadG: e.target.value === 'line' ? 5 : 10,
              slabLoadQ: 0,
            })
          }
        >
          <option value="point">Pontual (1 clique)</option>
          <option value="line">Linear (2 cliques)</option>
        </select>
        <NumberField
          value={defaults.slabLoadG ?? (kind === 'line' ? 5 : 10)}
          digits={2}
          min={0}
          max={5000}
          title="Permanente"
          onCommit={(v) => setDefaults({ slabLoadG: v })}
        />
        <NumberField
          value={defaults.slabLoadQ ?? 0}
          digits={2}
          min={0}
          max={5000}
          title="Variável"
          onCommit={(v) => setDefaults({ slabLoadQ: v })}
        />
      </div>
      <div className="faint" style={{ fontSize: 10.5, marginTop: 2 }}>
        Pontual: equipamento, pé de reservatório. Linear: parede apoiada na laje.
      </div>
    </div>
  )
}

const round2 = (v: number) => Math.round(v * 100) / 100

export default function SlabLoadInspector({ load }: { load: SlabLoad }) {
  const update = useStore((s) => s.updateSlabLoad)
  const deleteElement = useStore((s) => s.deleteElement)
  const project = useStore((s) => s.project)
  const results = useStore((s) => s.results)

  const plan = useMemo(
    () => project.plans.find((pl) => pl.slabLoads?.some((l) => l.id === load.id)),
    [project.plans, load.id],
  )
  const isLine = load.kind === 'line' && !!load.b
  const length = slabLoadLength(load)
  const unit = isLine ? 'kN/m' : 'kN'
  const total = slabLoadTotal(load)
  const size = load.size ?? SLAB_LOAD_SIZE_DEFAULT

  // laje(s) sob a carga: a do ponto inicial e, na linear, a do ponto final
  const slabs = useMemo(() => {
    if (!plan) return []
    const pts = load.b ? [load.a, load.b] : [load.a]
    const found = new Set<string>()
    for (const p of pts) {
      const s = plan.slabs.find((sl) => pointInPolygon(p, sl.polygon))
      if (s) found.add(s.id)
    }
    return plan.slabs.filter((s) => found.has(s.id))
  }, [plan, load.a, load.b])

  const applyCalc = (next: WallLoadCalc | undefined) => {
    if (!next) {
      update(load.id, { calc: undefined })
      return
    }
    update(load.id, {
      calc: next,
      g: round2(wallLoadFromCalc(next, length).w),
      label: `${next.block} · h ${fmt(next.height, 2)} m`,
    })
  }

  // notas do dimensionamento das lajes sob a carga que falam das concentradas
  const notes = useMemo(() => {
    if (!results) return []
    const out: { slab: string; level: string; status: string; text: string }[] = []
    for (const s of slabs) {
      for (const item of results.slabDesign.filter((x) => x.slabId === s.id)) {
        for (const n of item.notes) {
          if (/oncentrad|Punção sob|JUSTAPOSTAS|Carga linear|Carga pontual/.test(n))
            out.push({ slab: item.name, level: item.levelName, status: item.status, text: n })
        }
        break // mesma planta em vários pavimentos: um basta
      }
    }
    return out
  }, [results, slabs])

  const setPoint = (key: 'a' | 'b', axis: 'x' | 'y', v: number) => {
    const p = key === 'a' ? load.a : load.b
    if (!p) return
    update(load.id, { [key]: { ...p, [axis]: v } })
  }

  return (
    <>
      <h3 className="panel-title">
        Carga na laje {load.name} — {isLine ? 'linear' : 'pontual'}
      </h3>

      <div className="field">
        <label className="label">Nome</label>
        <input
          className="input"
          style={{ width: '100%' }}
          value={load.name}
          spellCheck={false}
          onChange={(e) => update(load.id, { name: e.target.value })}
        />
      </div>

      <div className="field">
        <label className="label">{isLine ? 'Início — x · y (m)' : 'Posição — x · y (m)'}</label>
        <div className="field-row">
          <NumberField value={load.a.x} digits={2} min={-500} max={500} onCommit={(v) => setPoint('a', 'x', v)} />
          <NumberField value={load.a.y} digits={2} min={-500} max={500} onCommit={(v) => setPoint('a', 'y', v)} />
        </div>
      </div>
      {isLine && load.b && (
        <div className="field">
          <label className="label">Fim — x · y (m) · comprimento {fmt(length, 2)} m</label>
          <div className="field-row">
            <NumberField value={load.b.x} digits={2} min={-500} max={500} onCommit={(v) => setPoint('b', 'x', v)} />
            <NumberField value={load.b.y} digits={2} min={-500} max={500} onCommit={(v) => setPoint('b', 'y', v)} />
          </div>
        </div>
      )}

      <div className="field">
        <label className="label">
          Permanente g · variável q ({unit}){load.calc ? ' — g vem da composição' : ''}
        </label>
        <div className="field-row">
          <NumberField
            value={load.calc ? round2(slabLoadG(load)) : load.g}
            digits={2}
            min={0}
            max={5000}
            disabled={!!load.calc}
            onCommit={(v) => update(load.id, { g: v })}
          />
          <NumberField value={load.q} digits={2} min={0} max={5000} onCommit={(v) => update(load.id, { q: v })} />
        </div>
        <div className="faint" style={{ fontSize: 11, marginTop: 3 }}>
          Resultante: {fmt(total.g, 1)} kN (g) + {fmt(total.q, 1)} kN (q)
        </div>
      </div>

      {isLine ? (
        <WallCompositionFields calc={load.calc} length={length} onChange={applyCalc} />
      ) : (
        <div className="field">
          <label className="label">Área carregada — lado em X · lado em Y (cm)</label>
          <div className="field-row">
            <NumberField
              value={cm(size.bx)}
              digits={0}
              min={5}
              max={300}
              onCommit={(v) => update(load.id, { size: { ...size, bx: v / 100 } })}
            />
            <NumberField
              value={cm(size.by)}
              digits={0}
              min={5}
              max={300}
              onCommit={(v) => update(load.id, { size: { ...size, by: v / 100 } })}
            />
          </div>
          <div className="faint" style={{ fontSize: 10.5, marginTop: 2 }}>
            Usada na punção: quanto maior a base de apoio, menor a tensão na laje.
          </div>
        </div>
      )}

      <div className="field">
        <label className="label">Descrição</label>
        <input
          className="input"
          style={{ width: '100%' }}
          value={load.label ?? ''}
          placeholder={isLine ? 'ex.: parede de vedação' : 'ex.: bomba, pé do reservatório'}
          onChange={(e) => update(load.id, { label: e.target.value || undefined })}
        />
      </div>

      <div className="field">
        <label className="label">Laje sob a carga</label>
        {slabs.length > 0 ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {slabs.map((s) => (
              <span key={s.id} className="chip">
                {s.name} ·{' '}
                {s.ribbed?.lattice ? 'treliçada' : s.ribbed ? 'nervurada' : 'maciça'} · h{' '}
                {fmt(s.thickness * 100, 0)} cm
              </span>
            ))}
          </div>
        ) : (
          <div style={{ color: 'var(--err)', fontSize: 11.5 }}>
            Nenhuma laje sob a carga — ela não será aplicada. Mova para dentro de uma laje.
          </div>
        )}
      </div>

      {notes.length > 0 && (
        <div className="field">
          <label className="label">Verificação da laje</label>
          {notes.map((n, i) => (
            <div
              key={i}
              style={{
                fontSize: 11.5,
                lineHeight: 1.5,
                marginBottom: 6,
                paddingLeft: 8,
                borderLeft: `2px solid ${n.status === 'falha' ? 'var(--err)' : n.status === 'atencao' ? 'var(--warn, #e0a030)' : 'var(--ok, #50c878)'}`,
              }}
            >
              <b>{n.slab}</b> — {n.text}
            </div>
          ))}
        </div>
      )}
      {!results && (
        <div className="faint" style={{ fontSize: 11, lineHeight: 1.5, marginBottom: 10 }}>
          Analise para ver o efeito na laje (momentos, punção ou vigotas) e nas vigas de apoio.
        </div>
      )}

      <button
        className="btn"
        style={{ width: '100%', color: 'var(--err)', borderColor: 'rgba(255, 92, 105, 0.45)' }}
        onClick={() => deleteElement({ kind: 'slabLoad', id: load.id })}
      >
        Excluir carga
      </button>
    </>
  )
}
