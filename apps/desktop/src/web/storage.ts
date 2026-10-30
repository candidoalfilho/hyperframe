/**
 * Projetos do navegador em IndexedDB (build web). Cada registro guarda o
 * MESMO JSON do arquivo .hyperframe.json (serializeProject) + metadados.
 * Wrapper mínimo sobre a API nativa — sem dependências.
 */

export interface WebProjectMeta {
  /** UUID v4 (crypto.randomUUID) — também é a URL: #/p/<id> */
  id: string
  /** nome do "arquivo" escolhido no primeiro salvamento */
  name: string
  /** ISO 8601 */
  updatedAt: string
}

export interface WebProjectRecord extends WebProjectMeta {
  /** conteúdo idêntico ao .hyperframe.json */
  data: string
}

const DB_NAME = 'hyperframe'
const DB_VERSION = 1
const STORE = 'projects'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt')
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => {
        dbPromise = null
        reject(req.error ?? new Error('IndexedDB indisponível'))
      }
    })
  }
  return dbPromise
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
    id: crypto.randomUUID(),
    name,
    updatedAt: new Date().toISOString(),
    data,
  }
  await run('readwrite', (s) => s.put(rec))
  return rec
}

/** grava o conteúdo de um projeto existente (mantém o nome) */
export async function updateWebProject(id: string, data: string): Promise<WebProjectRecord> {
  const cur = await getWebProject(id)
  if (!cur) throw new Error('Projeto não encontrado neste navegador.')
  const rec: WebProjectRecord = { ...cur, data, updatedAt: new Date().toISOString() }
  await run('readwrite', (s) => s.put(rec))
  return rec
}

export async function renameWebProject(id: string, name: string): Promise<void> {
  const cur = await getWebProject(id)
  if (!cur) throw new Error('Projeto não encontrado neste navegador.')
  await run('readwrite', (s) => s.put({ ...cur, name, updatedAt: new Date().toISOString() }))
}

export async function deleteWebProject(id: string): Promise<void> {
  await run('readwrite', (s) => s.delete(id))
}
