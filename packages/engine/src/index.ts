// HyperFrame engine — núcleo de cálculo puro (sem dependências de UI)

export * from './model/types'
export * from './model/presets'
export * from './model/factory'
export * from './model/naming'
export { uid } from './model/uid'

export * from './geometry/geometry'
export { detectFaces } from './geometry/faces'
export { clipHalfPlane, clipPolygon, overlapArea, areaCentroid } from './geometry/clip'
export * from './drawing/types'

export * from './analysis/types'
export { buildAnalysisModel } from './analysis/buildModel'
export { analyze, comboDisplacements, comboDiagrams, comboReactions } from './analyze'

export * from './nbr/api'
export { concreteProps, coverFor, fyd } from './nbr/nbr6118/materials'
export { designBeamFlexure, designBeamShear, pickBars } from './nbr/nbr6118/beamDesign'
export { gammaZ, alphaParam } from './nbr/nbr6118/stability'
export { computeWind, dragCoefficient, s2Factor, s3Factor } from './nbr/nbr6123/wind'
export { generateCombos } from './nbr/nbr8681/combinations'
export {
  designColumnSection,
  interactionCurve,
  radialUtilization,
  placeBars,
  slenderness,
  minimumMoment,
  squashLoad,
  type ColumnSectionDef,
  type ColumnDemandPoint,
  type BarArrangement,
} from './nbr/nbr6118/columnDesign'
export {
  designSlab,
  pickSlabBars,
  type SlabDesignInput,
  type SlabDesignOutput,
  type SlabDirectionResult,
  type EdgeCondition,
} from './nbr/nbr6118/slabDesign'
export {
  crackingMoment,
  crackedInertia,
  bransonInertia,
  creepFactor,
} from './nbr/nbr6118/deflections'
export { designFooting, type FootingInput, type FootingResult } from './nbr/nbr6118/foundations'
export { fbd, basicAnchorage, requiredAnchorage } from './nbr/nbr6118/anchorage'

export { slabExtraLoads } from './analysis/buildModel'

export { parseDxf } from './dxf/parse'
export { writeDxf } from './dxf/write'

export { buildFormworkDrawing } from './drawing/formwork'
export { buildBeamDetailDrawing } from './drawing/beamDetail'
export { buildColumnDetailDrawing } from './drawing/columnDetail'

export { serializeProject, parseProject, normalizeProject, ProjectParseError } from './io/serialize'
