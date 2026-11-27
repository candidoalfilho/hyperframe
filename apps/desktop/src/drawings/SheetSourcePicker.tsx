import { useMemo, useState } from 'react'
import {
  SHEET_SOURCE_GROUPS,
  sheetSourceKey,
  type SheetLayout,
  type SheetSource,
  type SheetSourceOption,
} from '@hyperframe/engine'
import { IconClose } from '../components/Icons'

/**
 * Escolha dos desenhos de uma prancha (issue #28): lista com caixas de
 * seleção, por categoria, com busca, filtro por categoria e por pavimento,
 * "selecionar todos" e a marca de quais desenhos já estão em alguma prancha.
 */

/** onde um desenho já está: quantas vezes nesta prancha e em quais outras */
export interface SheetUsage {
  here: number
  /** número (01, 02…) das outras pranchas que o têm */
  others: string[]
}

/** uso de cada desenho nas pranchas do projeto, por chave da origem */
export function sheetUsage(sheets: SheetLayout[], sheetId: string): Map<string, SheetUsage> {
  const out = new Map<string, SheetUsage>()
  sheets.forEach((sh, i) => {
    const label = String(i + 1).padStart(2, '0')
    for (const it of sh.items) {
      const key = sheetSourceKey(it.source)
      const u = out.get(key) ?? { here: 0, others: [] }
      if (sh.id === sheetId) u.here++
      else if (!u.others.includes(label)) u.others.push(label)
      out.set(key, u)
    }
  })
  return out
}

/** minúsculas e sem acentos, para a busca */
const norm = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

export interface SheetPickerFilter {
  text: string
  /** '' = todas as categorias */
  group: string
  /** '' = todos os pavimentos */
  planId: string
  /** esconde os desenhos que já estão em alguma prancha */
  hideUsed: boolean
}

/** desenhos que passam pelo filtro, na ordem da lista */
export function filterSheetOptions(
  options: SheetSourceOption[],
  filter: SheetPickerFilter,
  usage: Map<string, SheetUsage>,
): SheetSourceOption[] {
  const words = norm(filter.text).split(/\s+/).filter(Boolean)
  return options.filter((o) => {
    if (filter.group && o.group !== filter.group) return false
    if (filter.planId && o.planId !== filter.planId) return false
    if (filter.hideUsed && usage.has(o.key)) return false
    const label = norm(o.label)
    return words.every((w) => label.includes(w))
  })
}

/** categorias na ordem do motor, só as que têm desenhos */
export function groupSheetOptions(options: SheetSourceOption[]): { group: string; options: SheetSourceOption[] }[] {
  const order: string[] = [...SHEET_SOURCE_GROUPS]
  for (const o of options) if (!order.includes(o.group)) order.push(o.group)
  return order
    .map((group) => ({ group, options: options.filter((o) => o.group === group) }))
    .filter((g) => g.options.length > 0)
}

const rowStyle = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '3px 6px', cursor: 'pointer', borderRadius: 6 } as const

export default function SheetSourcePicker({
  options,
  plans,
  usage,
  sheetName,
  hasResults,
  onAdd,
  onClose,
}: {
  options: SheetSourceOption[]
  plans: { id: string; name: string }[]
  usage: Map<string, SheetUsage>
  sheetName: string
  hasResults: boolean
  /** `overflow`: o que não couber vai para pranchas novas */
  onAdd: (sources: SheetSource[], overflow: boolean) => void
  onClose: () => void
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<SheetPickerFilter>({ text: '', group: '', planId: '', hideUsed: false })
  const [overflow, setOverflow] = useState(true)

  const visible = useMemo(() => filterSheetOptions(options, filter, usage), [options, filter, usage])
  const groups = useMemo(() => groupSheetOptions(visible), [visible])
  const allGroups = useMemo(() => groupSheetOptions(options), [options])
  const chosen = options.filter((o) => checked.has(o.key))

  const setMany = (keys: string[], on: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev)
      for (const k of keys) {
        if (on) next.add(k)
        else next.delete(k)
      }
      return next
    })
  const visibleKeys = visible.map((o) => o.key)
  const visibleChecked = visibleKeys.filter((k) => checked.has(k)).length
  const filtered = filter.text !== '' || filter.group !== '' || filter.planId !== '' || filter.hideUsed

  return (
    <div className="modal-overlay">
      <div
        className="modal"
        style={{ width: 640, maxWidth: 640, height: '82vh' }}
        role="dialog"
        aria-label="Adicionar desenhos à prancha"
        data-testid="sheet-picker"
      >
        <div className="modal-header">
          <span>Adicionar desenhos — {sheetName}</span>
          <button className="btn-icon" style={{ width: 28, height: 28 }} title="Fechar" onClick={onClose}>
            <IconClose size={15} />
          </button>
        </div>

        <div style={{ padding: '12px 18px 8px', borderBottom: '1px solid var(--border)', flex: 'none' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              className="input"
              aria-label="Buscar desenho"
              placeholder="Buscar: V12, pilar, fundação…"
              style={{ flex: 1, minWidth: 160, height: 28 }}
              value={filter.text}
              autoFocus
              onChange={(e) => setFilter({ ...filter, text: e.target.value })}
            />
            <select
              className="select"
              aria-label="Categoria"
              value={filter.group}
              onChange={(e) => setFilter({ ...filter, group: e.target.value })}
            >
              <option value="">Todas as categorias</option>
              {allGroups.map((g) => (
                <option key={g.group} value={g.group}>
                  {g.group} ({g.options.length})
                </option>
              ))}
            </select>
            <select
              className="select"
              aria-label="Pavimento"
              value={filter.planId}
              onChange={(e) => setFilter({ ...filter, planId: e.target.value })}
            >
              <option value="">Todos os pavimentos</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
            <button className="btn" disabled={visibleKeys.length === 0} onClick={() => setMany(visibleKeys, true)}>
              {filtered ? 'Selecionar os listados' : 'Selecionar todos'}
            </button>
            <button className="btn" disabled={checked.size === 0} onClick={() => setChecked(new Set())}>
              Desmarcar todos
            </button>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={filter.hideUsed}
                onChange={(e) => setFilter({ ...filter, hideUsed: e.target.checked })}
              />
              Só os que ainda não estão em nenhuma prancha
            </label>
            <span className="faint" style={{ fontSize: 11.5, marginLeft: 'auto' }} data-testid="sheet-picker-count">
              {checked.size} de {options.length} marcados
            </span>
          </div>
        </div>

        <div className="modal-body" style={{ flex: 1, padding: '8px 12px' }} data-testid="sheet-picker-list">
          {groups.length === 0 && (
            <div className="faint" style={{ fontSize: 12.5, padding: 12 }}>
              Nenhum desenho com esse filtro.
            </div>
          )}
          {groups.map((g) => {
            const keys = g.options.map((o) => o.key)
            const n = keys.filter((k) => checked.has(k)).length
            return (
              <div key={g.group} style={{ marginBottom: 10 }}>
                <label style={{ ...rowStyle, fontWeight: 600, background: 'var(--bg-2)' }}>
                  <input
                    type="checkbox"
                    aria-label={`Categoria ${g.group}`}
                    checked={n === keys.length}
                    ref={(el) => {
                      if (el) el.indeterminate = n > 0 && n < keys.length
                    }}
                    onChange={(e) => setMany(keys, e.target.checked)}
                  />
                  <span>{g.group}</span>
                  <span className="faint" style={{ fontSize: 11, fontWeight: 400, marginLeft: 'auto' }}>
                    {n > 0 ? `${n} de ${keys.length}` : keys.length}
                  </span>
                </label>
                {g.options.map((o) => {
                  const u = usage.get(o.key)
                  return (
                    <label key={o.key} style={{ ...rowStyle, paddingLeft: 22 }} data-testid="sheet-picker-row">
                      <input
                        type="checkbox"
                        checked={checked.has(o.key)}
                        onChange={(e) => setMany([o.key], e.target.checked)}
                      />
                      <span>{o.label}</span>
                      <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                        {u && u.here > 0 && (
                          <span className="chip ok" title="Já está nesta prancha">
                            nesta prancha{u.here > 1 ? ` ×${u.here}` : ''}
                          </span>
                        )}
                        {u && u.others.length > 0 && (
                          <span className="chip" title="Já está em outra prancha do projeto">
                            prancha {u.others.join(', ')}
                          </span>
                        )}
                      </span>
                    </label>
                  )
                })}
              </div>
            )
          })}
          {!hasResults && (
            <div className="faint" style={{ fontSize: 11.5, padding: '4px 8px' }}>
              Rode a análise para listar também as armações de vigas, pilares e lajes, as fundações e
              as tabelas.
            </div>
          )}
        </div>

        <div className="modal-footer" style={{ alignItems: 'center' }}>
          <label
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', marginRight: 'auto' }}
            title="Desmarcado: tudo entra nesta folha, em escala menor se preciso; sem lugar, o desenho fica sobreposto e a conferência avisa."
          >
            <input type="checkbox" checked={overflow} onChange={(e) => setOverflow(e.target.checked)} />
            O que não couber vai para pranchas novas
          </label>
          {filtered && visibleChecked < checked.size && (
            <span className="faint" style={{ fontSize: 11 }}>
              {checked.size - visibleChecked} marcados fora do filtro
            </span>
          )}
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn btn-primary"
            disabled={chosen.length === 0}
            onClick={() => onAdd(chosen.map((o) => o.source), overflow)}
          >
            {chosen.length === 0
              ? 'Adicionar'
              : `Adicionar ${chosen.length} ${chosen.length === 1 ? 'desenho' : 'desenhos'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
