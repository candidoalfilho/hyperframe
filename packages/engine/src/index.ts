// HyperFrame engine — núcleo de cálculo puro (sem dependências de UI)

export * from './model/types'
export * from './model/presets'
export * from './model/factory'
export * from './model/naming'
export { uid } from './model/uid'
export {
  columnSectionInfo,
  columnSectionLabel,
  columnFootprint,
  columnHalfExtents,
  columnWorldDirs,
  insetRectilinear,
  polygonSectionProps,
  type ColumnSectionInfo,
} from './model/columnSection'
export { checkConsistency, type ConsistencyIssue, type IssueSeverity } from './model/consistency'

export * from './geometry/geometry'
export { detectFaces } from './geometry/faces'
export { clipHalfPlane, clipPolygon, overlapArea, areaCentroid } from './geometry/clip'
export * from './drawing/types'

export * from './analysis/types'
export { buildAnalysisModel } from './analysis/buildModel'
export {
  analyzeSlabGrid,
  buildGridMesh,
  solveGrid,
  type GridModel,
  type GridResult,
  type SlabGridInput,
  type SlabGridOutput,
} from './analysis/grid'
export { analyze, comboDisplacements, comboDiagrams, comboReactions } from './analyze'

export * from './nbr/api'
export { concreteProps, coverFor, fyd } from './nbr/nbr6118/materials'
export {
  designBeamFlexure,
  designBeamShear,
  designBeamTorsion,
  pickBars,
  skinReinforcement,
  type BeamTorsionInput,
  type BeamTorsionOutput,
} from './nbr/nbr6118/beamDesign'
export { gammaZ, alphaParam } from './nbr/nbr6118/stability'
export {
  notionalLoads,
  windNotionalRule,
  type NotionalLoadsResult,
} from './nbr/nbr6118/imperfections'
export {
  crackWidth,
  crackLimit,
  stadium2NeutralAxis,
  type CrackWidthInput,
  type CrackWidthOutput,
} from './nbr/nbr6118/cracking'
export { designStair, type StairDesignInput, type StairDesignOutput } from './nbr/nbr6118/stairs'
export {
  designTank,
  type TankDesignInput,
  type TankDesignOutput,
  type TankWallResult,
} from './nbr/nbr6118/tanks'
export {
  designPileCap,
  type PileCapInput,
  type PileCapResult,
} from './nbr/nbr6118/pileCaps'
export {
  requiredTRRF,
  checkBeamFire,
  checkSlabFire,
  checkColumnFire,
  type FireBeamCheck,
  type FireSlabCheck,
  type FireColumnInput,
  type FireColumnCheck,
} from './nbr/nbr15200/fire'
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
export {
  checkBeamOpening,
  type OpeningCheckInput,
  type OpeningCheckOutput,
  type OpeningCondition,
} from './nbr/nbr6118/beamOpenings'
export {
  designRibbedSlab,
  ribbedGeometry,
  ribbedSelfWeight,
  ribFraction,
  slabShearVrd1,
  pickRibBars,
  type RibbedDesignInput,
  type RibbedDesignOutput,
  type RibbedDirectionResult,
  type RibbedGeometryInfo,
} from './nbr/nbr6118/ribbedSlab'
export { checkPunching, type PunchingInput, type PunchingOutput } from './nbr/nbr6118/punching'
export { designCaisson, type CaissonInput, type CaissonResult } from './nbr/nbr6122/caisson'
export {
  soilModulus,
  averageModulus,
  pileCapacityAokiVelloso,
  footingSprings,
  pileCapSprings,
  pileLayout,
  boringDepth,
  type FoundationSprings,
  type PileCapacityResult,
} from './geotech/soil'

export {
  slabExtraLoads,
  slabOpeningsArea,
  slabOpeningPolygons,
  regionOpensSlab,
} from './analysis/buildModel'

export { parseDxf } from './dxf/parse'
export { writeDxf } from './dxf/write'

export { buildMemorialPdf, type MemorialOptions } from './report/memorial'
export { PdfDoc, encodePdfText, textWidth, wrapText, transliterate, A4 } from './report/pdf'

export { buildFormworkDrawing } from './drawing/formwork'
export { buildBeamDetailDrawing } from './drawing/beamDetail'
export { buildColumnDetailDrawing } from './drawing/columnDetail'
export { buildSectionCutDrawing, type SectionCutOptions } from './drawing/sectionCut'
export { buildLoadPlanDrawing } from './drawing/loadPlan'
export {
  composeSheet,
  type SheetFormat,
  type SheetInfo,
  type SheetOptions,
  type SheetResult,
} from './drawing/sheet'

export { serializeProject, parseProject, normalizeProject, ProjectParseError } from './io/serialize'
