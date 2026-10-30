import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import {
  createWebProject,
  deleteWebProject,
  getWebProject,
  listWebProjects,
  renameWebProject,
  updateWebProject,
} from '../src/web/storage'

const tick = () => new Promise((r) => setTimeout(r, 5))

describe('projetos no IndexedDB', () => {
  it('cria, lê, atualiza, renomeia, lista e exclui', async () => {
    const a = await createWebProject('Obra A', '{"v":1}')
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(await getWebProject(a.id)).toMatchObject({ name: 'Obra A', data: '{"v":1}' })

    await tick()
    const b = await createWebProject('Obra B', '{"v":2}')
    let list = await listWebProjects()
    expect(list.map((p) => p.name)).toEqual(['Obra B', 'Obra A']) // mais recente primeiro
    expect(list[0]).not.toHaveProperty('data') // lista só metadados

    await tick()
    const a2 = await updateWebProject(a.id, '{"v":3}')
    expect(a2.updatedAt > a.updatedAt).toBe(true) // ISO 8601 ordena como texto
    expect((await getWebProject(a.id))?.data).toBe('{"v":3}')
    list = await listWebProjects()
    expect(list[0].id).toBe(a.id)

    await renameWebProject(b.id, 'Obra B2')
    expect((await getWebProject(b.id))?.name).toBe('Obra B2')

    await deleteWebProject(a.id)
    expect(await getWebProject(a.id)).toBeNull()
    expect((await listWebProjects()).map((p) => p.id)).toEqual([b.id])
  })

  it('atualizar projeto inexistente falha', async () => {
    await expect(updateWebProject('00000000-0000-4000-8000-000000000000', '{}')).rejects.toThrow()
  })
})
