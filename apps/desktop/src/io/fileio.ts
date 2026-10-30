import { parseProject, serializeProject, type Project } from '@hyperframe/engine'
import { isTauri, platform } from '../platform'

export { isTauri }

/**
 * Salvamento/abertura de projeto (.hyperframe.json) e exportação de arquivos.
 *
 * No app desktop (Tauri): diálogos NATIVOS do SO (plugin-dialog) + escrita
 * direta no caminho (plugin-fs) — "Salvar" grava no mesmo arquivo, "Salvar
 * como…" abre o diálogo. No navegador: download/upload (fallback).
 */

function suggestedName(project: Project): string {
  return `${project.name.replace(/[^\p{L}\p{N}\-_ ]/gu, '').trim() || 'projeto'}.hyperframe.json`
}

function browserDownload(data: BlobPart, name: string, mime: string): string {
  const blob = new Blob([data], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
  return name
}

const PROJECT_FILTERS = [{ name: 'Projeto HyperFrame', extensions: ['json'] }]

/** "Salvar como…": sempre pergunta o destino. Retorna o caminho/nome ou null (cancelado). */
export async function saveProjectAs(
  project: Project,
  currentPath?: string | null,
): Promise<string | null> {
  const text = serializeProject(project)
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const { writeTextFile } = await import('@tauri-apps/plugin-fs')
    const path = await save({
      title: 'Salvar projeto',
      defaultPath: currentPath ?? suggestedName(project),
      filters: PROJECT_FILTERS,
    })
    if (!path) return null
    await writeTextFile(path, text)
    return path
  }
  return browserDownload(text, suggestedName(project), 'application/json')
}

/**
 * "Salvar": grava direto no arquivo atual (Tauri, caminho absoluto conhecido);
 * senão delega ao "Salvar como…".
 */
export async function saveProject(
  project: Project,
  filePath?: string | null,
): Promise<string | null> {
  if (isTauri() && filePath && filePath.includes('/')) {
    const { writeTextFile } = await import('@tauri-apps/plugin-fs')
    await writeTextFile(filePath, serializeProject(project))
    return filePath
  }
  return saveProjectAs(project, filePath)
}

/** Abre projeto: diálogo nativo (Tauri) ou input de arquivo (browser). */
export async function openProjectFile(): Promise<{ project: Project; fileName: string } | null> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const { readTextFile } = await import('@tauri-apps/plugin-fs')
    const path = await open({
      title: 'Abrir projeto',
      multiple: false,
      directory: false,
      filters: PROJECT_FILTERS,
    })
    if (typeof path !== 'string') return null
    const text = await readTextFile(path)
    return { project: parseProject(text), fileName: path }
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,.hyperframe'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return resolve(null)
      try {
        const text = await file.text()
        resolve({ project: parseProject(text), fileName: file.name })
      } catch (err) {
        reject(err)
      }
    }
    // cancelamento silencioso
    input.oncancel = () => resolve(null)
    input.click()
  })
}

/**
 * Exporta um arquivo (PDF, DXF…): diálogo nativo de salvamento (Tauri) ou
 * download (browser). Retorna caminho/nome ou null (cancelado).
 */
export async function exportFile(
  data: Uint8Array | string,
  defaultName: string,
  filterName: string,
  extension: string,
  mime: string,
): Promise<string | null> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const path = await save({
      title: `Exportar ${filterName}`,
      defaultPath: defaultName,
      filters: [{ name: filterName, extensions: [extension] }],
    })
    if (!path) return null
    if (typeof data === 'string') {
      const { writeTextFile } = await import('@tauri-apps/plugin-fs')
      await writeTextFile(path, data)
    } else {
      const { writeFile } = await import('@tauri-apps/plugin-fs')
      await writeFile(path, data)
    }
    return path
  }
  return browserDownload(
    typeof data === 'string' ? data : (data.slice().buffer as ArrayBuffer),
    defaultName,
    mime,
  )
}

// ---------------------------------------------------------------------------
// autosave / recuperação (localStorage — browser e WebView do Tauri)
// ---------------------------------------------------------------------------

const AUTOSAVE_KEY = 'hyperframe.autosave.v1'

export interface AutosavePayload {
  when: string
  fileName: string | null
  projectName: string
  data: string
}

export function writeAutosave(project: Project, fileName: string | null): void {
  try {
    const payload: AutosavePayload = {
      when: new Date().toISOString(),
      fileName,
      projectName: project.name,
      data: serializeProject(project),
    }
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(payload))
  } catch {
    // quota/indisponível — autosave é melhor esforço
  }
}

export function readAutosave(): (AutosavePayload & { project: Project }) | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY)
    if (!raw) return null
    const payload = JSON.parse(raw) as AutosavePayload
    return { ...payload, project: parseProject(payload.data) }
  } catch {
    return null
  }
}

export function clearAutosave(): void {
  try {
    localStorage.removeItem(AUTOSAVE_KEY)
  } catch {
    // ignora
  }
}

// ---------------------------------------------------------------------------
// projetos recentes (localStorage) — só caminhos absolutos (app desktop),
// pois no navegador não há como reabrir um arquivo pelo nome
// ---------------------------------------------------------------------------

const RECENTS_KEY = 'hyperframe.recents.v1'
const RECENTS_MAX = 8

export interface RecentProject {
  path: string
  name: string
  when: string
}

export function readRecents(): RecentProject[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY)
    if (!raw) return []
    const list = JSON.parse(raw) as RecentProject[]
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function pushRecent(path: string | null, name: string): void {
  if (!path || !path.includes('/')) return
  try {
    const list = readRecents().filter((r) => r.path !== path)
    list.unshift({ path, name, when: new Date().toISOString() })
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, RECENTS_MAX)))
  } catch {
    // melhor esforço
  }
}

export function removeRecent(path: string): void {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(readRecents().filter((r) => r.path !== path)))
  } catch {
    // ignora
  }
}

/** Abre um projeto recente pelo caminho (apenas Tauri). */
export async function openRecentProject(
  path: string,
): Promise<{ project: Project; fileName: string }> {
  if (!platform.recentFiles) throw new Error('Abrir recentes só está disponível no app desktop.')
  const { readTextFile } = await import('@tauri-apps/plugin-fs')
  const text = await readTextFile(path)
  return { project: parseProject(text), fileName: path }
}
