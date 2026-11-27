import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  SHEET_FORMATS,
  STANDARD_SCALES,
  buildDrawingPdf,
  buildDrawingsPdf,
  composeSheetLayout,
  fitItemScale,
  sheetAreas,
  sheetSourceOptions,
  writeDxf,
  type SheetFormat,
  type SheetLayout,
  type SheetSource,
} from '@hyperframe/engine'
import { useStore } from '../store'
import { cssPxScale } from '../ui/zoom'
import { IconDownload } from '../components/Icons'
import DrawingSvg, { type DrawingView } from './DrawingSvg'

/**
 * Compositor de pranchas (issue #23): vários desenhos do projeto na mesma
 * folha. Cada desenho tem posição, escala e rotação próprias; as pranchas
 * ficam salvas no projeto. O desenho final vem de `composeSheetLayout` (motor),
 * o mesmo que vai para o PDF e o DXF.
 */

const FORMAT_IDS: SheetFormat[] = ['A0', 'A1', 'A2', 'A3', 'A4']

function slug(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'prancha'
  )
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** arredonda ao milímetro de papel */
const mm = (v: number): number => Math.round(v * 1000) / 1000

export default function SheetComposer() {
  const project = useStore((s) => s.project)
  const results = useStore((s) => s.results)
  const addSheet = useStore((s) => s.addSheet)
  const updateSheet = useStore((s) => s.updateSheet)
  const deleteSheet = useStore((s) => s.deleteSheet)
  const addSheetItem = useStore((s) => s.addSheetItem)
  const updateSheetItem = useStore((s) => s.updateSheetItem)
  const removeSheetItem = useStore((s) => s.removeSheetItem)
  const duplicateSheetItem = useStore((s) => s.duplicateSheetItem)
  const arrange = useStore((s) => s.arrangeSheet)

  const sheets = useMemo(() => project.sheets ?? [], [project.sheets])
  const [sheetId, setSheetId] = useState('')
  const sheet: SheetLayout | null = sheets.find((x) => x.id === sheetId) ?? sheets[0] ?? null
  const [selId, setSelId] = useState<string | null>(null)
  const [sourceIdx, setSourceIdx] = useState(0)
  const [msg, setMsg] = useState<string | null>(null)
  /** arrasto em andamento: item e deslocamento em metros de papel */
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null)
  const dragRef = useRef<{ id: string; px: number; py: number; k: number; scale: number } | null>(null)

  const options = useMemo(() => sheetSourceOptions(project, results), [project, results])
  const groups = useMemo(() => [...new Set(options.map((o) => o.group))], [options])

  const info = useMemo(
    () => ({
      projectName: project.name,
      client: project.client,
      address: project.address,
      city: project.city,
      author: project.author,
      date: new Date().toLocaleDateString('pt-BR'),
      revision: 'R00',
    }),
    [project.name, project.client, project.address, project.city, project.author],
  )
  const labelOf = (i: number) => `${String(i + 1).padStart(2, '0')}/${String(sheets.length).padStart(2, '0')}`
  const composed = useMemo(
    () =>
      sheet
        ? composeSheetLayout(project, results, sheet, {
            ...info,
            sheetLabel: `${String(sheets.indexOf(sheet) + 1).padStart(2, '0')}/${String(sheets.length).padStart(2, '0')}`,
          })
        : null,
    [project, results, sheet, sheets, info],
  )
  const selected = composed?.placed.find((p) => p.item.id === selId) ?? null
  const badIds = new Set(composed?.issues.flatMap((i) => [i.itemId, ...(i.otherId ? [i.otherId] : [])]) ?? [])

  if (!sheet || !composed) {
    return (
      <div style={{ padding: 16 }}>
        <div className="faint" style={{ fontSize: 12.5, marginBottom: 10, maxWidth: 560, lineHeight: 1.5 }}>
          Uma prancha composta reúne vários desenhos na mesma folha — planta de forma, vigas,
          pilares, fundações, tabelas —, cada um na sua escala. As pranchas ficam salvas no projeto.
        </div>
        <button className="btn btn-primary" onClick={() => setSheetId(addSheet())}>
          Criar a primeira prancha
        </button>
      </div>
    )
  }

  const add = () => {
    const opt = options[sourceIdx]
    if (!opt) return
    const id = addSheetItem(sheet.id, opt.source as SheetSource)
    if (id) setSelId(id)
    setMsg(null)
  }

  // ---- arrastar um desenho na folha (só o contorno se move; solta = grava) ----
  const onItemDown = (e: ReactPointerEvent<SVGRectElement>, id: string, k: number) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setSelId(id)
    dragRef.current = { id, px: e.clientX, py: e.clientY, k, scale: cssPxScale(e.currentTarget.ownerSVGElement!) }
  }
  const onItemMove = (e: ReactPointerEvent<SVGRectElement>) => {
    const d = dragRef.current
    if (!d) return
    e.stopPropagation()
    // px visuais → px CSS → metros de papel (y da tela cresce para baixo)
    const dx = ((e.clientX - d.px) * d.scale) / d.k
    const dy = (-(e.clientY - d.py) * d.scale) / d.k
    if (Math.hypot(dx, dy) * d.k < 3) return
    setDrag({ id: d.id, dx, dy })
  }
  const onItemUp = (e: ReactPointerEvent<SVGRectElement>) => {
    const d = dragRef.current
    dragRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (d && drag && drag.id === d.id) {
      const it = sheet.items.find((x) => x.id === d.id)
      if (it) updateSheetItem(sheet.id, it.id, { x: mm(it.x + drag.dx), y: mm(it.y + drag.dy) })
    }
    setDrag(null)
  }

  const overlay = ({ X, Y, k }: DrawingView) => {
    const { usable, stamp } = sheetAreas(sheet.format)
    return (
      <g>
        {/* área útil e carimbo, de guia */}
        <rect
          x={X(usable.x0)}
          y={Y(usable.y1)}
          width={(usable.x1 - usable.x0) * k}
          height={(usable.y1 - usable.y0) * k}
          fill="none"
          stroke="var(--border-strong)"
          strokeDasharray="2 5"
          pointerEvents="none"
        />
        <rect
          x={X(stamp.x0)}
          y={Y(stamp.y1)}
          width={(stamp.x1 - stamp.x0) * k}
          height={(stamp.y1 - stamp.y0) * k}
          fill="none"
          stroke="var(--border-strong)"
          strokeDasharray="2 5"
          pointerEvents="none"
        />
        {composed.placed.map((p) => {
          const moving = drag?.id === p.item.id
          const ox = moving ? drag!.dx : 0
          const oy = moving ? drag!.dy : 0
          const sel = p.item.id === selId
          const bad = badIds.has(p.item.id)
          const color = bad ? 'var(--err)' : sel ? 'var(--accent)' : 'var(--blue)'
          return (
            <rect
              key={p.item.id}
              data-testid="sheet-item"
              data-item={p.item.id}
              x={X(p.box.x0 + ox)}
              y={Y(p.box.y1 + oy)}
              width={(p.box.x1 - p.box.x0) * k}
              height={(p.box.y1 - p.box.y0) * k}
              fill={sel || moving ? 'var(--accent-soft)' : 'transparent'}
              stroke={color}
              strokeWidth={sel || bad ? 1.6 : 0.8}
              strokeOpacity={sel || bad || moving ? 1 : 0.35}
              strokeDasharray={moving ? '6 4' : undefined}
              style={{ cursor: moving ? 'grabbing' : 'move' }}
              onPointerDown={(e) => onItemDown(e, p.item.id, k)}
              onPointerMove={onItemMove}
              onPointerUp={onItemUp}
            >
              <title>{`${p.label} — 1:${p.item.scale} (arraste para mover)`}</title>
            </rect>
          )
        })}
      </g>
    )
  }

  const base = `${slug(project.name)}-${slug(sheet.name)}-${sheet.format.toLowerCase()}`
  const exportAll = () => {
    const drawings = sheets.map(
      (sh, i) => composeSheetLayout(project, results, sh, { ...info, sheetLabel: labelOf(i) }).drawing,
    )
    saveBlob(new Blob([buildDrawingsPdf(drawings) as BlobPart], { type: 'application/pdf' }), `${slug(project.name)}-pranchas.pdf`)
  }
  const usable = sheetAreas(sheet.format).usable
  const row = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const, paddingBottom: 8, flex: 'none' as const }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 420 }} data-testid="sheet-composer">
      <div style={row}>
        <span className="label" style={{ margin: 0 }}>
          Prancha
        </span>
        <select
          className="select"
          aria-label="Prancha"
          value={sheet.id}
          onChange={(e) => {
            setSheetId(e.target.value)
            setSelId(null)
          }}
        >
          {sheets.map((sh, i) => (
            <option key={sh.id} value={sh.id}>
              {labelOf(i)} — {sh.name}
            </option>
          ))}
        </select>
        <input
          className="input"
          aria-label="Nome da prancha"
          title="Nome da prancha (vai para o carimbo)"
          style={{ width: 190, height: 26 }}
          value={sheet.name}
          onChange={(e) => updateSheet(sheet.id, { name: e.target.value })}
        />
        <select
          className="select"
          aria-label="Formato da folha"
          value={sheet.format}
          onChange={(e) => updateSheet(sheet.id, { format: e.target.value as SheetFormat })}
        >
          {FORMAT_IDS.map((f) => (
            <option key={f} value={f}>
              {f} — {Math.round(SHEET_FORMATS[f].w * 1000)} × {Math.round(SHEET_FORMATS[f].h * 1000)} mm
            </option>
          ))}
        </select>
        <button
          className="btn"
          onClick={() => {
            setSheetId(addSheet())
            setSelId(null)
          }}
        >
          + Nova prancha
        </button>
        <button
          className="btn"
          style={{ color: 'var(--err)' }}
          title="Exclui esta prancha (os desenhos do projeto não são afetados)"
          onClick={() => {
            deleteSheet(sheet.id)
            setSheetId('')
            setSelId(null)
          }}
        >
          Excluir prancha
        </button>
      </div>

      <div style={row}>
        <span className="label" style={{ margin: 0 }}>
          Inserir
        </span>
        <select
          className="select"
          aria-label="Desenho a inserir"
          style={{ maxWidth: 300 }}
          value={sourceIdx}
          onChange={(e) => setSourceIdx(Number(e.target.value))}
        >
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {options.map((o, i) =>
                o.group === g ? (
                  <option key={i} value={i}>
                    {o.label}
                  </option>
                ) : null,
              )}
            </optgroup>
          ))}
        </select>
        <button className="btn btn-primary" onClick={add}>
          Adicionar à folha
        </button>
        <button
          className="btn"
          disabled={sheet.items.length === 0}
          title="Distribui os desenhos em fileiras, mantendo as escalas"
          onClick={() => setMsg(arrange(sheet.id, false) ? null : 'Não coube nas escalas atuais — reduza alguma escala, use uma folha maior ou “Organizar reduzindo escalas”.')}
        >
          Organizar
        </button>
        <button
          className="btn"
          disabled={sheet.items.length === 0}
          title="Distribui os desenhos e reduz a escala dos maiores até tudo caber"
          onClick={() => setMsg(arrange(sheet.id, true) ? null : 'Mesmo nas menores escalas não coube — use uma folha maior ou divida em duas pranchas.')}
        >
          Organizar reduzindo escalas
        </button>
        {!results && (
          <span className="faint" style={{ fontSize: 11 }}>
            Rode a análise para inserir armações, fundações e tabelas.
          </span>
        )}
      </div>

      {/* barra de ajustes sempre presente: a folha não muda de lugar ao selecionar */}
      {!selected && (
        <div style={{ ...row, minHeight: 28, background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', marginBottom: 8 }}>
          <span className="faint" style={{ fontSize: 11.5 }}>
            Clique num desenho da folha para mudar a escala, girar, duplicar ou remover.
          </span>
        </div>
      )}
      {selected && (
        <div style={{ ...row, minHeight: 28, background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', marginBottom: 8 }} data-testid="sheet-item-bar">
          <b style={{ fontSize: 12 }}>{selected.label}</b>
          <span className="label" style={{ margin: '0 0 0 8px' }}>
            Escala 1:
          </span>
          <select
            className="select"
            aria-label="Escala do desenho"
            value={selected.item.scale}
            onChange={(e) => updateSheetItem(sheet.id, selected.item.id, { scale: Number(e.target.value) })}
          >
            {[...new Set([...STANDARD_SCALES, selected.item.scale])]
              .sort((a, b) => a - b)
              .map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
          </select>
          <button
            className="btn"
            disabled={!selected.drawing}
            title="Maior escala-padrão com que o desenho cabe sozinho na área útil da folha"
            onClick={() =>
              selected.drawing &&
              updateSheetItem(sheet.id, selected.item.id, {
                scale: fitItemScale(selected.drawing, usable.x1 - usable.x0, usable.y1 - usable.y0 - 0.07, selected.item.rotation ?? 0),
              })
            }
          >
            Ajustar à folha
          </button>
          <button
            className="btn"
            title="Gira o desenho 90° (deitado ↔ em pé)"
            onClick={() => updateSheetItem(sheet.id, selected.item.id, { rotation: selected.item.rotation === 90 ? 0 : 90 })}
          >
            Girar 90°
          </button>
          <button
            className="btn"
            onClick={() => {
              const id = duplicateSheetItem(sheet.id, selected.item.id)
              if (id) setSelId(id)
            }}
          >
            Duplicar
          </button>
          <button
            className="btn"
            style={{ color: 'var(--err)' }}
            onClick={() => {
              removeSheetItem(sheet.id, selected.item.id)
              setSelId(null)
            }}
          >
            Remover
          </button>
          <span className="faint mono" style={{ fontSize: 10.5, marginLeft: 'auto' }}>
            {Math.round((selected.box.x1 - selected.box.x0) * 1000)} × {Math.round((selected.box.y1 - selected.item.y) * 1000)} mm no papel
          </span>
        </div>
      )}

      <div
        style={{
          flex: 1,
          minHeight: 300,
          position: 'relative',
          border: '1px solid var(--border)',
          borderRadius: 8,
          overflow: 'hidden',
          background: 'var(--canvas-bg)',
        }}
      >
        <DrawingSvg drawing={composed.drawing} fitKey={`${sheet.id}:${sheet.format}`} overlay={overlay} />
        {sheet.items.length === 0 && (
          <div
            className="faint"
            style={{ position: 'absolute', left: 0, right: 0, top: '45%', textAlign: 'center', fontSize: 12.5, pointerEvents: 'none' }}
          >
            Folha vazia — escolha um desenho acima e clique em “Adicionar à folha”.
          </div>
        )}
      </div>

      {(composed.issues.length > 0 || msg) && (
        <div style={{ paddingTop: 6, flex: 'none' }} data-testid="sheet-issues">
          {msg && <div style={{ color: 'var(--warn)', fontSize: 11.5 }}>{msg}</div>}
          {composed.issues.slice(0, 4).map((i, k) => (
            <div key={k} style={{ color: 'var(--err)', fontSize: 11.5 }}>
              • {i.message}
            </div>
          ))}
          {composed.issues.length > 4 && (
            <div className="faint" style={{ fontSize: 11 }}>
              … e mais {composed.issues.length - 4}.
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 8, flex: 'none' }}>
        <button
          className="btn"
          onClick={() => saveBlob(new Blob([buildDrawingPdf(composed.drawing) as BlobPart], { type: 'application/pdf' }), `${base}.pdf`)}
        >
          <IconDownload size={14} />
          PDF desta prancha
        </button>
        <button className="btn" disabled={sheets.length < 2} title="Um PDF com todas as pranchas, uma por página" onClick={exportAll}>
          <IconDownload size={14} />
          PDF de todas ({sheets.length})
        </button>
        <button
          className="btn"
          onClick={() => saveBlob(new Blob([writeDxf(composed.drawing)], { type: 'application/dxf' }), `${base}.dxf`)}
        >
          <IconDownload size={14} />
          DXF
        </button>
        <span className="faint" style={{ fontSize: 11, lineHeight: 1.4 }}>
          Arraste um desenho para mover; a escala é de cada desenho e vai escrita embaixo dele. PDF
          e DXF saem em tamanho real de papel. Revisão de engenheiro continua obrigatória.
        </span>
      </div>
    </div>
  )
}
