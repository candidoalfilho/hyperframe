import { useMemo, useState } from 'react'
import {
  dimRefAt,
  dimRefLabel,
  dimStyleOf,
  dimensionLayout,
  lostDimRefs,
  type AutoDimOptions,
  type DimCategory,
  type DimStyle,
  type Dimension,
  type ElementRef,
} from '@hyperframe/engine'
import { useActivePlan, useStore } from '../store'
import { NumberField } from './NumberField'
import { fmt } from './format'

/**
 * Cotas permanentes (issue #10): padrões da ferramenta, estilo do projeto,
 * cotagem automática e o painel de uma cota selecionada.
 */

const check = { display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, cursor: 'pointer' } as const

const CATEGORY_LABEL: Record<DimCategory, string> = {
  locacao: 'Locação (eixos)',
  dimensao: 'Dimensão (faces)',
  geral: 'Geral (totais)',
}

/** estilo das cotas — vale para o projeto inteiro: editor, pranchas, PDF e DXF */
export function DimStyleFields() {
  const raw = useStore((s) => s.project.dimStyle)
  const setDimStyle = useStore((s) => s.setDimStyle)
  const style = useMemo(() => dimStyleOf({ dimStyle: raw }), [raw])
  return (
    <div className="field">
      <label className="label">Estilo das cotas (todo o projeto)</label>
      <div className="field-row">
        <select
          className="select"
          aria-label="Unidade das cotas"
          title="Unidade"
          value={style.unit}
          onChange={(e) => {
            const unit = e.target.value as DimStyle['unit']
            // casas usuais de cada unidade
            setDimStyle({ unit, decimals: unit === 'm' ? 2 : unit === 'cm' ? 1 : 0 })
          }}
        >
          <option value="cm">cm</option>
          <option value="m">m</option>
          <option value="mm">mm</option>
        </select>
        <select
          className="select"
          aria-label="Casas decimais"
          title="Casas decimais"
          value={style.decimals}
          onChange={(e) => setDimStyle({ decimals: Number(e.target.value) })}
        >
          {[0, 1, 2, 3].map((d) => (
            <option key={d} value={d}>
              {d} {d === 1 ? 'casa' : 'casas'}
            </option>
          ))}
        </select>
      </div>
      <div className="field-row" style={{ marginTop: 6 }}>
        <select
          className="select"
          aria-label="Símbolo de extremidade"
          title="Símbolo de extremidade"
          value={style.terminator}
          onChange={(e) => setDimStyle({ terminator: e.target.value as DimStyle['terminator'] })}
        >
          <option value="tick">Traço a 45°</option>
          <option value="arrow">Seta</option>
          <option value="dot">Ponto</option>
        </select>
        <NumberField
          value={style.textHeight * 100}
          digits={0}
          min={5}
          max={100}
          title="Altura do texto no desenho, em cm na escala da planta"
          onCommit={(v) => setDimStyle({ textHeight: v / 100 })}
        />
        <span className="unit" style={{ flex: 'none' }}>
          cm de texto
        </span>
      </div>
    </div>
  )
}

/** modo e forma da próxima cota (ferramenta Cota ativa) */
export function DimensionDefaults() {
  const defaults = useStore((s) => s.defaults)
  const setDefaults = useStore((s) => s.setDefaults)
  const columns = useStore((s) => s.project.columns)
  const autoDimension = useStore((s) => s.autoDimension)
  const [msg, setMsg] = useState<string | null>(null)
  const mode = defaults.dimMode ?? 'linear'
  const form = defaults.dimForm ?? 'single'
  const allCols: ElementRef[] = columns.map((c) => ({ kind: 'column', id: c.id }))
  return (
    <>
      <div className="field">
        <label className="label">Próxima cota — tipo · forma</label>
        <div className="field-row">
          <select
            className="select"
            aria-label="Tipo de cota"
            value={mode}
            onChange={(e) => setDefaults({ dimMode: e.target.value as 'linear' | 'aligned' })}
          >
            <option value="linear">Linear (horizontal/vertical)</option>
            <option value="aligned">Alinhada (distância real)</option>
          </select>
          <select
            className="select"
            aria-label="Forma da cota"
            value={form}
            onChange={(e) => setDefaults({ dimForm: e.target.value as 'single' | 'chain' | 'baseline' })}
          >
            <option value="single">Simples (2 pontos)</option>
            <option value="chain">Em cadeia</option>
            <option value="baseline">Acumulada</option>
          </select>
        </div>
        <div className="faint" style={{ fontSize: 10.5, margin: '4px 0 6px', lineHeight: 1.45 }}>
          {form === 'single'
            ? 'Clique os dois pontos e depois a posição da linha de cota.'
            : 'Clique os pontos, Enter (ou duplo-clique) e depois a posição da linha de cota.'}{' '}
          {mode === 'linear' && 'Puxe a linha para cima/baixo para cotar em X; para o lado, em Y.'}
          {form === 'baseline' && ' O 1º ponto é a origem.'}
        </div>
        {form === 'chain' && (
          <label style={{ ...check, marginBottom: 4 }}>
            <input
              type="checkbox"
              checked={defaults.dimTotal ?? true}
              onChange={(e) => setDefaults({ dimTotal: e.target.checked })}
            />
            Linha extra com o total
          </label>
        )}
        <label style={check} title="A cota acompanha o pilar, a viga ou o eixo quando eles são movidos">
          <input
            type="checkbox"
            checked={defaults.dimAssoc ?? true}
            onChange={(e) => setDefaults({ dimAssoc: e.target.checked })}
          />
          Prender os pontos ao modelo
        </label>
      </div>

      <div className="field">
        <label className="label">Cotar todos os pilares do pavimento</label>
        <div className="field-row">
          <button
            className="btn"
            disabled={allCols.length < 2}
            title="Cadeia entre eixos de pilares em X, abaixo da planta, com o total"
            onClick={() =>
              setMsg(
                autoDimension({ dir: 'h', mode: 'axes', side: 'min', total: true }, allCols) === 'ok'
                  ? null
                  : 'Menos de dois alinhamentos nessa direção.',
              )
            }
          >
            Eixos em X
          </button>
          <button
            className="btn"
            disabled={allCols.length < 2}
            title="Cadeia entre eixos de pilares em Y, à esquerda da planta, com o total"
            onClick={() =>
              setMsg(
                autoDimension({ dir: 'v', mode: 'axes', side: 'min', total: true }, allCols) === 'ok'
                  ? null
                  : 'Menos de dois alinhamentos nessa direção.',
              )
            }
          >
            Eixos em Y
          </button>
        </div>
        {msg && <div style={{ color: 'var(--err)', fontSize: 11.5, marginTop: 4 }}>{msg}</div>}
        <div className="faint" style={{ fontSize: 10.5, marginTop: 4, lineHeight: 1.45 }}>
          Para cotar só alguns elementos (ou entre faces), selecione-os com a janela e use “Cotar a
          seleção” no painel.
        </div>
      </div>

      <DimStyleFields />
    </>
  )
}

/** cotagem automática da seleção múltipla (pilares e vigas) */
export function AutoDimTools({ refs }: { refs: ElementRef[] }) {
  const autoDimension = useStore((s) => s.autoDimension)
  const plan = useActivePlan()
  const [mode, setMode] = useState<AutoDimOptions['mode']>('axes')
  const [total, setTotal] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  const usable = refs.filter((r) => r.kind === 'column' || r.kind === 'beam')
  if (!plan || usable.length < 2) return null
  const run = (dir: 'h' | 'v', side: 'min' | 'max') =>
    setMsg(
      autoDimension({ dir, mode, side, total }, usable) === 'ok'
        ? null
        : 'Os elementos selecionados estão todos no mesmo alinhamento nessa direção.',
    )
  return (
    <div className="field">
      <label className="label">Cotar a seleção — uma cadeia por direção</label>
      <div className="field-row">
        <select
          className="select"
          aria-label="Referência da cotagem"
          value={mode}
          onChange={(e) => setMode(e.target.value as AutoDimOptions['mode'])}
        >
          <option value="axes">Entre eixos</option>
          <option value="faces">Entre faces dos pilares</option>
        </select>
        <label style={{ ...check, flex: 'none' }}>
          <input type="checkbox" checked={total} onChange={(e) => setTotal(e.target.checked)} />
          com total
        </label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginTop: 6 }}>
        <button className="btn" title="Cotas em X, linha acima dos elementos" onClick={() => run('h', 'max')}>
          X — acima
        </button>
        <button className="btn" title="Cotas em Y, linha à direita dos elementos" onClick={() => run('v', 'max')}>
          Y — à direita
        </button>
        <button className="btn" title="Cotas em X, linha abaixo dos elementos" onClick={() => run('h', 'min')}>
          X — abaixo
        </button>
        <button className="btn" title="Cotas em Y, linha à esquerda dos elementos" onClick={() => run('v', 'min')}>
          Y — à esquerda
        </button>
      </div>
      {msg && <div style={{ color: 'var(--err)', fontSize: 11.5, marginTop: 4 }}>{msg}</div>}
      <div className="faint" style={{ fontSize: 11, lineHeight: 1.5, marginTop: 4 }}>
        Um ponto por alinhamento (pilares na mesma linha não repetem a cota), presos aos elementos.
        Depois arraste a linha de cota para afastar ou aproximar.
      </div>
    </div>
  )
}

export default function DimensionInspector({ dim }: { dim: Dimension }) {
  const update = useStore((s) => s.updateDimension)
  const deleteElement = useStore((s) => s.deleteElement)
  const project = useStore((s) => s.project)
  const plan = useMemo(
    () => project.plans.find((pl) => pl.dimensions?.some((d) => d.id === dim.id)) ?? null,
    [project, dim.id],
  )
  const style = dimStyleOf(project)
  const layout = useMemo(() => dimensionLayout(dim, style), [dim, style])
  if (!plan) return null
  const lost = lostDimRefs(project, plan, dim)
  const many = dim.points.length > 2
  const setPoint = (i: number, ref: Dimension['points'][number]['ref'] | undefined) =>
    update(dim.id, {
      points: dim.points.map((pt, j) => (j !== i ? pt : ref ? { p: pt.p, ref } : { p: pt.p })),
    })
  const anchored = dim.points.filter((pt) => pt.ref).length
  const unit = style.unit

  return (
    <>
      <h3 className="panel-title">{dim.name}</h3>

      <div className="field">
        <label className="label">Direção medida</label>
        <select
          className="select"
          aria-label="Direção medida"
          style={{ width: '100%' }}
          value={dim.dir}
          onChange={(e) => update(dim.id, { dir: e.target.value as Dimension['dir'] })}
        >
          <option value="h">Horizontal (Δx)</option>
          <option value="v">Vertical (Δy)</option>
          <option value="aligned">Alinhada (do 1º ao último ponto)</option>
        </select>
      </div>

      {many && (
        <div className="field">
          <label className="label">Forma</label>
          <select
            className="select"
            aria-label="Forma da cota"
            style={{ width: '100%' }}
            value={dim.form}
            onChange={(e) => update(dim.id, { form: e.target.value as Dimension['form'] })}
          >
            <option value="chain">Em cadeia (trecho a trecho)</option>
            <option value="baseline">Acumulada (desde o 1º ponto)</option>
          </select>
          {dim.form === 'chain' && (
            <label style={{ ...check, marginTop: 6 }}>
              <input
                type="checkbox"
                checked={!!dim.total}
                onChange={(e) => update(dim.id, { total: e.target.checked })}
              />
              Linha extra com o total
            </label>
          )}
        </div>
      )}

      <div className="field">
        <label className="label">Afastamento da linha de cota (m)</label>
        <div className="field-row" style={{ alignItems: 'center' }}>
          <NumberField
            value={dim.offset}
            digits={2}
            min={-200}
            max={200}
            onCommit={(v) => update(dim.id, { offset: v })}
          />
          <button
            className="btn"
            title="Passa a linha de cota para o outro lado dos pontos"
            onClick={() => update(dim.id, { offset: -dim.offset })}
          >
            Inverter lado
          </button>
        </div>
        <div className="faint" style={{ fontSize: 10.5, marginTop: 3 }}>
          Medido a partir do 1º ponto. Também dá para arrastar a cota na planta.
        </div>
      </div>

      <div className="field">
        <label className="label">Finalidade</label>
        <select
          className="select"
          aria-label="Finalidade da cota"
          style={{ width: '100%' }}
          value={dim.category ?? 'geral'}
          onChange={(e) => update(dim.id, { category: e.target.value as DimCategory })}
        >
          {(Object.keys(CATEGORY_LABEL) as DimCategory[]).map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <label style={{ ...check, marginTop: 6 }} title="A cota continua no projeto e aparece esmaecida no editor">
          <input
            type="checkbox"
            checked={!!dim.hidden}
            onChange={(e) => update(dim.id, { hidden: e.target.checked })}
          />
          Não mostrar nas pranchas
        </label>
      </div>

      <div className="field">
        <label className="label">
          Valores ({unit}) — {dim.form === 'baseline' ? 'desde a origem' : many ? 'por trecho' : 'medida'}
        </label>
        <div className="mono" style={{ fontSize: 12, lineHeight: 1.6 }} data-testid="dim-values">
          {layout.labels.map((l) => l.text).join(' · ')}
        </div>
      </div>

      <div className="field">
        <label className="label">
          Pontos — {anchored} de {dim.points.length} presos ao modelo
        </label>
        {dim.points.map((pt, i) => {
          const isLost = lost.includes(i)
          const candidate = pt.ref ? null : dimRefAt(project, plan, pt.p)
          return (
            <div
              key={i}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, padding: '2px 0' }}
            >
              <span className="mono faint" style={{ flex: 'none', width: 92 }}>
                {fmt(pt.p.x, 2)} ; {fmt(pt.p.y, 2)}
              </span>
              <span
                style={{
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: isLost ? 'var(--warn)' : pt.ref ? 'var(--text)' : 'var(--text-faint)',
                }}
                title={pt.ref ? dimRefLabel(project, plan, pt.ref) : 'ponto livre'}
              >
                {pt.ref ? dimRefLabel(project, plan, pt.ref) : 'livre'}
              </span>
              {pt.ref ? (
                <button
                  className="btn btn-ghost"
                  style={{ height: 20, fontSize: 10.5, padding: '0 6px' }}
                  title="Solta o ponto: ele fica onde está e deixa de acompanhar o elemento"
                  onClick={() => setPoint(i, undefined)}
                >
                  soltar
                </button>
              ) : candidate ? (
                <button
                  className="btn btn-ghost"
                  style={{ height: 20, fontSize: 10.5, padding: '0 6px' }}
                  title={`Prender em ${dimRefLabel(project, plan, candidate)}`}
                  onClick={() => setPoint(i, candidate)}
                >
                  prender
                </button>
              ) : null}
            </div>
          )
        })}
        {lost.length > 0 && (
          <div className="chip warn" style={{ marginTop: 6, height: 'auto', padding: '4px 8px', whiteSpace: 'normal' }}>
            {lost.length === 1 ? 'Um ponto perdeu' : `${lost.length} pontos perderam`} a referência
            (elemento excluído). A cota ficou parada; solte o ponto ou exclua a cota.
          </div>
        )}
      </div>

      <button
        className="btn"
        style={{ width: '100%', color: 'var(--err)', borderColor: 'rgba(255, 92, 105, 0.45)' }}
        onClick={() => deleteElement({ kind: 'dimension', id: dim.id })}
      >
        Excluir a cota
      </button>
    </>
  )
}
