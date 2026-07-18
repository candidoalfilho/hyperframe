import { useState } from 'react'
import { checkConsistency, type ConsistencyIssue } from '@hyperframe/engine'
import { useStore } from '../store'
import { clearAutosave, openProjectFile, saveProject, saveProjectAs } from '../io/fileio'
import {
  IconClose,
  IconCube,
  IconLogo,
  IconNew,
  IconOpen,
  IconPlan,
  IconPlay,
  IconRedo,
  IconResults,
  IconSave,
  IconSettings,
  IconSplit,
  IconUndo,
} from './Icons'

const SEVERITY_LABEL: Record<ConsistencyIssue['severity'], string> = {
  grave: 'GRAVE',
  media: 'média',
  leve: 'leve',
}
const SEVERITY_CLASS: Record<ConsistencyIssue['severity'], string> = {
  grave: 'err',
  media: 'warn',
  leve: 'ok',
}

/** modal de verificação de consistência do modelo (pré-análise) */
function ConsistencyModal({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project)
  const select = useStore((s) => s.select)
  const issues = checkConsistency(project)
  const graves = issues.filter((i) => i.severity === 'grave').length

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        style={{ maxWidth: 640, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 style={{ margin: 0, fontSize: 15 }}>Consistência do modelo</h2>
          <button className="btn-icon" onClick={onClose} title="Fechar">
            <IconClose />
          </button>
        </div>
        <div style={{ overflowY: 'auto', padding: '10px 16px', flex: 1 }}>
          {issues.length === 0 ? (
            <div style={{ padding: '18px 0', fontSize: 13 }}>
              <span className="chip ok">ok</span> Nenhuma inconsistência encontrada — modelo pronto
              p/ análise.
            </div>
          ) : (
            <>
              <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                {issues.length} apontamento(s), {graves} grave(s).{' '}
                {graves > 0 ? 'Corrija os graves antes de analisar.' : ''}
              </div>
              {issues.map((issue, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'baseline',
                    padding: '5px 0',
                    borderBottom: '1px solid var(--border)',
                    fontSize: 12.5,
                    cursor: issue.ref ? 'pointer' : 'default',
                  }}
                  title={issue.ref ? 'Selecionar elemento' : undefined}
                  onClick={() => {
                    if (issue.ref) {
                      select(issue.ref)
                      onClose()
                    }
                  }}
                >
                  <span className={`chip ${SEVERITY_CLASS[issue.severity]}`} style={{ flex: 'none' }}>
                    {SEVERITY_LABEL[issue.severity]}
                  </span>
                  <span>{issue.message}</span>
                </div>
              ))}
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-primary" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}

export default function TopBar() {
  const project = useStore((s) => s.project)
  const setProjectName = useStore((s) => s.setProjectName)
  const viewMode = useStore((s) => s.viewMode)
  const setViewMode = useStore((s) => s.setViewMode)
  const activeLevelId = useStore((s) => s.activeLevelId)
  const setActiveLevel = useStore((s) => s.setActiveLevel)
  const analysisStatus = useStore((s) => s.analysisStatus)
  const runAnalysis = useStore((s) => s.runAnalysis)
  const results = useStore((s) => s.results)
  const resultsOpen = useStore((s) => s.resultsOpen)
  const setResultsOpen = useStore((s) => s.setResultsOpen)
  const setWizardOpen = useStore((s) => s.setWizardOpen)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const copilotOpen = useStore((s) => s.copilotOpen)
  const setCopilotOpen = useStore((s) => s.setCopilotOpen)
  const loadProject = useStore((s) => s.loadProject)

  const undo = () => useStore.temporal.getState().undo()
  const redo = () => useStore.temporal.getState().redo()
  const [consistOpen, setConsistOpen] = useState(false)

  const editableLevels = project.levels.filter((l) => l.planId !== null)

  return (
    <div className="topbar">
      <div className="logo">
        <IconLogo size={20} />
        Hyper<b>Frame</b>
      </div>

      <input
        className="input"
        style={{ width: 220, fontFamily: 'var(--sans)' }}
        value={project.name}
        onChange={(e) => setProjectName(e.target.value)}
        title="Nome do projeto"
      />

      <div className="divider-v" />

      <button className="btn-icon" title="Novo projeto" onClick={() => setWizardOpen(true)}>
        <IconNew />
      </button>
      <button
        className="btn-icon"
        title="Abrir projeto (⌘O)"
        onClick={async () => {
          try {
            const r = await openProjectFile()
            if (r) loadProject(r.project, r.fileName)
          } catch (err) {
            alert(err instanceof Error ? err.message : String(err))
          }
        }}
      >
        <IconOpen />
      </button>
      <button
        className="btn-icon"
        title="Salvar projeto (⌘S) · Shift+clique: Salvar como… (⇧⌘S)"
        onClick={async (e) => {
          try {
            const st = useStore.getState()
            const path = e.shiftKey
              ? await saveProjectAs(st.project, st.fileName)
              : await saveProject(st.project, st.fileName)
            if (path) {
              st.markSaved(path)
              clearAutosave()
            }
          } catch (err) {
            alert(err instanceof Error ? err.message : String(err))
          }
        }}
      >
        <IconSave />
      </button>

      <div className="divider-v" />

      <button className="btn-icon" title="Desfazer (⌘Z)" onClick={undo}>
        <IconUndo />
      </button>
      <button className="btn-icon" title="Refazer (⇧⌘Z)" onClick={redo}>
        <IconRedo />
      </button>

      <div className="divider-v" />

      <select
        className="select"
        value={activeLevelId}
        onChange={(e) => setActiveLevel(e.target.value)}
        title="Pavimento ativo"
        style={{ width: 150 }}
      >
        {editableLevels.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name} — {l.elevation.toFixed(2).replace('.', ',')} m
          </option>
        ))}
      </select>

      <div style={{ display: 'flex', gap: 2, background: 'var(--bg-2)', borderRadius: 6, padding: 2 }}>
        <button
          className={`btn-icon ${viewMode === 'plan' ? 'active' : ''}`}
          style={{ width: 28, height: 26 }}
          title="Planta 2D"
          onClick={() => setViewMode('plan')}
        >
          <IconPlan size={15} />
        </button>
        <button
          className={`btn-icon ${viewMode === 'split' ? 'active' : ''}`}
          style={{ width: 28, height: 26 }}
          title="Planta + 3D"
          onClick={() => setViewMode('split')}
        >
          <IconSplit size={15} />
        </button>
        <button
          className={`btn-icon ${viewMode === '3d' ? 'active' : ''}`}
          style={{ width: 28, height: 26 }}
          title="3D"
          onClick={() => setViewMode('3d')}
        >
          <IconCube size={15} />
        </button>
      </div>

      <div style={{ flex: 1 }} />

      <button className="btn-icon" title="Parâmetros do projeto (normas)" onClick={() => setSettingsOpen(true)}>
        <IconSettings />
      </button>

      {results && (
        <button
          className={`btn ${resultsOpen ? '' : 'btn-ghost'}`}
          onClick={() => setResultsOpen(!resultsOpen)}
          title="Painel de resultados"
        >
          <IconResults size={15} />
          Resultados
        </button>
      )}

      <button
        className="btn btn-ghost"
        onClick={() => setConsistOpen(true)}
        title="Verificar consistência do modelo (pilares, vigas, lajes, cargas)"
      >
        Consistência
      </button>

      <button
        className={`btn ${copilotOpen ? '' : 'btn-ghost'}`}
        onClick={() => setCopilotOpen(!copilotOpen)}
        title="Copiloto IA — lê, planeja e edita o modelo com sua aprovação"
      >
        ✨ Copiloto
      </button>

      <button
        className="btn btn-primary"
        disabled={analysisStatus === 'running'}
        onClick={runAnalysis}
        title="Gerar pórtico espacial e analisar (NBR 6118/6123/8681)"
      >
        <IconPlay size={14} />
        {analysisStatus === 'running' ? 'Analisando…' : 'Analisar'}
      </button>

      {consistOpen && <ConsistencyModal onClose={() => setConsistOpen(false)} />}
    </div>
  )
}
