import { parseProject, serializeProject, type Project } from '@hyperframe/engine'
import { isTauri, platform } from '../platform'
import { webFileName, webProjectId } from '../web/route'
import {
  baseRevision,
  createWebProject,
  updateWebProject,
  WebProjectConflictError,
  WebProjectMissingError,
  WebStorageUnavailableError,
  webStorageAvailable,
} from '../web/storage'
import { askName } from '../web/NamePrompt'
import { parseImportedProject } from '../web/importProject'

export { isTauri }

/**
 * Salvamento/abertura de projeto (.hyperframe.json) e exportação de arquivos.
 *
 * No app desktop (Tauri): diálogos NATIVOS do SO (plugin-dialog) + escrita
 * direta no caminho (plugin-fs) — "Salvar" grava no mesmo arquivo, "Salvar
 * como…" abre o diálogo. No navegador: projetos no IndexedDB (`fileName` =
 * `idb:<uuid>`, ver web/route.ts) + exportar/importar .hyperframe.json.
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
  if (platform.browserProjects) {
    if (!(await webStorageAvailable())) {
      // sem IndexedDB: oferece exportar o arquivo (o projeto segue aberto)
      const msg = new WebStorageUnavailableError().message
      if (confirm(`${msg}\n\nExportar agora como .hyperframe.json?`)) await exportProjectFile(project)
      return null
    }
    const name = await askName('Salvar projeto', 'Nome do arquivo', project.name)
    if (!name) return null
    const rec = await createWebProject(name, text)
    return webFileName(rec.id)
  }
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
  const webId = platform.browserProjects ? webProjectId(filePath) : null
  if (webId) {
    const text = serializeProject(project)
    try {
      await updateWebProject(webId, text, baseRevision(webId) ?? 0)
      return filePath ?? null
    } catch (err) {
      if (err instanceof WebProjectConflictError) {
        if (
          confirm(
            `“${project.name}” foi alterado em outra aba ou janela depois que você o abriu aqui.\n\n` +
              'OK: sobrescrever com a versão desta aba\n' +
              'Cancelar: salvar esta versão como um projeto novo',
          )
        ) {
          await updateWebProject(webId, text)
          return filePath ?? null
        }
        return saveProjectAs(project, filePath)
      }
      // excluído (p.ex. em outra aba): o Salvar manual vira "Salvar como…"
      if (!(err instanceof WebProjectMissingError)) throw err
    }
  }
  if (isTauri() && filePath && filePath.includes('/')) {
    const { writeTextFile } = await import('@tauri-apps/plugin-fs')
    await writeTextFile(filePath, serializeProject(project))
    return filePath
  }
  return saveProjectAs(project, filePath)
}

export type WebAutosaveResult = 'saved' | 'missing' | 'conflict'

/**
 * Autosave da build web: grava no registro do IndexedDB SEM nunca abrir
 * diálogo. Se o registro sumiu ou outra aba gravou antes, devolve
 * 'missing'/'conflict' p/ o App avisar uma vez — não sobrescreve nada.
 */
export async function autosaveWebProject(project: Project, id: string): Promise<WebAutosaveResult> {
  try {
    await updateWebProject(id, serializeProject(project), baseRevision(id) ?? 0)
    return 'saved'
  } catch (err) {
    if (err instanceof WebProjectMissingError) return 'missing'
    if (err instanceof WebProjectConflictError) return 'conflict'
    throw err
  }
}

/**
 * Abre projeto: diálogo nativo (Tauri) ou input de arquivo (browser). Na web
 * o arquivo é IMPORTADO como um projeto novo do navegador (UUID novo).
 */
export async function openProjectFile(): Promise<{ project: Project; fileName: string | null } | null> {
  if (platform.browserProjects) {
    const picked = await pickProjectFile()
    if (!picked) return null
    // valida ANTES de gravar: arquivo inválido não deixa registro no navegador
    const project = parseImportedProject(picked.text, picked.name)
    const name = picked.name.replace(/\.json$/i, '').replace(/\.hyperframe$/i, '') || project.name
    // sem IndexedDB: abre só em memória (rascunho no localStorage; Exportar p/ guardar)
    if (!(await webStorageAvailable())) return { project, fileName: null }
    const rec = await createWebProject(name, serializeProject(project))
    return { project, fileName: webFileName(rec.id) }
  }
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
  const picked = await pickProjectFile()
  return picked ? { project: parseProject(picked.text), fileName: picked.name } : null
}

// ---------------------------------------------------------------------------
// File System Access API (Chromium) com fallback p/ input/download
// ---------------------------------------------------------------------------

interface FsHandle {
  getFile(): Promise<File>
  createWritable(): Promise<{ write(d: BlobPart): Promise<void>; close(): Promise<void> }>
}
type FsWindow = Window & {
  showOpenFilePicker?: (o?: unknown) => Promise<FsHandle[]>
  showSaveFilePicker?: (o?: unknown) => Promise<FsHandle>
}

const FS_TYPES = [
  { description: 'Projeto HyperFrame', accept: { 'application/json': ['.json'] } },
]

const isAbort = (err: unknown): boolean => err instanceof DOMException && err.name === 'AbortError'

/** escolhe um .hyperframe.json do disco (texto + nome) ou null (cancelado) */
async function pickProjectFile(): Promise<{ text: string; name: string } | null> {
  const w = window as FsWindow
  if (w.showOpenFilePicker) {
    try {
      const [h] = await w.showOpenFilePicker({ types: FS_TYPES, multiple: false })
      const file = await h.getFile()
      return { text: await file.text(), name: file.name }
    } catch (err) {
      if (isAbort(err)) return null
      // segue p/ o input clássico
    }
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,.hyperframe'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return resolve(null)
      try {
        resolve({ text: await file.text(), name: file.name })
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
 * Exporta o projeto como .hyperframe.json p/ o disco do usuário (web):
 * showSaveFilePicker quando disponível, senão download. Retorna o nome ou null.
 */
export async function exportProjectFile(project: Project, name?: string): Promise<string | null> {
  const text = serializeProject(project)
  const fileName = name
    ? `${name.replace(/[^\p{L}\p{N}\-_ ]/gu, '').trim() || 'projeto'}.hyperframe.json`
    : suggestedName(project)
  if (isTauri()) return exportFile(text, fileName, 'Projeto HyperFrame', 'json', 'application/json')
  const w = window as FsWindow
  if (w.showSaveFilePicker) {
    try {
      const h = await w.showSaveFilePicker({ suggestedName: fileName, types: FS_TYPES })
      const out = await h.createWritable()
      await out.write(text)
      await out.close()
      return fileName
    } catch (err) {
      if (isAbort(err)) return null
      // sem permissão/gesto do usuário — cai no download
    }
  }
  return browserDownload(text, fileName, 'application/json')
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
