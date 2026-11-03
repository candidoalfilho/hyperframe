import { ProjectParseError, parseProject, type Project } from '@hyperframe/engine'

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Importação na build web: valida o .hyperframe.json ANTES de gravar no
 * IndexedDB. `parseProject` confere magic/versão/arrays; aqui também o mínimo
 * que o editor precisa p/ abrir (settings, ao menos um nível com id). Qualquer
 * falha vira um Error com mensagem em pt-BR — nunca um TypeError cru.
 */
export function parseImportedProject(text: string, fileName: string): Project {
  const fail = (why: string) =>
    new Error(`Não foi possível importar “${fileName}”.\n${why}`)
  const raw = (() => {
    try {
      return JSON.parse(text) as unknown
    } catch {
      return undefined
    }
  })()
  // magic/versão/JSON inválido: as mensagens do parseProject já são boas
  const p =
    isObj(raw) && raw.magic === 'hyperframe' && raw.schemaVersion === 1 && isObj(raw.project)
      ? raw.project
      : null
  if (p) {
    if (!isObj(p.settings)) throw fail('Arquivo corrompido: faltam as configurações do projeto.')
    if (
      !Array.isArray(p.levels) ||
      p.levels.length === 0 ||
      !p.levels.every((l) => isObj(l) && typeof l.id === 'string')
    )
      throw fail('Arquivo corrompido: o projeto não tem níveis (pavimentos) válidos.')
    if (!Array.isArray(p.plans) || !p.plans.every((pl) => isObj(pl) && Array.isArray(pl.beams)))
      throw fail('Arquivo corrompido: plantas inválidas.')
    if (!Array.isArray(p.columns) || !p.columns.every(isObj))
      throw fail('Arquivo corrompido: pilares inválidos.')
  }
  try {
    return parseProject(text)
  } catch (err) {
    if (err instanceof ProjectParseError) throw fail(err.message)
    throw fail('O arquivo não é um projeto HyperFrame válido.')
  }
}
