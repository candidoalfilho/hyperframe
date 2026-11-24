import { useMemo, useState } from 'react'
import type { SteelSummary } from '@hyperframe/engine'
import { exportFile } from '../io/fileio'
import { fmt } from './format'

const phiMm = (phi: number) => fmt(phi * 1000, phi * 1000 % 1 === 0 ? 0 : 1)
type Filter = 'todos' | 'Viga' | 'Pilar'

/**
 * Relação de aço por elemento: posição (N), bitola, quantidade, comprimento
 * unitário e total, peso — com subtotal por elemento, visão por pavimento
 * (uma repetição) e exportação CSV p/ orçamento e compra.
 */
export default function SteelSchedule({ steel, projectName }: { steel: SteelSummary; projectName: string }) {
  const [filter, setFilter] = useState<Filter>('todos')
  const [perFloor, setPerFloor] = useState(false)
  const [open, setOpen] = useState<Set<string>>(new Set())

  const groups = useMemo(() => {
    const map = new Map<string, SteelSummary['items']>()
    for (const it of steel.items) {
      if (filter !== 'todos' && !it.element.startsWith(filter)) continue
      const list = map.get(it.element) ?? []
      list.push(it)
      map.set(it.element, list)
    }
    return [...map.entries()].sort((a, b) =>
      a[0].localeCompare(b[0], 'pt-BR', { numeric: true }),
    )
  }, [steel.items, filter])

  // "por pavimento" divide pelas repetições da planta (n, comprimento total e peso)
  const scale = (it: SteelSummary['items'][number]) => (perFloor ? 1 / Math.max(it.reps ?? 1, 1) : 1)
  const totalKg = groups.reduce(
    (acc, [, items]) => acc + items.reduce((s, it) => s + it.kg * scale(it), 0),
    0,
  )

  const toggle = (el: string) =>
    setOpen((cur) => {
      const next = new Set(cur)
      if (next.has(el)) next.delete(el)
      else next.add(el)
      return next
    })

  const exportCsv = () => {
    const num = (v: number, d: number) => v.toFixed(d).replace('.', ',')
    const rows = [
      ['Elemento', 'Posição', 'Bitola (mm)', 'Quantidade', 'Comprimento unitário (m)', 'Comprimento total (m)', 'Peso (kg)', 'Repetições', 'Observação'],
      ...groups.flatMap(([el, items]) =>
        items.map((it) => [
          el,
          `N${it.pos}`,
          phiMm(it.phi),
          String(Math.round(it.n * scale(it))),
          num(it.unitLength, 2),
          num(it.totalLength * scale(it), 2),
          num(it.kg * scale(it), 2),
          String(perFloor ? 1 : (it.reps ?? 1)),
          it.note ?? '',
        ]),
      ),
    ]
    // ; como separador e BOM: abre direto no Excel em pt-BR
    const csv = '﻿' + rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(';')).join('\r\n')
    const slug = projectName.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'projeto'
    void exportFile(csv, `relacao-de-aco-${slug}.csv`, 'CSV', 'csv', 'text/csv')
  }

  if (steel.items.length === 0) return null

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '4px 0 10px' }}>
        <select className="select" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          <option value="todos">Vigas e pilares</option>
          <option value="Viga">Só vigas</option>
          <option value="Pilar">Só pilares</option>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer' }}>
          <input type="checkbox" checked={perFloor} onChange={(e) => setPerFloor(e.target.checked)} />
          por pavimento (uma repetição da planta)
        </label>
        <button
          className="btn"
          onClick={() => setOpen(open.size === groups.length ? new Set() : new Set(groups.map(([el]) => el)))}
        >
          {open.size === groups.length ? 'Recolher tudo' : 'Expandir tudo'}
        </button>
        <button className="btn" onClick={exportCsv}>
          Exportar CSV
        </button>
        <span className="faint" style={{ fontSize: 12, marginLeft: 'auto' }}>
          {groups.length} elementos · {fmt(totalKg, 1)} kg
        </span>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Elemento / posição</th>
            <th>φ (mm)</th>
            <th>Quantidade</th>
            <th>Compr. unitário (m)</th>
            <th>Compr. total (m)</th>
            <th>Peso (kg)</th>
            <th>Observação</th>
          </tr>
        </thead>
        <tbody>
          {groups.flatMap(([el, items]) => {
            const kg = items.reduce((s, it) => s + it.kg * scale(it), 0)
            const reps = items[0]?.reps ?? 1
            const isOpen = open.has(el)
            return [
              <tr key={el} onClick={() => toggle(el)} style={{ cursor: 'pointer' }}>
                <td style={{ fontWeight: 600, fontFamily: 'var(--sans)' }}>
                  <span style={{ display: 'inline-block', width: 14, color: 'var(--text-dim)' }}>
                    {isOpen ? '▾' : '▸'}
                  </span>
                  {el}
                  {reps > 1 && !perFloor ? <span className="faint"> · ×{reps} pavimentos</span> : null}
                </td>
                <td colSpan={4} className="faint">
                  {items.length} posições
                </td>
                <td style={{ fontWeight: 600 }}>{fmt(kg, 1)}</td>
                <td />
              </tr>,
              ...(isOpen
                ? items.map((it) => (
                    <tr key={`${el}-${it.pos}`}>
                      <td style={{ paddingLeft: 30 }}>N{it.pos}</td>
                      <td>{phiMm(it.phi)}</td>
                      <td>{Math.round(it.n * scale(it))}</td>
                      <td>{fmt(it.unitLength, 2)}</td>
                      <td>{fmt(it.totalLength * scale(it), 2)}</td>
                      <td>{fmt(it.kg * scale(it), 1)}</td>
                      <td className="faint" style={{ fontFamily: 'var(--sans)', fontSize: 11 }}>
                        {it.note ?? ''}
                      </td>
                    </tr>
                  ))
                : []),
            ]
          })}
        </tbody>
      </table>
    </>
  )
}
