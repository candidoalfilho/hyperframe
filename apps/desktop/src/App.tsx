import { useEffect } from 'react'
import { useStore } from './store'
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

export default function App() {
  const viewMode = useStore((s) => s.viewMode)
  const welcomeOpen = useStore((s) => s.welcomeOpen)
  const wizardOpen = useStore((s) => s.wizardOpen)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const resultsOpen = useStore((s) => s.resultsOpen)

  // atalhos globais
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
      {welcomeOpen && <WelcomeModal />}
      {wizardOpen && <NewProjectWizard />}
      {settingsOpen && <SettingsModal />}
    </div>
  )
}
