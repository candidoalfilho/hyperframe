/**
 * Projetos do navegador em IndexedDB (build web). Cada registro guarda o
 * MESMO JSON do arquivo .hyperframe.json (serializeProject) + metadados.
 * Wrapper mínimo sobre a API nativa — sem dependências.
 */

import { newUuid } from './uuid'

export interface WebProjectMeta {
  /** UUID v4 (newUuid) — também é a URL: #/p/<id> */
  id: string
  /** nome do "arquivo" escolhido no primeiro salvamento */
  name: string
  /** ISO 8601 */
  updatedAt: string
}

export interface WebProjectRecord extends WebProjectMeta {
  /** conteúdo idêntico ao .hyperframe.json */
  data: string
  /** revisão do conteúdo (+1 a cada gravação; ausente em registros antigos = 0) */
  rev?: number
}

/** o registro foi excluído (p.ex. em outra aba) */
export class WebProjectMissingError extends Error {
  constructor() {
    super('Projeto não encontrado neste navegador.')
    this.name = 'WebProjectMissingError'
  }
}

/** o registro foi gravado por outra aba/janela depois que esta o abriu */
export class WebProjectConflictError extends Error {
  constructor() {
    super('O projeto foi alterado em outra aba ou janela.')
    this.name = 'WebProjectConflictError'
  }
}

// revisão em que ESTA aba abriu/gravou cada projeto (detecção de conflito)
const baseRevs = new Map<string, number>()

/** registra a revisão de um projeto aberto nesta aba */
export function trackRevision(rec: WebProjectRecord): void {
  baseRevs.set(rec.id, rec.rev ?? 0)
}

/** revisão-base desta aba (undefined = nunca aberto aqui) */
export const baseRevision = (id: string): number | undefined => baseRevs.get(id)

const DB_NAME = 'hyperframe'
const DB_VERSION = 1
const STORE = 'projects'

/** IndexedDB ausente/bloqueado (janela privada, cookies bloqueados, iframe…) */
export class WebStorageUnavailableError extends Error {
  constructor() {
    super(
      'Este navegador não permite guardar projetos (IndexedDB indisponível — ex.: janela ' +
        'privada ou armazenamento bloqueado). Você pode continuar editando e usar “Exportar” ' +
        'p/ guardar o .hyperframe.json no computador.',
    )
    this.name = 'WebStorageUnavailableError'
  }
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      let req: IDBOpenDBRequest
      try {
        if (typeof indexedDB === 'undefined' || !indexedDB) throw new Error()
        req = indexedDB.open(DB_NAME, DB_VERSION)
      } catch {
        dbPromise = null
        reject(new WebStorageUnavailableError())
        return
      }
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt')
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => {
        dbPromise = null
        reject(new WebStorageUnavailableError())
      }
    })
  }
  return dbPromise
}

/** true se dá p/ guardar projetos neste navegador */
export async function webStorageAvailable(): Promise<boolean> {
  try {
    await openDb()
    return true
  } catch {
    return false
  }
}

async function run<T>(
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const req = op(tx.objectStore(STORE))
    tx.oncomplete = () => resolve(req.result)
    tx.onerror = () => reject(tx.error ?? req.error)
    tx.onabort = () => reject(tx.error ?? new Error('transação abortada'))
  })
}

/** lista (mais recente primeiro) — só metadados */
export async function listWebProjects(): Promise<WebProjectMeta[]> {
  const all = await run('readonly', (s) => s.getAll() as IDBRequest<WebProjectRecord[]>)
  return all
    .map(({ id, name, updatedAt }) => ({ id, name, updatedAt }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function getWebProject(id: string): Promise<WebProjectRecord | null> {
  const rec = await run('readonly', (s) => s.get(id) as IDBRequest<WebProjectRecord | undefined>)
  return rec ?? null
}

/** cria um projeto novo (UUID novo) */
export async function createWebProject(name: string, data: string): Promise<WebProjectRecord> {
  const rec: WebProjectRecord = {
    id: newUuid(),
    name,
    updatedAt: new Date().toISOString(),
    data,
    rev: 0,
  }
  await run('readwrite', (s) => s.put(rec))
  trackRevision(rec)
  return rec
}

/**
 * Grava o conteúdo de um projeto existente (mantém o nome). Com `expectedRev`,
 * só grava se ninguém gravou desde então (ler+conferir+gravar numa única
 * transação); senão lança WebProjectConflictError. Sem `expectedRev`,
 * sobrescreve. Registro inexistente → WebProjectMissingError.
 */
export async function updateWebProject(
  id: string,
  data: string,
  expectedRev?: number,
): Promise<WebProjectRecord> {
  const op = doUpdate(id, data, expectedRev)
  writes.add(op)
  void op.catch(() => {}).finally(() => writes.delete(op))
  return op
}

// gravações em curso (abrir um projeto espera as pendentes, ver writesSettled)
const writes = new Set<Promise<unknown>>()

/** resolve quando as gravações iniciadas até agora terminarem (com ou sem erro) */
export async function writesSettled(): Promise<void> {
  await Promise.allSettled([...writes])
}

async function doUpdate(id: string, data: string, expectedRev?: number): Promise<WebProjectRecord> {
  const db = await openDb()
  const rec = await new Promise<WebProjectRecord>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    let out: WebProjectRecord | undefined
    let fail: Error | undefined
    const get = store.get(id) as IDBRequest<WebProjectRecord | undefined>
    get.onsuccess = () => {
      const cur = get.result
      if (!cur) fail = new WebProjectMissingError()
      else if (expectedRev !== undefined && (cur.rev ?? 0) !== expectedRev)
        fail = new WebProjectConflictError()
      else {
        out = { ...cur, data, updatedAt: new Date().toISOString(), rev: (cur.rev ?? 0) + 1 }
        store.put(out)
      }
    }
    tx.oncomplete = () => (out ? resolve(out) : reject(fail))
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('transação abortada'))
  })
  trackRevision(rec)
  return rec
}

export async function renameWebProject(id: string, name: string): Promise<void> {
  const cur = await getWebProject(id)
  if (!cur) throw new WebProjectMissingError()
  // renomear não mexe no conteúdo: mantém `rev`
  await run('readwrite', (s) => s.put({ ...cur, name, updatedAt: new Date().toISOString() }))
}

export async function deleteWebProject(id: string): Promise<void> {
  await run('readwrite', (s) => s.delete(id))
}
