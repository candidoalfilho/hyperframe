import type { RebarGroup3D, RebarItem } from '@hyperframe/engine'
import { fmt } from '../panels/format'
import { IconClose } from '../components/Icons'
import { REBAR_COLOR, phiLabel } from './rebarGeometry'

/**
 * Identificação da barra escolhida no 3D (issue #25): elemento, posição,
 * bitola, comprimento e a linha dela no quadro de ferros.
 */

/** "Viga V3 · vão 2" / "Pilar P4 · tramo 1" */
export function rebarElementLabel(g: Pick<RebarGroup3D, 'elementKind' | 'elementName' | 'spanIndex'>): string {
  return g.elementKind === 'beam'
    ? `Viga ${g.elementName} · vão ${g.spanIndex + 1}`
    : `Pilar ${g.elementName} · tramo ${g.spanIndex + 1}`
}

/** "3 Ø 12,5 · C = 420 cm" */
export function rebarSpecLabel(g: Pick<RebarGroup3D, 'n' | 'phi' | 'unitLength'>): string {
  return `${g.n} Ø ${phiLabel(g.phi)} · C = ${Math.round(g.unitLength * 100)} cm`
}

export default function RebarCard({
  group,
  levelName,
  steelRow,
  isolated,
  onIsolate,
  onClose,
}: {
  group: RebarGroup3D
  /** pavimento da viga ou os dois níveis do tramo do pilar */
  levelName: string
  /** linha do quadro de ferros (todas as repetições do elemento) */
  steelRow: RebarItem | null
  /** a vista já está restrita a este elemento */
  isolated: boolean
  onIsolate: (on: boolean) => void
  onClose: () => void
}) {
  const kind = group.elementKind === 'beam' ? 'viga' : 'pilar'
  return (
    <div
      data-testid="rebar-card"
      style={{
        position: 'absolute',
        left: 10,
        bottom: 10,
        zIndex: 3,
        width: 300,
        background: 'var(--bg-1)',
        border: '1px solid var(--border-strong)',
        borderRadius: 8,
        padding: '10px 12px',
        fontSize: 12,
        lineHeight: '18px',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.35)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: 2, background: REBAR_COLOR[group.category], flex: 'none' }} />
        <b style={{ flex: 1 }}>{rebarElementLabel(group)}</b>
        <button className="btn-icon" style={{ width: 22, height: 22 }} title="Fechar" onClick={onClose}>
          <IconClose size={13} />
        </button>
      </div>
      <div className="faint" style={{ fontSize: 11 }}>
        {levelName}
      </div>
      <div style={{ marginTop: 6 }}>
        <b>{group.pos !== undefined ? `N${group.pos}` : 'Posição'}</b> — {group.label}
      </div>
      <div className="mono" style={{ fontSize: 12.5 }}>
        {rebarSpecLabel(group)}
      </div>
      {steelRow && (
        <div className="faint" style={{ fontSize: 11, marginTop: 6, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
          No quadro de ferros: N{steelRow.pos} · {steelRow.n} {steelRow.n === 1 ? 'peça' : 'peças'} de{' '}
          {Math.round(steelRow.unitLength * 100)} cm
          {steelRow.reps && steelRow.reps > 1 ? ` (${steelRow.reps} pavimentos)` : ''} · {fmt(steelRow.totalLength, 1)} m ·{' '}
          {fmt(steelRow.kg, 1)} kg
          {steelRow.note ? <div style={{ marginTop: 2 }}>{steelRow.note}</div> : null}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <button className="btn" style={{ height: 24, fontSize: 11 }} onClick={() => onIsolate(!isolated)}>
          {isolated ? 'Ver todos os elementos' : `Ver só ${kind === 'viga' ? 'esta viga' : 'este pilar'}`}
        </button>
      </div>
    </div>
  )
}
