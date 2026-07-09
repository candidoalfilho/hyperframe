import type { ReactNode } from 'react'
import { createSampleProject } from '@hyperframe/engine'
import { useStore } from '../store'
import { openProjectFile } from '../io/fileio'
import { IconBuilding, IconCube, IconNew, IconOpen } from '../components/Icons'

function OptionCard({
  icon,
  title,
  subtitle,
  onClick,
}: {
  icon: ReactNode
  title: string
  subtitle: string
  onClick: () => void
}) {
  return (
    <button
      className="btn"
      onClick={onClick}
      style={{
        width: '100%',
        height: 'auto',
        justifyContent: 'flex-start',
        textAlign: 'left',
        padding: '13px 16px',
        gap: 14,
        marginBottom: 10,
        borderRadius: 8,
      }}
    >
      <span style={{ color: 'var(--accent)', display: 'inline-flex', flex: 'none' }}>{icon}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 600, fontSize: 13.5 }}>{title}</span>
        <span
          style={{
            display: 'block',
            fontSize: 11.5,
            color: 'var(--text-dim)',
            marginTop: 2,
            whiteSpace: 'normal',
          }}
        >
          {subtitle}
        </span>
      </span>
    </button>
  )
}

export default function WelcomeModal() {
  const loadProject = useStore((s) => s.loadProject)
  const setWelcomeOpen = useStore((s) => s.setWelcomeOpen)
  const setWizardOpen = useStore((s) => s.setWizardOpen)

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width: 460 }}>
        <div className="modal-body" style={{ padding: '10px 22px 4px' }}>
          <div style={{ textAlign: 'center', padding: '22px 0 18px' }}>
            <IconCube size={40} style={{ color: 'var(--accent)' }} />
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 8, letterSpacing: 0.2 }}>
              Hyper<span style={{ color: 'var(--accent)' }}>Frame</span>
            </div>
            <div
              className="muted"
              style={{ fontSize: 12, margin: '6px auto 0', maxWidth: 360, lineHeight: 1.5 }}
            >
              Análise e dimensionamento estrutural de edifícios — NBR 6118 · 6120 · 6123 · 8681
            </div>
          </div>

          <OptionCard
            icon={<IconBuilding size={22} />}
            title="Abrir projeto de exemplo"
            subtitle="Edifício residencial de 8 pavimentos pronto para analisar"
            onClick={() => loadProject(createSampleProject())}
          />
          <OptionCard
            icon={<IconNew size={22} />}
            title="Novo projeto"
            subtitle="Assistente com parâmetros de norma"
            onClick={() => {
              setWelcomeOpen(false)
              setWizardOpen(true)
            }}
          />
          <OptionCard
            icon={<IconOpen size={22} />}
            title="Abrir arquivo…"
            subtitle=".hyperframe.json"
            onClick={async () => {
              try {
                const r = await openProjectFile()
                if (r) loadProject(r.project, r.fileName)
              } catch (err) {
                alert(err instanceof Error ? err.message : String(err))
              }
            }}
          />
        </div>

        <div className="modal-footer" style={{ justifyContent: 'center', borderTop: 'none' }}>
          <span className="faint" style={{ fontSize: 11, textAlign: 'center', lineHeight: 1.5 }}>
            v0.2.0 — software em desenvolvimento; os resultados não substituem a verificação de um
            engenheiro responsável.
          </span>
        </div>
      </div>
    </div>
  )
}
