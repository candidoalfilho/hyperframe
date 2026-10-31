import { describe, expect, it } from 'vitest'
import {
  createWebProject,
  listWebProjects,
  WebStorageUnavailableError,
  webStorageAvailable,
} from '../src/web/storage'

// sem fake-indexeddb: `indexedDB` não existe (como em janela privada/bloqueio)
describe('IndexedDB indisponível', () => {
  it('falha com erro amigável (não TypeError) e webStorageAvailable = false', async () => {
    expect(typeof indexedDB).toBe('undefined')
    expect(await webStorageAvailable()).toBe(false)
    await expect(listWebProjects()).rejects.toBeInstanceOf(WebStorageUnavailableError)
    await expect(createWebProject('x', '{}')).rejects.toThrow(/não permite guardar projetos/)
  })
})
