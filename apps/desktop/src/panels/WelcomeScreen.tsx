import { useMemo, useState } from 'react'
import { createSampleProject } from '@hyperframe/engine'
import { useStore } from '../store'
import {
  isTauri,
  openProjectFile,
  openRecentProject,
  readAutosave,
  readRecents,
  removeRecent,
} from '../io/fileio'
import {
  IconBuilding,
  IconLogo,
  IconMoon,
  IconNew,
  IconOpen,
  IconResults,
  IconSun,
} from '../components/Icons'

const NORMS = ['NBR 6118', 'NBR 6120', 'NBR 6123', 'NBR 8681', 'NBR 15421', 'NBR 16868', 'NBR 6122']

/** data relativa curta pt-BR p/ lista de recentes */
function relWhen(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.floor(h / 24)
  if (d === 1) return 'ontem'
  if (d < 30) return `há ${d} dias`
  return new Date(iso).toLocaleDateString('pt-BR')
}

function Action({
  icon,
  title,
  subtitle,
  recover,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  recover?: boolean
  onClick: () => void
}) {
  return (
    <button className={`welcome-action${recover ? ' recover' : ''}`} onClick={onClick}>
      <span className="wa-icon">{icon}</span>
      <span style={{ minWidth: 0 }}>
        <span className="wa-title">{title}</span>
        <span className="wa-sub">{subtitle}</span>
      </span>
    </button>
  )
}

/** Tela inicial: marca + ações + projetos recentes (substitui o antigo modal). */
export default function WelcomeScreen() {
  const loadProject = useStore((s) => s.loadProject)
  const setWelcomeOpen = useStore((s) => s.setWelcomeOpen)
  const setWizardOpen = useStore((s) => s.setWizardOpen)
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const hasOpenProject = useStore((s) => s.hasOpenProject)
  const openProjectName = useStore((s) => s.project.name)
  const openDirty = useStore((s) => s.dirty)

  const autosave = useMemo(() => readAutosave(), [])
  const [recents, setRecents] = useState(() => readRecents())

  const openRecent = async (path: string) => {
    try {
      const r = await openRecentProject(path)
      loadProject(r.project, r.fileName)
    } catch (err) {
      alert(
        `Não foi possível abrir o projeto.\n${err instanceof Error ? err.message : String(err)}`,
      )
      removeRecent(path)
      setRecents(readRecents())
    }
  }

  return (
    <div className="welcome">
      <div className="welcome-top">
        <span className="welcome-version">v{__APP_VERSION__}</span>
        <button
          className="btn-icon tip-down-left"
          data-tip={theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          {theme === 'dark' ? <IconSun size={17} /> : <IconMoon size={17} />}
        </button>
      </div>

      <div className="welcome-main">
        <div>
          <div className="welcome-eyebrow">Engenharia estrutural · ABNT</div>
          <h1 className="welcome-title">
            <IconLogo size={44} style={{ verticalAlign: '-4px', marginRight: 10 }} />
            Hyper<em>Frame</em>
          </h1>
          <p className="welcome-sub">
            O edifício inteiro — análise, dimensionamento e detalhamento pelas normas brasileiras.
            Gratuito e de código aberto.
          </p>
          <div className="welcome-norms">
            {NORMS.map((n) => (
              <span key={n} className="welcome-norm">
                {n}
              </span>
            ))}
          </div>
        </div>

        <div className="welcome-card">
          {hasOpenProject && (
            <Action
              icon={<IconBuilding size={21} />}
              recover
              title="Continuar editando"
              subtitle={`${openProjectName}${openDirty ? ' · alterações não salvas' : ''}`}
              onClick={() => setWelcomeOpen(false)}
            />
          )}
          {autosave && (
            <Action
              icon={<IconResults size={21} />}
              recover
              title="Recuperar trabalho não salvo"
              subtitle={`${autosave.projectName} · autosave de ${new Date(
                autosave.when,
              ).toLocaleString('pt-BR')}`}
              onClick={() => loadProject(autosave.project, autosave.fileName)}
            />
          )}
          <Action
            icon={<IconNew size={21} />}
            title="Novo projeto"
            subtitle="Assistente com parâmetros de norma"
            onClick={() => {
              setWelcomeOpen(false)
              setWizardOpen(true)
            }}
          />
          <Action
            icon={<IconOpen size={21} />}
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
          <Action
            icon={<IconBuilding size={21} />}
            title="Abrir projeto de exemplo"
            subtitle="Edifício residencial de 8 pavimentos pronto para analisar"
            onClick={() => loadProject(createSampleProject())}
          />

          <div className="welcome-recents">
            <div className="welcome-recents-title">Projetos recentes</div>
            {recents.length === 0 ? (
              <div className="welcome-empty">
                {isTauri()
                  ? 'Projetos abertos ou salvos aparecem aqui.'
                  : 'Disponível no app desktop — no navegador, use "Abrir arquivo…".'}
              </div>
            ) : (
              recents.map((r) => (
                <div
                  key={r.path}
                  className="welcome-recent"
                  role="button"
                  tabIndex={0}
                  onClick={() => void openRecent(r.path)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void openRecent(r.path)
                  }}
                >
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span className="wr-name" style={{ display: 'block' }}>
                      {r.name}
                    </span>
                    <span className="wr-path" style={{ display: 'block' }}>
                      {r.path}
                    </span>
                  </span>
                  <span className="wr-when">{relWhen(r.when)}</span>
                  <button
                    className="wr-x"
                    title="Remover da lista"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeRecent(r.path)
                      setRecents(readRecents())
                    }}
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="welcome-foot">
        Software em desenvolvimento — os resultados não substituem a verificação de um engenheiro
        responsável.
      </div>
    </div>
  )
}
