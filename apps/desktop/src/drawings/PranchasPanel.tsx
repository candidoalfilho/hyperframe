import { useMemo, useState } from 'react'
import {
  buildBeamDetailDrawing,
  buildColumnDetailDrawing,
  buildFormworkDrawing,
  writeDxf,
  type Drawing,
} from '@hyperframe/engine'
import { useStore } from '../store'
import DrawingSvg from './DrawingSvg'
import { IconDownload } from '../components/Icons'

/**
 * Aba "Pranchas": planta de forma, detalhamento de vigas e seções de pilares.
 * A planta de forma sai direto do modelo; vigas/pilares dependem da análise.
 */

type Tipo = 'forma' | 'vigas' | 'pilares'

/** nome de arquivo seguro: minúsculas, sem acentos, hifens */
function slug(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // remove diacriticos
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'prancha'
  )
}

export default function PranchasPanel() {
  const results = useStore((s) => s.results)
  const project = useStore((s) => s.project)

  const [tipo, setTipo] = useState<Tipo>('forma')
  const [planId, setPlanId] = useState('')
  const [beamId, setBeamId] = useState('')

  const effectivePlanId = project.plans.some((p) => p.id === planId)
    ? planId
    : project.plans[0]?.id ?? ''

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

  const drawing = useMemo<Drawing | null>(() => {
    try {
      if (tipo === 'forma') {
        return effectivePlanId ? buildFormworkDrawing(project, effectivePlanId) : null
      }
      if (!results) return null
      if (tipo === 'vigas') {
        if (!effectiveBeam) return null
        const spans = results.detailing.beams.filter((b) => b.beamId === effectiveBeam.id)
        return buildBeamDetailDrawing(effectiveBeam.name, spans)
      }
      return buildColumnDetailDrawing(results.detailing.columns)
    } catch {
      return null
    }
  }, [tipo, project, results, effectivePlanId, effectiveBeam])

  const downloadDxf = (): void => {
    if (!drawing) return
    const nome =
      tipo === 'forma'
        ? project.plans.find((p) => p.id === effectivePlanId)?.name ?? 'planta'
        : tipo === 'vigas'
          ? effectiveBeam?.label ?? 'viga'
          : 'secoes'
    const blob = new Blob([writeDxf(drawing)], { type: 'application/dxf' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${tipo}-${slug(nome)}.dxf`
    a.click()
    URL.revokeObjectURL(url)
  }

  const hint =
    tipo === 'forma'
      ? 'Nenhuma planta de forma no projeto.'
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
        <select
          className="select"
          value={tipo}
          onChange={(e) => setTipo(e.target.value as Tipo)}
        >
          <option value="forma">Planta de forma</option>
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

        {!results && (
          <span className="faint" style={{ fontSize: 11 }}>
            Rode a análise para gerar as pranchas de vigas e pilares.
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
          execução.
        </span>
      </div>
    </div>
  )
}
