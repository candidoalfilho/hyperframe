import { useMemo, useState } from 'react'
import {
  buildBeamDetailDrawing,
  buildColumnDetailDrawing,
  buildFormworkDrawing,
  buildLoadPlanDrawing,
  buildSectionCutDrawing,
  composeSheet,
  writeDxf,
  type Drawing,
  type SheetFormat,
} from '@hyperframe/engine'
import { useStore } from '../store'
import DrawingSvg from './DrawingSvg'
import { IconDownload } from '../components/Icons'

/**
 * Aba "Pranchas": planta de forma, corte esquemático, planta de cargas,
 * detalhamento de vigas e seções de pilares — com opção de moldura + carimbo
 * (formatos A0–A4, escala automática ou fixa).
 */

type Tipo = 'forma' | 'corte' | 'cargas' | 'vigas' | 'pilares'

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
    if (!content || !withSheet) return null
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
  }, [content, withSheet, format, scaleOpt, tipo, project, effectivePlanId, effectiveBeam, effectiveCutAxis])

  const drawing = withSheet ? (sheet?.drawing ?? null) : content

  const downloadDxf = (): void => {
    if (!drawing) return
    const nome =
      tipo === 'forma'
        ? project.plans.find((p) => p.id === effectivePlanId)?.name ?? 'planta'
        : tipo === 'vigas'
          ? effectiveBeam?.label ?? 'viga'
          : tipo === 'corte'
            ? `corte-${effectiveCutAxis?.label ?? ''}`
            : tipo === 'cargas'
              ? 'cargas-fundacao'
              : 'secoes'
    const blob = new Blob([writeDxf(drawing)], { type: 'application/dxf' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${tipo}-${slug(nome)}${withSheet ? `-${format.toLowerCase()}` : ''}.dxf`
    a.click()
    URL.revokeObjectURL(url)
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
        <span className="faint" style={{ fontSize: 11, lineHeight: 1.4 }}>
          Detalhamento preliminar — as pranchas exigem revisão de engenheiro responsável antes de
          execução.{withSheet ? ' Prancha em metros de papel; carimbo preenchido dos dados do projeto.' : ''}
        </span>
      </div>
    </div>
  )
}
