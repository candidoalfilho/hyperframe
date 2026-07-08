import type { Project } from '../model/types'

const MAGIC = 'hyperframe'

export interface ProjectFile {
  magic: typeof MAGIC
  schemaVersion: 1
  savedWith: string
  project: Project
}

export function serializeProject(project: Project): string {
  const file: ProjectFile = {
    magic: MAGIC,
    schemaVersion: 1,
    savedWith: 'HyperFrame 0.1.0',
    project,
  }
  return JSON.stringify(file, null, 2)
}

export class ProjectParseError extends Error {}

export function parseProject(text: string): Project {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new ProjectParseError('Arquivo inválido: não é um JSON válido.')
  }
  const file = raw as Partial<ProjectFile>
  if (file.magic !== MAGIC || !file.project) {
    throw new ProjectParseError('Arquivo inválido: não é um projeto HyperFrame.')
  }
  if (file.schemaVersion !== 1) {
    throw new ProjectParseError(
      `Versão de arquivo não suportada (${String(file.schemaVersion)}).`,
    )
  }
  const p = file.project
  if (!Array.isArray(p.levels) || !Array.isArray(p.plans) || !Array.isArray(p.columns)) {
    throw new ProjectParseError('Arquivo corrompido: estrutura de projeto incompleta.')
  }
  return p
}
