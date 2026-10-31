import { useEffect } from 'react'
import type { Project } from '@hyperframe/engine'
import { useStore } from './store'
import {
  autosaveWebProject,
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
import WelcomeScreen from './panels/WelcomeScreen'
import SettingsModal from './panels/SettingsModal'
import NewProjectWizard from './wizard/NewProjectWizard'
import CopilotPanel from './copilot/CopilotPanel'
import { hasCopilot, platform } from './platform'
import { webProjectId } from './web/route'
import { baseRevision } from './web/storage'
import { useWebRouting } from './web/useWebRouting'
import { applyUiZoom, getUiZoom, setUiZoom } from './ui/zoom'

export default function App() {
  const viewMode = useStore((s) => s.viewMode)
  const welcomeOpen = useStore((s) => s.welcomeOpen)
  const wizardOpen = useStore((s) => s.wizardOpen)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const resultsOpen = useStore((s) => s.resultsOpen)
  const copilotOpen = useStore((s) => s.copilotOpen)
  const setCopilotOpen = useStore((s) => s.setCopilotOpen)

  // build web: URL #/p/<uuid> ⇄ projeto aberto
  useWebRouting()

  // zoom da INTERFACE (Ctrl/⌘ + · − · 0) — persiste por máquina; útil em
  // telas Windows com escala alta onde a UI fica pequena
  useEffect(() => {
    applyUiZoom(getUiZoom())
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
      const z = getUiZoom()
      if (e.key === '+' || e.key === '=') setUiZoom(z + 0.1)
      else if (e.key === '-') setUiZoom(z - 0.1)
      else if (e.key === '0') setUiZoom(1)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
  // (web: projeto já salvo no navegador grava direto no seu registro do IndexedDB)
  useEffect(() => {
    let timer: number | undefined
    // web: projetos cujo autosave foi pausado por conflito com outra aba
    const paused = new Set<string>()

    const autosaveWeb = async (project: Project, fileName: string, id: string) => {
      if (paused.has(id)) return writeAutosave(project, fileName)
      let result
      try {
        result = await autosaveWebProject(project, id)
      } catch {
        return writeAutosave(project, fileName) // quota etc.: rascunho no localStorage
      }
      const now = useStore.getState()
      if (result === 'saved') {
        clearAutosave(fileName) // rascunho de saída já não é necessário
        // só limpa o "não salvo" se nada mudou durante a gravação
        if (now.project === project && now.fileName === fileName) now.markSaved(fileName)
        return
      }
      writeAutosave(project, result === 'missing' ? null : fileName)
      if (result === 'missing') {
        // excluído em outra aba: segue aberto como projeto NÃO salvo (sem diálogo)
        if (now.fileName === fileName) useStore.setState({ fileName: null, dirty: true })
        alert(
          `“${project.name}” foi excluído deste navegador (talvez em outra aba).\n` +
            'As alterações continuam abertas aqui como projeto não salvo — use Salvar para guardá-lo de novo.',
        )
      } else {
        paused.add(id)
        alert(
          `“${project.name}” foi alterado em outra aba ou janela.\n` +
            'Para não sobrescrever, o salvamento automático desta aba foi pausado. ' +
            'Use Salvar para escolher entre sobrescrever ou salvar como cópia.',
        )
      }
    }

    if (!platform.browserProjects) {
      // desktop: rascunho no localStorage (comportamento original)
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
    }

    // web: a mudança pendente é capturada na hora da edição e gravada já ao
    // trocar de projeto, ao esconder/fechar a aba — nunca se perde no debounce
    let pending: { project: Project; fileName: string | null } | null = null
    let inflight = 0
    const flush = (leaving = false) => {
      window.clearTimeout(timer)
      const p = pending
      pending = null
      if (!p) return
      const id = webProjectId(p.fileName)
      if (!id || !p.fileName) return writeAutosave(p.project, p.fileName)
      // aba fechando: o IndexedDB pode não terminar — rascunho síncrono no
      // localStorage (recuperado ao reabrir o projeto, ver openWebProject)
      if (leaving) writeAutosave(p.project, p.fileName, baseRevision(id))
      inflight++
      void autosaveWeb(p.project, p.fileName, id).finally(() => inflight--)
    }

    const unsub = useStore.subscribe((s, prev) => {
      // Salvar manual (ou reabrir) resolve o conflito: retoma o autosave
      if (s.fileName !== prev.fileName || (prev.dirty && !s.dirty)) paused.clear()
      if (pending && pending.project === s.project && !s.dirty) {
        pending = null // salvo manualmente
        window.clearTimeout(timer)
      }
      // trocou de projeto (outra URL, Meus projetos, importar…): grava o anterior já
      if (pending && s.fileName !== pending.fileName) flush()
      if (s.project === prev.project || !s.dirty) return
      pending = { project: s.project, fileName: s.fileName }
      window.clearTimeout(timer)
      timer = window.setTimeout(() => flush(), 2000)
    })
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush(true)
    }
    const onPageHide = () => flush(true)
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!pending && inflight === 0) return
      flush(true)
      // gravação ainda em curso: pede confirmação p/ sair
      e.preventDefault()
      e.returnValue = ''
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      flush()
      unsub()
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [])

  // tela inicial: página cheia (menu) — o editor só aparece depois de uma escolha
  if (welcomeOpen) return <WelcomeScreen />

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
      {copilotOpen && hasCopilot() && <CopilotPanel onClose={() => setCopilotOpen(false)} />}
      {wizardOpen && <NewProjectWizard />}
      {settingsOpen && <SettingsModal />}
    </div>
  )
}
