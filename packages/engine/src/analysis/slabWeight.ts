import type { Slab } from '../model/types'
import { oneWaySpanStats } from '../geometry/slabEdges'
import { bracingSelfWeight } from '../nbr/nbr6118/latticeSlab'
import { ribbedSelfWeight } from '../nbr/nbr6118/ribbedSlab'

/** vão de cálculo das vigotas de uma laje treliçada: MAIOR corda no sentido das vigotas, m */
export function latticeDesignSpan(slab: Slab): number {
  if (!slab.ribbed?.lattice) return 0
  return oneWaySpanStats(slab.polygon, slab.ribbed.dirs === 'y' ? 'y' : 'x').max
}

/**
 * Peso próprio da laje, kN/m² — maciça, nervurada ou treliçada (com as
 * nervuras de travamento). Mesma função na análise global e no
 * dimensionamento, p/ as reações baterem com as cargas aplicadas às vigas.
 */
export function slabSelfWeight(slab: Slab, gammaC: number): number {
  if (!slab.ribbed) return slab.thickness * gammaC
  const g0 = ribbedSelfWeight(slab.thickness, slab.ribbed, gammaC)
  if (!slab.ribbed.lattice) return g0
  return (
    g0 +
    bracingSelfWeight(slab.ribbed.lattice, latticeDesignSpan(slab), gammaC, slab.ribbed.fillerWeight)
  )
}
