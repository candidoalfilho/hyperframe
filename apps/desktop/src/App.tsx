import { useEffect } from 'react'
import { useStore } from './store'
import {
  clearAutosave,
  openProjectFile,
  saveProject,
  saveProjectAs,
  writeAutosave,
} from './io/fileio'
import TopBar from './components/TopBar'
import ToolBar from './components/ToolBar'
import StatusBar from './components/StatusBar'
import Editor2D from './editor2d/Editor2D'
import Viewer3D from './viewer3d/Viewer3D'
import InspectorPanel from './panels/InspectorPanel'
import ResultsPanel from './panels/ResultsPanel'
import WelcomeModal from './panels/WelcomeModal'
import SettingsModal from './panels/SettingsModal'
import NewProjectWizard from './wizard/NewProjectWizard'
import CopilotPanel from './copilot/CopilotPanel'

export default function App() {
  const viewMode = useStore((s) => s.viewMode)
  const welcomeOpen = useStore((s) => s.welcomeOpen)
  const wizardOpen = useStore((s) => s.wizardOpen)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const resultsOpen = useStore((s) => s.resultsOpen)
  const copilotOpen = useStore((s) => s.copilotOpen)
  const setCopilotOpen = useStore((s) => s.setCopilotOpen)

  // atalhos globais
  useEffect(() => {
    const saveNow = async (saveAs: boolean) => {
      const st = useStore.getState()
      try {
        const path = saveAs
          ? await saveProjectAs(st.project, st.fileName)
          : await saveProject(st.project, st.fileName)
        if (path) {
          st.markSaved(path)
          clearAutosave()
        }
      } catch (err) {
        alert(err instanceof Error ? err.message : String(err))
      }
    }
    const openNow = async () => {
      try {
        const r = await openProjectFile()
        if (r) useStore.getState().loadProject(r.project, r.fileName)
      } catch (err) {
        alert(err instanceof Error ? err.message : String(err))
      }
    }
    const onKey = (e: KeyboardEvent) => {
      // ⌘S / ⇧⌘S / ⌘O funcionam mesmo com foco em inputs
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveNow(e.shiftKey)
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        void openNow()
        return
      }
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')
        return
      const s = useStore.getState()
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) useStore.temporal.getState().redo()
        else useStore.temporal.getState().undo()
        return
      }
      switch (e.key) {
        case 'v':
        case 'V':
          s.setTool('select')
          break
        case 'p':
        case 'P':
          s.setTool('column')
          break
        case 'b':
        case 'B':
          s.setTool('beam')
          break
        case 'l':
        case 'L':
          s.setTool('slab')
          break
        case 'w':
        case 'W':
          s.setTool('wall')
          break
        case 'r':
        case 'R':
          s.setTool('region')
          break
        case 'Delete':
        case 'Backspace':
          s.deleteSelected()
          break
        case 'Escape':
          s.setTool('select')
          s.select(null)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // autosave: grava rascunho no localStorage ~2 s após cada mudança no projeto
  useEffect(() => {
    let timer: number | undefined
    const unsub = useStore.subscribe((s, prev) => {
      if (s.project === prev.project) return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const st = useStore.getState()
        if (st.dirty) writeAutosave(st.project, st.fileName)
      }, 2000)
    })
    return () => {
      unsub()
      window.clearTimeout(timer)
    }
  }, [])

  return (
    <div className="app-shell">
      <TopBar />
      <div className="app-main">
        <ToolBar />
        <div className="view-area">
          {(viewMode === 'plan' || viewMode === 'split') && (
            <div className="view-half">
              <Editor2D />
            </div>
          )}
          {(viewMode === '3d' || viewMode === 'split') && (
            <div className="view-half">
              <Viewer3D />
            </div>
          )}
        </div>
        <InspectorPanel />
      </div>
      <StatusBar />

      {resultsOpen && <ResultsPanel />}
      {copilotOpen && <CopilotPanel onClose={() => setCopilotOpen(false)} />}
      {welcomeOpen && <WelcomeModal />}
      {wizardOpen && <NewProjectWizard />}
      {settingsOpen && <SettingsModal />}
    </div>
  )
}
