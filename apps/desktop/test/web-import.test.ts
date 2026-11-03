import { describe, expect, it } from 'vitest'
import { createSampleProject, serializeProject } from '@hyperframe/engine'
import { parseImportedProject } from '../src/web/importProject'

const file = (project: unknown, schemaVersion = 1) =>
  JSON.stringify({ magic: 'hyperframe', schemaVersion, project })

describe('importação (build web)', () => {
  it('aceita um projeto válido', () => {
    const p = createSampleProject()
    expect(parseImportedProject(serializeProject(p), 'a.hyperframe.json').name).toBe(p.name)
  })

  // arquivos dos repros da revisão: antes davam TypeError cru e gravavam registro
  it.each([
    ['vazio', file({ name: 'Vazio', levels: [], plans: [], columns: [], settings: {} }), /níveis/],
    ['sem settings', file({ name: 'x', levels: [], plans: [], columns: [] }), /configurações/],
    ['versão 2', file({}, 2), /Versão de arquivo não suportada \(2\)/],
    ['não JSON', '{', /JSON válido/],
    ['outro JSON', '{"a":1}', /não é um projeto HyperFrame/],
    [
      'planta sem vigas',
      file({ name: 'x', levels: [{ id: 'l1' }], plans: [{}], columns: [], settings: {} }),
      /plantas/,
    ],
  ])('%s → erro amigável em pt-BR', (_, text, msg) => {
    expect(() => parseImportedProject(text, 'f.hyperframe.json')).toThrow(msg)
    expect(() => parseImportedProject(text, 'f.hyperframe.json')).toThrow(
      /^Não foi possível importar “f\.hyperframe\.json”/,
    )
  })
})
