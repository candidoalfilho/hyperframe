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
    savedWith: 'HyperFrame 0.2.5',
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
  return normalizeProject(p)
}

/** preenche campos introduzidos após o schema 1 original (compatibilidade) */
export function normalizeProject(p: Project): Project {
  for (const plan of p.plans) {
    if (!Array.isArray(plan.loadRegions)) plan.loadRegions = []
    for (const beam of plan.beams) {
      if (beam.openings !== undefined && !Array.isArray(beam.openings)) beam.openings = []
      if (beam.segmentSections !== undefined && !Array.isArray(beam.segmentSections)) {
        beam.segmentSections = undefined
      }
    }
  }
  for (const col of p.columns) {
    // rotações antigas: 0 | 90; seções sem `shape` = retangulares (compat)
    if (col.rotationDeg !== 0 && col.rotationDeg !== 90 && col.rotationDeg !== 180 && col.rotationDeg !== 270) {
      col.rotationDeg = 0
    }
  }
  if (!p.settings.soil) {
    p.settings.soil = { sigmaAdm: 250, label: 'Argila rija' }
  }
  if (!p.settings.soilInteraction) {
    p.settings.soilInteraction = {
      enabled: false,
      layers: [
        { thickness: 3, soil: 'argila-arenosa', nspt: 8, label: 'Argila arenosa média' },
        { thickness: 5, soil: 'areia', nspt: 20, label: 'Areia medianamente compacta' },
      ],
      waterDepth: null,
      chFactor: 0.5,
      poisson: 0.3,
    }
  }
  if (!p.settings.costs) {
    p.settings.costs = { enabled: true, concretePerM3: 750, steelPerKg: 9.5, formworkPerM2: 130 }
  }
  if (!p.settings.foundation) {
    p.settings.foundation = {
      type: 'sapata',
      pileCapacity: 600,
      pileDiameter: 0.4,
      pileSpacingFactor: 3,
      pileLabel: 'Hélice contínua φ40',
    }
  }
  if (!p.settings.fire) {
    p.settings.fire = { enabled: true, trrf: 'auto', occupancy: 'A' }
  }
  if (p.settings.notionalImperfections === undefined) p.settings.notionalImperfections = true
  if (p.settings.secondOrderGammaZ === undefined) p.settings.secondOrderGammaZ = true
  if (p.settings.slabMethod === undefined) p.settings.slabMethod = 'marcus'
  if (p.underlay === undefined) p.underlay = null
  return p
}
