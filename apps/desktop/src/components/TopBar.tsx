import { useStore } from '../store'
import { openProjectFile, saveProjectFile } from '../io/fileio'
import {
  IconCube,
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
  const loadProject = useStore((s) => s.loadProject)

  const undo = () => useStore.temporal.getState().undo()
  const redo = () => useStore.temporal.getState().redo()

  const editableLevels = project.levels.filter((l) => l.planId !== null)

  return (
    <div className="topbar">
      <div className="logo">
        <IconCube size={20} />
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
        title="Abrir projeto"
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
        title="Salvar projeto"
        onClick={() => saveProjectFile(project, useStore.getState().fileName)}
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
        className="btn btn-primary"
        disabled={analysisStatus === 'running'}
        onClick={runAnalysis}
        title="Gerar pórtico espacial e analisar (NBR 6118/6123/8681)"
      >
        <IconPlay size={14} />
        {analysisStatus === 'running' ? 'Analisando…' : 'Analisar'}
      </button>
    </div>
  )
}
