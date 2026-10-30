import { useEffect } from 'react'
import { parseProject } from '@hyperframe/engine'
import { useStore } from '../store'
import { platform } from '../platform'
import { parseRoute, routeHash, webFileName, webProjectId } from './route'
import { getWebProject, trackRevision } from './storage'

/** abre um projeto do navegador pelo UUID (false = não encontrado) */
export async function openWebProject(id: string): Promise<boolean> {
  const rec = await getWebProject(id)
  if (!rec) return false
  trackRevision(rec)
  useStore.getState().loadProject(parseProject(rec.data), webFileName(rec.id))
  return true
}

/**
 * Build web: mantém a URL (#/p/<uuid>) e o projeto aberto em sincronia.
 * URL → store no carregamento e no voltar/avançar/editar a URL (popstate); store → URL
 * quando um projeto é salvo/aberto ou o usuário volta à tela inicial.
 */
export function useWebRouting(): void {
  useEffect(() => {
    if (!platform.browserProjects) return

    const applyUrl = async () => {
      const route = parseRoute(window.location.hash)
      const st = useStore.getState()
      if (route.kind === 'home') {
        if (!st.welcomeOpen) st.setWelcomeOpen(true)
        return
      }
      if (webProjectId(st.fileName) === route.id) {
        if (st.welcomeOpen) st.setWelcomeOpen(false)
        return
      }
      try {
        if (!(await openWebProject(route.id))) {
          alert('Projeto não encontrado neste navegador.')
          history.replaceState(null, '', window.location.pathname + window.location.search)
          useStore.getState().setWelcomeOpen(true)
        }
      } catch (err) {
        alert(err instanceof Error ? err.message : String(err))
      }
    }

    const syncUrl = () => {
      const st = useStore.getState()
      const id = webProjectId(st.fileName)
      const want = st.welcomeOpen || !id ? '' : routeHash({ kind: 'project', id })
      const have = routeHash(parseRoute(window.location.hash))
      if (want === have) return
      history.pushState(null, '', want || window.location.pathname + window.location.search)
    }

    void applyUrl()
    window.addEventListener('popstate', applyUrl)
    const unsub = useStore.subscribe((s, prev) => {
      if (s.fileName !== prev.fileName || s.welcomeOpen !== prev.welcomeOpen) syncUrl()
    })
    return () => {
      window.removeEventListener('popstate', applyUrl)
      unsub()
    }
  }, [])
}
