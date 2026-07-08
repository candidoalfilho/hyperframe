// HyperFrame engine — núcleo de cálculo puro (sem dependências de UI)

export * from './model/types'
export * from './model/presets'
export * from './model/factory'
export * from './model/naming'
export { uid } from './model/uid'

export * from './geometry/geometry'
export { detectFaces } from './geometry/faces'

export * from './analysis/types'
export { buildAnalysisModel } from './analysis/buildModel'
export { analyze, comboDisplacements, comboDiagrams, comboReactions } from './analyze'

export * from './nbr/api'
export { concreteProps, coverFor, fyd } from './nbr/nbr6118/materials'
export { designBeamFlexure, designBeamShear, pickBars } from './nbr/nbr6118/beamDesign'
export { gammaZ, alphaParam } from './nbr/nbr6118/stability'
export { computeWind, dragCoefficient, s2Factor, s3Factor } from './nbr/nbr6123/wind'
export { generateCombos } from './nbr/nbr8681/combinations'

export { serializeProject, parseProject, ProjectParseError } from './io/serialize'
