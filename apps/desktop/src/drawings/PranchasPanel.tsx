import { useMemo, useState } from 'react'
import {
  buildBeamDetailDrawing,
  buildColumnDetailDrawing,
  buildDrawingPdf,
  buildFormworkDrawing,
  buildFoundationDetailDrawing,
  buildFoundationPlanDrawing,
  buildLoadPlanDrawing,
  buildSectionCutDrawing,
  composeSheet,
  writeDxf,
  type Drawing,
  type SheetFormat,
} from '@hyperframe/engine'
import { useStore } from '../store'
import DrawingSvg from './DrawingSvg'
import { NumberField } from '../panels/NumberField'
import { IconChevronDown, IconDownload } from '../components/Icons'

/**
 * Aba "Pranchas": planta de forma, corte esquemático, planta de cargas,
 * detalhamento de vigas e seções de pilares — com opção de moldura + carimbo
 * (formatos A0–A4, escala automática ou fixa).
 */

type Tipo = 'forma' | 'corte' | 'cargas' | 'fundacoes' | 'fundacoes-det' | 'vigas' | 'pilares'

/** nome de arquivo seguro: minúsculas, sem acentos, hifens */
function slug(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // remove diacriticos
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'prancha'
  )
}

const TITLES: Record<Tipo, string> = {
  forma: 'Planta de forma',
  corte: 'Corte esquemático',
  cargas: 'Planta de cargas — fundações',
  fundacoes: 'Planta de fundações',
  'fundacoes-det': 'Detalhamento de fundações',
  vigas: 'Armação de vigas',
  pilares: 'Pilares — seções e armaduras',
}

export default function PranchasPanel() {
  const results = useStore((s) => s.results)
  const project = useStore((s) => s.project)

  const [tipo, setTipo] = useState<Tipo>('forma')
  const [planId, setPlanId] = useState('')
  const [beamId, setBeamId] = useState('')
  const [cutDir, setCutDir] = useState<'x' | 'y'>('x')
  const [cutAxisId, setCutAxisId] = useState('')
  const [withSheet, setWithSheet] = useState(false)
  const [format, setFormat] = useState<SheetFormat>('A1')
  const [scaleOpt, setScaleOpt] = useState<'auto' | number>('auto')

  const effectivePlanId = project.plans.some((p) => p.id === planId)
    ? planId
    : project.plans[0]?.id ?? ''

  // eixos disponíveis p/ posicionar o corte
  const cutAxes = cutDir === 'x' ? project.grid.xAxes : project.grid.yAxes
  const effectiveCutAxis = cutAxes.find((a) => a.id === cutAxisId) ?? cutAxes[0] ?? null

  // vigas por beamId (o mesmo nome pode se repetir em plantas diferentes —
  // ex.: V1 do tipo e V1 da cobertura); rótulo ganha a planta quando ambíguo
  const beamOptions = useMemo(() => {
    if (!results) return []
    const nameOf = new Map<string, string>()
    for (const b of results.detailing.beams) {
      if (!nameOf.has(b.beamId)) nameOf.set(b.beamId, b.beamName)
    }
    const count = new Map<string, number>()
    for (const name of nameOf.values()) count.set(name, (count.get(name) ?? 0) + 1)
    const planOf = (id: string): string | undefined =>
      project.plans.find((pl) => pl.beams.some((bm) => bm.id === id))?.name
    const opts = [...nameOf.entries()].map(([id, name]) => ({
      id,
      name,
      label: (count.get(name) ?? 0) > 1 ? `${name} — ${planOf(id) ?? '?'}` : name,
    }))
    opts.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR', { numeric: true }))
    return opts
  }, [results, project])
  const effectiveBeam = beamOptions.find((o) => o.id === beamId) ?? beamOptions[0] ?? null

  const content = useMemo<Drawing | null>(() => {
    try {
      if (tipo === 'forma') {
        return effectivePlanId ? buildFormworkDrawing(project, effectivePlanId) : null
      }
      if (tipo === 'corte') {
        // corta 1 cm ao lado do eixo p/ pegar os pilares do alinhamento
        return effectiveCutAxis
          ? buildSectionCutDrawing(project, {
              dir: cutDir,
              pos: effectiveCutAxis.pos + 0.01,
              label: effectiveCutAxis.label,
            })
          : null
      }
      if (!results) return null
      if (tipo === 'cargas') return buildLoadPlanDrawing(project, results.foundationLoads)
      if (tipo === 'fundacoes') return buildFoundationPlanDrawing(project, results.foundations)
      if (tipo === 'fundacoes-det') return buildFoundationDetailDrawing(project, results.foundations)
      if (tipo === 'vigas') {
        if (!effectiveBeam) return null
        const spans = results.detailing.beams.filter((b) => b.beamId === effectiveBeam.id)
        const steelItems = results.detailing.steel.items.filter(
          (it) => it.elementId === effectiveBeam.id,
        )
        return buildBeamDetailDrawing(effectiveBeam.name, spans, undefined, steelItems)
      }
      return buildColumnDetailDrawing(results.detailing.columns)
    } catch {
      return null
    }
  }, [tipo, project, results, effectivePlanId, effectiveBeam, cutDir, effectiveCutAxis])

  const sheet = useMemo(() => {
    if (!content) return null
    try {
      const subtitle =
        tipo === 'forma'
          ? project.plans.find((p) => p.id === effectivePlanId)?.name
          : tipo === 'vigas'
            ? effectiveBeam?.label
            : tipo === 'corte'
              ? `Eixo ${effectiveCutAxis?.label ?? ''}`
              : undefined
      return composeSheet(content, {
        format,
        scale: scaleOpt === 'auto' ? undefined : scaleOpt,
        info: {
          projectName: project.name,
          client: project.client,
          address: project.address,
          city: project.city,
          author: project.author,
          title1: TITLES[tipo],
          title2: subtitle,
          date: new Date().toLocaleDateString('pt-BR'),
          revision: 'R00',
        },
      })
    } catch {
      return null
    }
  }, [content, format, scaleOpt, tipo, project, effectivePlanId, effectiveBeam, effectiveCutAxis])

  const drawing = withSheet ? (sheet?.drawing ?? null) : content

  const baseName = (): string =>
    tipo === 'forma'
      ? project.plans.find((p) => p.id === effectivePlanId)?.name ?? 'planta'
      : tipo === 'vigas'
        ? effectiveBeam?.label ?? 'viga'
        : tipo === 'corte'
          ? `corte-${effectiveCutAxis?.label ?? ''}`
          : tipo === 'cargas'
            ? 'cargas-fundacao'
            : tipo === 'fundacoes'
              ? 'planta-fundacoes'
              : tipo === 'fundacoes-det'
                ? 'detalhamento-fundacoes'
                : 'secoes'

  const saveBlob = (blob: Blob, filename: string): void => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const downloadDxf = (): void => {
    if (!drawing) return
    saveBlob(
      new Blob([writeDxf(drawing)], { type: 'application/dxf' }),
      `${tipo}-${slug(baseName())}${withSheet ? `-${format.toLowerCase()}` : ''}.dxf`,
    )
  }

  // PDF sempre com moldura+carimbo: o vetor sai 1:1 com a folha (imprime na escala)
  const downloadPdf = (): void => {
    if (!sheet) return
    const bytes = buildDrawingPdf(sheet.drawing)
    saveBlob(
      new Blob([bytes as BlobPart], { type: 'application/pdf' }),
      `${tipo}-${slug(baseName())}-${format.toLowerCase()}.pdf`,
    )
  }

  const hint =
    tipo === 'forma'
      ? 'Nenhuma planta de forma no projeto.'
      : tipo === 'corte'
        ? 'Defina eixos no projeto p/ posicionar o corte.'
        : 'Rode a análise para gerar as pranchas.'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 420 }}>
      {/* seleção do tipo de prancha */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          paddingBottom: 8,
          flex: 'none',
        }}
      >
        <span className="label" style={{ margin: 0 }}>
          Prancha
        </span>
        <select className="select" value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)}>
          <option value="forma">Planta de forma</option>
          <option value="corte">Corte esquemático</option>
          <option value="cargas" disabled={!results}>
            Planta de cargas
          </option>
          <option value="fundacoes" disabled={!results}>
            Planta de fundações
          </option>
          <option value="fundacoes-det" disabled={!results}>
            Detalhamento de fundações
          </option>
          <option value="vigas" disabled={!results}>
            Vigas
          </option>
          <option value="pilares" disabled={!results}>
            Pilares
          </option>
        </select>

        {tipo === 'forma' && (
          <>
            <span className="label" style={{ margin: 0 }}>
              Planta
            </span>
            <select
              className="select"
              value={effectivePlanId}
              onChange={(e) => setPlanId(e.target.value)}
            >
              {project.plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </>
        )}

        {tipo === 'corte' && (
          <>
            <select
              className="select"
              value={cutDir}
              onChange={(e) => setCutDir(e.target.value as 'x' | 'y')}
            >
              <option value="x">Vertical (corta X)</option>
              <option value="y">Horizontal (corta Y)</option>
            </select>
            <span className="label" style={{ margin: 0 }}>
              Eixo
            </span>
            <select
              className="select"
              value={effectiveCutAxis?.id ?? ''}
              onChange={(e) => setCutAxisId(e.target.value)}
            >
              {cutAxes.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} ({a.pos.toFixed(2).replace('.', ',')} m)
                </option>
              ))}
            </select>
          </>
        )}

        {tipo === 'vigas' && results && (
          <>
            <span className="label" style={{ margin: 0 }}>
              Viga
            </span>
            <select
              className="select"
              value={effectiveBeam?.id ?? ''}
              onChange={(e) => setBeamId(e.target.value)}
            >
              {beamOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </>
        )}

        {/* moldura + carimbo */}
        <label
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}
        >
          <input type="checkbox" checked={withSheet} onChange={(e) => setWithSheet(e.target.checked)} />
          Moldura + carimbo
        </label>
        {withSheet && (
          <>
            <select
              className="select"
              value={format}
              onChange={(e) => setFormat(e.target.value as SheetFormat)}
            >
              {(['A0', 'A1', 'A2', 'A3', 'A4'] as SheetFormat[]).map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <select
              className="select"
              value={String(scaleOpt)}
              onChange={(e) =>
                setScaleOpt(e.target.value === 'auto' ? 'auto' : Number(e.target.value))
              }
            >
              <option value="auto">
                Escala auto{sheet ? ` (1:${sheet.scale})` : ''}
              </option>
              {[20, 25, 50, 75, 100, 200].map((s) => (
                <option key={s} value={s}>
                  1:{s}
                </option>
              ))}
            </select>
          </>
        )}

        {!results && (
          <span className="faint" style={{ fontSize: 11 }}>
            Rode a análise para gerar as pranchas de vigas, pilares e cargas.
          </span>
        )}
      </div>

      {tipo === 'vigas' && results && effectiveBeam && (
        <RebarEditor beamId={effectiveBeam.id} />
      )}

      {/* área do desenho */}
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
        {drawing ? (
          <DrawingSvg drawing={drawing} />
        ) : (
          <div
            className="faint"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12.5,
            }}
          >
            {hint}
          </div>
        )}
      </div>

      {/* exportação + aviso de responsabilidade */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          paddingTop: 8,
          flex: 'none',
        }}
      >
        <button className="btn" onClick={downloadDxf} disabled={!drawing}>
          <IconDownload size={14} />
          Baixar DXF
        </button>
        <button
          className="btn"
          onClick={downloadPdf}
          disabled={!sheet}
          title={`PDF vetorial com moldura + carimbo (${format}) — imprime na escala do carimbo`}
        >
          <IconDownload size={14} />
          Baixar PDF
        </button>
        <span className="faint" style={{ fontSize: 11, lineHeight: 1.4 }}>
          Detalhamento preliminar — as pranchas exigem revisão de engenheiro responsável antes de
          execução.{withSheet ? ' Prancha em metros de papel; carimbo preenchido dos dados do projeto.' : ''}
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// editor de armaduras — ajustes manuais por vão (entram no arquivo do projeto
// e recalculam o detalhamento na hora, sem invalidar a análise)
// ---------------------------------------------------------------------------

const PHI_MM = [6.3, 8, 10, 12.5, 16, 20, 25]

function PhiSelect({ value, onChange }: { value: number; onChange: (phi: number) => void }) {
  return (
    <select
      className="select"
      style={{ height: 22, fontSize: 11 }}
      value={String(Math.round(value * 10000))}
      onChange={(e) => onChange(Number(e.target.value) / 10000)}
    >
      {PHI_MM.map((mm) => (
        <option key={mm} value={String(Math.round(mm * 10))}>
          φ {String(mm).replace('.', ',')}
        </option>
      ))}
    </select>
  )
}

function SlotEditor(props: {
  label: string
  beamId: string
  spanIndex: number
  slot: 'positive' | 'negLeft' | 'negRight'
  n: number
  phi: number
  asCalc: number
}) {
  const setRebarOverride = useStore((s) => s.setRebarOverride)
  const { label, beamId, spanIndex, slot, n, phi, asCalc } = props
  const asProv = (n * Math.PI * phi * phi) / 4
  const bad = asProv + 1e-12 < asCalc
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span className="muted" style={{ fontSize: 11 }}>
        {label}
      </span>
      <NumberField
        value={n}
        digits={0}
        min={1}
        max={24}
        style={{ width: 38 }}
        onCommit={(v) =>
          setRebarOverride({ beamId, spanIndex, slot, n: Math.max(1, Math.round(v)), phi })
        }
      />
      <PhiSelect
        value={phi}
        onChange={(p) => setRebarOverride({ beamId, spanIndex, slot, n, phi: p })}
      />
      {bad && (
        <span
          className="chip err"
          title={`As efetivo ${(asProv * 1e4).toFixed(2)} cm² < As calculado ${(asCalc * 1e4).toFixed(2)} cm²`}
        >
          As!
        </span>
      )}
    </span>
  )
}

function RebarEditor({ beamId }: { beamId: string }) {
  const results = useStore((s) => s.results)
  const project = useStore((s) => s.project)
  const setRebarOverride = useStore((s) => s.setRebarOverride)
  const clearRebarOverrides = useStore((s) => s.clearRebarOverrides)
  const [open, setOpen] = useState(false)
  if (!results) return null
  const spans = results.detailing.beams
    .filter((b) => b.beamId === beamId)
    .sort((a, b) => a.spanIndex - b.spanIndex)
  if (spans.length === 0) return null
  const overridden = (project.rebarOverrides ?? []).some((o) => o.beamId === beamId)
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '6px 10px',
        marginBottom: 8,
        flex: 'none',
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setOpen(!open)}
      >
        <IconChevronDown
          size={12}
          style={{ transform: open ? undefined : 'rotate(-90deg)', transition: 'transform 0.15s' }}
        />
        <span style={{ fontSize: 12, fontWeight: 600 }}>
          Editor de armaduras{overridden ? ' — ajustes manuais ativos' : ''}
        </span>
        {overridden && (
          <button
            className="btn"
            style={{ fontSize: 11, padding: '1px 8px', marginLeft: 'auto' }}
            onClick={(e) => {
              e.stopPropagation()
              clearRebarOverrides(beamId)
            }}
          >
            Restaurar automático
          </button>
        )}
      </div>
      {open && (
        <>
          {spans.map((sp) => {
            const bd = results.beamDesign.find(
              (b) => b.beamId === beamId && b.spanIndex === sp.spanIndex,
            )
            return (
              <div
                key={sp.spanIndex}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  flexWrap: 'wrap',
                  padding: '4px 0',
                }}
              >
                <span className="mono" style={{ fontSize: 11, width: 44 }}>
                  vão {sp.spanIndex + 1}
                </span>
                <SlotEditor
                  label="positivo"
                  beamId={beamId}
                  spanIndex={sp.spanIndex}
                  slot="positive"
                  n={sp.positive.n}
                  phi={sp.positive.phi}
                  asCalc={bd?.positive.as ?? 0}
                />
                {sp.negLeft && (
                  <SlotEditor
                    label="neg. esq."
                    beamId={beamId}
                    spanIndex={sp.spanIndex}
                    slot="negLeft"
                    n={sp.negLeft.n + (sp.negLeft.cut?.n ?? 0)}
                    phi={sp.negLeft.phi}
                    asCalc={bd?.negLeft?.as ?? 0}
                  />
                )}
                {sp.negRight && (
                  <SlotEditor
                    label="neg. dir."
                    beamId={beamId}
                    spanIndex={sp.spanIndex}
                    slot="negRight"
                    n={sp.negRight.n + (sp.negRight.cut?.n ?? 0)}
                    phi={sp.negRight.phi}
                    asCalc={bd?.negRight?.as ?? 0}
                  />
                )}
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span className="muted" style={{ fontSize: 11 }}>
                    estribo c/
                  </span>
                  <NumberField
                    value={Math.round(sp.stirrup.spacing * 100)}
                    digits={0}
                    min={5}
                    max={30}
                    style={{ width: 40 }}
                    onCommit={(v) =>
                      setRebarOverride({
                        beamId,
                        spanIndex: sp.spanIndex,
                        slot: 'stirrup',
                        spacing: Math.max(0.05, v / 100),
                      })
                    }
                  />
                  <span className="muted" style={{ fontSize: 11 }}>
                    cm
                  </span>
                </span>
              </div>
            )
          })}
          <div className="faint" style={{ fontSize: 10.5 }}>
            Ajustes entram no arquivo do projeto e no quadro de ferros. "As!" = As efetivo abaixo
            do calculado — a decisão (e a responsabilidade) é do engenheiro.
          </div>
        </>
      )}
    </div>
  )
}
