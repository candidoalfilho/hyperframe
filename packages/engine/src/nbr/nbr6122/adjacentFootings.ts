/**
 * NBR 6122 §7.7 — fundações vizinhas assentes em COTAS DIFERENTES (terreno em
 * aclive/declive): a reta de maior declive que passa pelos bordos das duas
 * fundações deve fazer com a VERTICAL um ângulo α mínimo:
 *   · solos pouco resistentes: α ≥ 60°
 *   · solos resistentes:       α ≥ 45°
 *   · rochas:                  α ≥ 30°
 * ⇒ afastamento horizontal entre bordos a ≥ Δh·tan(α). A fundação situada em
 * cota mais baixa deve ser executada em primeiro lugar.
 */

export type SoilResistanceClass = 'pouco-resistente' | 'resistente' | 'rocha'

/** ângulo mínimo com a vertical, graus (NBR 6122 §7.7) */
export const MIN_ALPHA_DEG: Record<SoilResistanceClass, number> = {
  'pouco-resistente': 60,
  resistente: 45,
  rocha: 30,
}

/** classe p/ o §7.7 estimada da tensão admissível (orientativo; sondagem manda):
 *  σadm < 150 kPa → pouco resistente; ≥ 150 → resistente; ≥ 600 → rocha. */
export function soilClassFromSigma(sigmaAdmKPa: number): SoilResistanceClass {
  if (sigmaAdmKPa >= 600) return 'rocha'
  if (sigmaAdmKPa >= 150) return 'resistente'
  return 'pouco-resistente'
}

export interface FootingFootprint {
  columnId: string
  name: string
  /** centro da fundação em planta (já com offset), m */
  x: number
  y: number
  /** dimensões em planta a (x global? não — a alinhada c/ h do pilar). Para o
   *  check usamos o RETÂNGULO ENVOLVENTE alinhado aos eixos globais. */
  dimX: number
  dimY: number
  /** cota de assentamento (elevação absoluta da base), m */
  cota: number
}

export interface AdjacentFootingIssue {
  aId: string
  aName: string
  bId: string
  bName: string
  /** desnível entre cotas de assentamento, m */
  deltaH: number
  /** afastamento horizontal entre bordos, m */
  gap: number
  /** afastamento mínimo exigido a ≥ Δh·tan(α), m */
  required: number
  ok: boolean
  /** qual executa primeiro (a mais profunda) */
  deeperName: string
}

/** distância horizontal entre bordos de dois retângulos alinhados aos eixos */
function edgeGap(a: FootingFootprint, b: FootingFootprint): number {
  const gx = Math.abs(a.x - b.x) - (a.dimX + b.dimX) / 2
  const gy = Math.abs(a.y - b.y) - (a.dimY + b.dimY) / 2
  if (gx <= 0 && gy <= 0) return 0 // sobrepostos em planta
  return Math.hypot(Math.max(gx, 0), Math.max(gy, 0))
}

/**
 * Verifica todos os pares de sapatas com desnível de assentamento ≥ 5 cm.
 * Só reporta pares "próximos" (bordos a menos de 3·Δh·tan α — além disso o
 * bulbo não interfere de forma relevante).
 */
export function checkAdjacentFootings(
  footings: FootingFootprint[],
  soil: SoilResistanceClass,
): AdjacentFootingIssue[] {
  const tanA = Math.tan((MIN_ALPHA_DEG[soil] * Math.PI) / 180)
  const out: AdjacentFootingIssue[] = []
  for (let i = 0; i < footings.length; i++) {
    for (let j = i + 1; j < footings.length; j++) {
      const A = footings[i]
      const B = footings[j]
      const deltaH = Math.abs(A.cota - B.cota)
      if (deltaH < 0.05) continue
      const gap = edgeGap(A, B)
      const required = deltaH * tanA
      if (gap > 3 * required) continue // longe demais p/ interessar
      const deeper = A.cota < B.cota ? A : B
      out.push({
        aId: A.columnId,
        aName: A.name,
        bId: B.columnId,
        bName: B.name,
        deltaH,
        gap,
        required,
        ok: gap >= required - 1e-9,
        deeperName: deeper.name,
      })
    }
  }
  return out.sort((a, b) => Number(a.ok) - Number(b.ok) || b.deltaH - a.deltaH)
}
