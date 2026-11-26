/**
 * Verificação da armadura ADOTADA (issue #12) — do programa ou editada pelo
 * engenheiro. Não é comparação de áreas: refaz as contas com as barras e os
 * estribos que estão no detalhamento.
 *
 * Vigas: momento resistente com a altura útil real (camadas), As mínima,
 * dutilidade, barras que cabem na largura, comprimento de corte, estribos por
 * trecho (VRd3 ≥ Vd do trecho, passo e bitola máximos/mínimos, ramos) e
 * fissuração. Pilares: curva de interação com o arranjo adotado, taxas
 * mínima/máxima, bitolas e estribos.
 *
 * Unidades: m, kN, kN·m, kPa.
 */

import type {
  BeamDetailSpan,
  BeamRebarCheck,
  BeamServiceResult,
  BeamSpanDesign,
  ColumnDesignResult,
  ColumnDetailInfo,
  ColumnRebarCheck,
  RebarCheckItem,
} from '../analysis/types'
import type { CAA } from '../model/types'
import { crackLimit, crackWidth } from '../nbr/nbr6118/cracking'
import { evaluateArrangement, placeBars } from '../nbr/nbr6118/columnDesign'

const f = (v: number, d = 1): string => (Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '—')
const cm2 = (a: number): string => f(a * 1e4, 2)
const mmTxt = (phi: number): string => String(Math.round(phi * 10000) / 10).replace('.', ',')
const areaOf = (phi: number): number => (Math.PI * phi * phi) / 4

/**
 * Barras em camadas dentro da largura da viga (§18.3.2.2 — espaçamento livre
 * horizontal e vertical ≥ max(20 mm, φ), a mesma regra da escolha automática).
 * `yBar` = distância do centro de gravidade das barras à face tracionada.
 */
export function barLayers(
  n: number,
  phi: number,
  bw: number,
  cover: number,
  phiT: number,
): { perLayer: number; layers: number; yBar: number } {
  const gap = Math.max(0.02, phi)
  const usable = bw - 2 * cover - 2 * phiT
  const perLayer = Math.max(1, Math.floor((usable + gap + 1e-9) / (phi + gap)))
  const layers = Math.max(1, Math.ceil(n / perLayer))
  // camada k (0 = a mais externa) fica k·(φ + gap) para dentro
  let moment = 0
  let left = n
  for (let k = 0; k < layers; k++) {
    const nk = Math.min(perLayer, left)
    moment += nk * k * (phi + gap)
    left -= nk
  }
  return { perLayer, layers, yBar: cover + phiT + phi / 2 + (n > 0 ? moment / n : 0) }
}

/**
 * Momento resistente de cálculo com a armadura dada (bloco retangular,
 * §17.2.2). Com mesa colaborante (positivo), a compressão usa bf até hf e a
 * alma abaixo. x/d > 0,45 ⇒ sem dutilidade: MRd é limitado ao de x = 0,45·d.
 */
export function flexureCapacity(inp: {
  as: number
  d: number
  bw: number
  fcd: number
  fyd: number
  flange?: { bf: number; hf: number }
}): { mrd: number; xd: number; ductile: boolean } {
  const { as, d, bw, fcd, fyd } = inp
  if (as <= 0 || d <= 0) return { mrd: 0, xd: 0, ductile: true }
  const sc = 0.85 * fcd
  const fs = as * fyd
  const bf = inp.flange && inp.flange.bf > bw ? inp.flange.bf : bw
  const hf = inp.flange && inp.flange.bf > bw ? inp.flange.hf : Infinity
  /** resultante de compressão e o seu momento em relação à armadura, bloco de altura a */
  const block = (a: number): { c: number; m: number } => {
    if (a <= hf) return { c: sc * bf * a, m: sc * bf * a * (d - a / 2) }
    return {
      c: sc * ((bf - bw) * hf + bw * a),
      m: sc * ((bf - bw) * hf * (d - hf / 2) + bw * a * (d - a / 2)),
    }
  }
  // altura do bloco que equilibra a tração da armadura
  let a = fs / (sc * bf)
  if (a > hf) a = (fs - sc * (bf - bw) * hf) / (sc * bw)
  const xd = a / 0.8 / d
  if (xd <= 0.45 + 1e-9) return { mrd: block(a).m, xd, ductile: true }
  // armadura além do que a seção aproveita com dutilidade (§14.6.4.3)
  return { mrd: block(0.8 * 0.45 * d).m, xd, ductile: false }
}

/** passo máximo dos estribos (§18.3.3.2) para o cortante do trecho */
export function stirrupMaxSpacing(vd: number, vrd2: number, d: number): number {
  return vd <= 0.67 * vrd2 ? Math.min(0.6 * d, 0.3) : Math.min(0.3 * d, 0.2)
}

/** Asw/s necessário no trecho (modelo I): cortante (≥ mínimo) + torção, m²/m */
export function stirrupRequired(
  vd: number,
  vc: number,
  d: number,
  fywd: number,
  aswSMin: number,
  torsionA90S: number,
): { shear: number; torsion: number } {
  return {
    shear: Math.max(aswSMin, Math.max(0, vd - vc) / (0.9 * d * fywd)),
    torsion: 2 * torsionA90S,
  }
}

const worst = (items: RebarCheckItem[]): 'ok' | 'atencao' | 'falha' =>
  items.some((i) => !i.ok && (i.severity ?? 'falha') === 'falha')
    ? 'falha'
    : items.some((i) => !i.ok)
      ? 'atencao'
      : 'ok'

export interface BeamCheckContext {
  cover: number
  fcd: number
  fyd: number
  /** fywd já limitado a 435 MPa */
  fywd: number
  fctm: number
  /** Es/Ecs e Es — fissuração */
  alphaE: number
  es: number
  caa: CAA
}

/** verifica o vão de viga com a armadura do detalhamento */
export function checkBeamSpan(
  design: BeamSpanDesign,
  detail: BeamDetailSpan,
  service: BeamServiceResult | undefined,
  ctx: BeamCheckContext,
): BeamRebarCheck {
  const { bw, h } = design.section
  const phiT = detail.stirrup.phi
  const items: RebarCheckItem[] = []

  const flexure = (
    id: string,
    label: string,
    fd: BeamSpanDesign['positive'] | null,
    n: number,
    phi: number,
    length: number,
    lengthAuto: number | undefined,
    useFlange: boolean,
  ): { d: number } | null => {
    if (!fd || n <= 0 || phi <= 0) return null
    const as = n * areaOf(phi)
    const lay = barLayers(n, phi, bw, ctx.cover, phiT)
    const d = h - lay.yBar
    // barras que cabem: até 2 camadas é usual; 3 pede atenção; mais não cabe
    const fits = lay.layers <= 3 && (lay.perLayer >= 2 || n === 1)
    items.push({
      id: `${id}-fit`,
      label: `${label}: barras na largura`,
      ok: lay.layers <= 2 && fits,
      severity: fits ? 'atencao' : 'falha',
      detail:
        lay.layers === 1
          ? `${n} φ ${mmTxt(phi)} em 1 camada (cabem ${lay.perLayer} por camada em ${f(bw * 100, 0)} cm)`
          : `${n} φ ${mmTxt(phi)} em ${lay.layers} camadas (${lay.perLayer} por camada) — d cai para ${f(d * 100, 1)} cm${fits ? '' : ' — não cabe: aumente a bitola ou a seção'}`,
    })
    items.push({
      id: `${id}-min`,
      label: `${label}: armadura mínima`,
      ok: as + 1e-9 >= fd.asMin,
      detail: `As,ef = ${cm2(as)} ${as + 1e-9 >= fd.asMin ? '≥' : '<'} As,mín = ${cm2(fd.asMin)} cm²`,
    })
    if (fd.md >= 0.1) {
      const cap = flexureCapacity({
        as,
        d,
        bw,
        fcd: ctx.fcd,
        fyd: ctx.fyd,
        flange: useFlange ? fd.flange : undefined,
      })
      // 0,5% de tolerância: a altura útil do dimensionamento é nominal (φ16)
      const ok = cap.mrd >= fd.md * 0.995
      items.push({
        id: `${id}-mrd`,
        label: `${label}: momento resistente`,
        ok,
        detail: `MRd = ${f(cap.mrd, 1)} ${ok ? '≥' : '<'} Md = ${f(fd.md, 1)} kN·m (d = ${f(d * 100, 1)} cm, x/d = ${f(cap.xd, 3)})`,
      })
      if (!cap.ductile) {
        items.push({
          id: `${id}-xd`,
          label: `${label}: dutilidade`,
          ok: false,
          detail: `x/d = ${f(cap.xd, 3)} > 0,45 (§14.6.4.3) — armadura além do que a seção aproveita; aumente a seção`,
        })
      }
    }
    if (lengthAuto !== undefined && length + 0.025 < lengthAuto) {
      items.push({
        id: `${id}-len`,
        label: `${label}: comprimento de corte`,
        ok: false,
        detail: `C = ${f(length * 100, 0)} cm < ${f(lengthAuto * 100, 0)} cm necessários (cobertura do diagrama decalado + ancoragem, §18.3.2.4 / §9.4)`,
      })
    }
    return { d }
  }

  const pos = flexure(
    'pos',
    'Positivo',
    design.positive,
    detail.positive.n,
    detail.positive.phi,
    detail.positive.length,
    detail.positive.lengthAuto,
    true,
  )
  const negTotal = (nb: BeamDetailSpan['negLeft']) => (nb ? nb.n + (nb.cut?.n ?? 0) : 0)
  if (detail.negLeft)
    flexure(
      'negL',
      'Negativo esquerdo',
      design.negLeft,
      negTotal(detail.negLeft),
      detail.negLeft.phi,
      detail.negLeft.length,
      detail.negLeft.lengthAuto,
      false,
    )
  else if (design.negLeft && design.negLeft.md >= 0.1)
    items.push({
      id: 'negL-none',
      label: 'Negativo esquerdo',
      ok: false,
      detail: `sem armadura para Md = ${f(design.negLeft.md, 1)} kN·m`,
    })
  if (detail.negRight)
    flexure(
      'negR',
      'Negativo direito',
      design.negRight,
      negTotal(detail.negRight),
      detail.negRight.phi,
      detail.negRight.length,
      detail.negRight.lengthAuto,
      false,
    )
  else if (design.negRight && design.negRight.md >= 0.1)
    items.push({
      id: 'negR-none',
      label: 'Negativo direito',
      ok: false,
      detail: `sem armadura para Md = ${f(design.negRight.md, 1)} kN·m`,
    })

  // ------------------------------------------------------------- estribos
  const sh = design.shear
  const d = pos?.d ?? Math.max(h - ctx.cover - phiT - 0.008, 0.5 * h)
  const legs = detail.stirrup.legs ?? 2
  const aPhi = areaOf(phiT)
  items.push({
    id: 'st-phi',
    label: 'Estribo: bitola',
    ok: phiT >= 0.005 - 1e-9 && phiT <= bw / 10 + 1e-9,
    detail: `φt = ${mmTxt(phiT)} mm — entre 5 mm e bw/10 = ${f(bw * 100, 1)} mm (§18.3.3.2)`,
  })
  items.push({
    id: 'st-vrd2',
    label: 'Biela comprimida',
    ok: sh.vd <= sh.vrd2 + 1e-9,
    detail: `Vd = ${f(sh.vd, 1)} ${sh.vd <= sh.vrd2 + 1e-9 ? '≤' : '>'} VRd2 = ${f(sh.vrd2, 1)} kN`,
  })
  const zones = detail.stirrup.zones ?? [
    { length: design.length, spacing: detail.stirrup.spacing, count: detail.stirrup.count },
  ]
  const tor = design.torsion.negligible ? 0 : design.torsion.a90S
  let x0 = 0
  zones.forEach((z, i) => {
    const x1 = x0 + z.length
    // maior |V| da envoltória dentro do trecho (sem a envoltória: o do vão)
    let vz = 0
    if (design.shearEnv && design.shearEnv.x.length > 1) {
      const { x, v } = design.shearEnv
      for (let k = 0; k < x.length; k++) {
        if (x[k] >= x0 - 1e-6 && x[k] <= x1 + 1e-6) vz = Math.max(vz, v[k])
      }
      // extremos do trecho por interpolação (o trecho pode começar entre estações)
      for (const xe of [x0, x1]) {
        for (let k = 0; k + 1 < x.length; k++) {
          if (xe >= x[k] && xe <= x[k + 1] && x[k + 1] > x[k]) {
            vz = Math.max(vz, v[k] + ((v[k + 1] - v[k]) * (xe - x[k])) / (x[k + 1] - x[k]))
          }
        }
      }
    } else vz = sh.vd
    const req = stirrupRequired(vz, sh.vc, d, ctx.fywd, sh.aswSMin, tor)
    const all = (legs * aPhi) / z.spacing
    const outer = (2 * aPhi) / z.spacing
    const vrd3 = sh.vc + Math.max(0, all - req.torsion) * 0.9 * d * ctx.fywd
    const name =
      zones.length === 1
        ? 'Estribos'
        : `Estribos — trecho ${i + 1} (${f(x0, 2)}–${f(x1, 2)} m)`
    const okArea = all + 1e-9 >= req.shear + req.torsion && outer + 1e-9 >= req.torsion
    items.push({
      id: `st-area-${i}`,
      label: `${name}: resistência`,
      ok: okArea,
      detail:
        `φ${mmTxt(phiT)} c/ ${f(z.spacing * 100, 0)}${legs !== 2 ? ` (${legs} ramos)` : ''}: Asw/s = ${f(all * 1e4, 2)} ${okArea ? '≥' : '<'} ${f((req.shear + req.torsion) * 1e4, 2)} cm²/m` +
        ` — VRd3 = ${f(vrd3, 1)} kN, Vd no trecho = ${f(vz, 1)} kN` +
        (req.torsion > 0 ? ` (inclui ${f(req.torsion * 1e4, 2)} cm²/m de torção, nos ramos externos)` : ''),
    })
    const sMax = stirrupMaxSpacing(vz, sh.vrd2, d)
    items.push({
      id: `st-smax-${i}`,
      label: `${name}: passo máximo`,
      ok: z.spacing <= sMax + 1e-9,
      detail: `s = ${f(z.spacing * 100, 0)} ${z.spacing <= sMax + 1e-9 ? '≤' : '>'} s,máx = ${f(sMax * 100, 0)} cm (§18.3.3.2)`,
    })
    x0 = x1
  })
  // distância transversal entre ramos (§18.3.3.2): d ≤ 80 cm se Vd ≤ 0,2·VRd2; senão 0,6·d ≤ 35 cm
  const stMax = sh.vd <= 0.2 * sh.vrd2 ? Math.min(d, 0.8) : Math.min(0.6 * d, 0.35)
  const between = (bw - 2 * ctx.cover - phiT) / Math.max(legs - 1, 1)
  items.push({
    id: 'st-legs',
    label: 'Estribo: distância entre ramos',
    ok: between <= stMax + 1e-9,
    severity: 'atencao',
    detail: `${legs} ramos a cada ${f(between * 100, 0)} cm ${between <= stMax + 1e-9 ? '≤' : '>'} ${f(stMax * 100, 0)} cm${between <= stMax + 1e-9 ? '' : ' — use mais ramos'}`,
  })

  // ----------------------------------------------------------- fissuração
  if (service?.crack && pos) {
    const cw = crackWidth({
      ms: service.crack.mFreq,
      bw,
      h,
      d: pos.d,
      as: detail.positive.n * areaOf(detail.positive.phi),
      phi: detail.positive.phi,
      alphaE: ctx.alphaE,
      es: ctx.es,
      fctm: ctx.fctm,
    })
    const lim = crackLimit(ctx.caa)
    items.push({
      id: 'crack',
      label: 'Fissuração (ELS-W)',
      ok: cw.wk <= lim + 1e-12,
      severity: 'atencao',
      detail: `wk = ${f(cw.wk * 1000, 2)} ${cw.wk <= lim + 1e-12 ? '≤' : '>'} ${f(lim * 1000, 2)} mm (σs = ${f(cw.sigmaS / 1000, 0)} MPa, combinação frequente)`,
    })
  }

  const manual =
    !!detail.positive.manual || !!detail.negLeft?.manual || !!detail.negRight?.manual || !!detail.stirrup.manual
  return {
    beamId: design.beamId,
    beamName: design.beamName,
    spanIndex: design.spanIndex,
    manual,
    items,
    status: worst(items),
  }
}

/** verifica o pilar com o arranjo do detalhamento */
export function checkColumn(design: ColumnDesignResult, detail: ColumnDetailInfo): ColumnRebarCheck {
  const items: RebarCheckItem[] = []
  const ck = design.check
  const n = detail.barsN
  const phi = detail.barsPhi
  const as = n * areaOf(phi)
  if (ck) {
    const sec = ck.sec
    const ac = sec.ac ?? sec.bw * sec.h
    const minDim = sec.minDim ?? Math.min(sec.bw, sec.h)
    const positions = placeBars(sec, n, phi)
    items.push({
      id: 'fit',
      label: 'Barras na seção',
      ok: positions !== null,
      detail: positions
        ? `${n} φ ${mmTxt(phi)} cabem com o espaçamento livre mínimo`
        : `${n} φ ${mmTxt(phi)} não cabem (espaçamento livre < max(2 cm; φ; 1,2·dmáx) ou quantidade incompatível com a forma da seção)`,
    })
    if (positions) {
      const ev = evaluateArrangement(sec, { n, phi, positions, as, spec: '' }, ck.demands)
      const ok = ev.feasible && ev.utilization <= 1.0001
      items.push({
        id: 'capacity',
        label: 'Flexo-compressão oblíqua',
        ok,
        detail: ev.feasible
          ? `aproveitamento ${f(ev.utilization * 100, 0)}% ${ok ? '≤' : '>'} 100% — ${ev.governing}`
          : `força normal fora da capacidade da seção — ${ev.governing}`,
      })
    }
    items.push({
      id: 'rho-min',
      label: 'Armadura mínima',
      ok: as + 1e-9 >= ck.asMin,
      detail: `As = ${cm2(as)} ${as + 1e-9 >= ck.asMin ? '≥' : '<'} As,mín = ${cm2(ck.asMin)} cm² (0,15·Nd/fyd ≥ 0,4%·Ac, §17.3.5.3.1)`,
    })
    items.push({
      id: 'rho-max',
      label: 'Armadura máxima',
      ok: as <= 0.04 * ac + 1e-9,
      detail: `ρ = ${f((as / ac) * 100, 2)}% ${as <= 0.04 * ac + 1e-9 ? '≤' : '>'} 4% fora das emendas (8% na região de traspasse, §17.3.5.3.2)`,
    })
    items.push({
      id: 'phi',
      label: 'Bitola longitudinal',
      ok: phi >= 0.01 - 1e-9 && phi <= minDim / 8 + 1e-9,
      detail: `φ = ${mmTxt(phi)} mm — entre 10 mm e 1/8 da menor dimensão = ${f((minDim / 8) * 1000, 1)} mm (§18.4.2.1)`,
    })
    const phiTMin = Math.max(0.005, phi / 4)
    items.push({
      id: 'st-phi',
      label: 'Estribo: bitola',
      ok: detail.stirrupPhi + 1e-9 >= phiTMin,
      detail: `φt = ${mmTxt(detail.stirrupPhi)} ${detail.stirrupPhi + 1e-9 >= phiTMin ? '≥' : '<'} max(5 mm; φ/4) = ${mmTxt(phiTMin)} mm (§18.4.3)`,
    })
    const sMax = Math.min(0.2, minDim, 12 * phi)
    items.push({
      id: 'st-s',
      label: 'Estribo: passo',
      ok: detail.stirrupSpacing <= sMax + 1e-9,
      detail: `s = ${f(detail.stirrupSpacing * 100, 0)} ${detail.stirrupSpacing <= sMax + 1e-9 ? '≤' : '>'} min(20 cm; menor dimensão; 12φ) = ${f(sMax * 100, 0)} cm (§18.4.3)`,
    })
    if (detail.jointSpacing !== undefined && detail.jointLength !== undefined) {
      items.push({
        id: 'st-joint',
        label: 'Estribo: trecho junto aos nós',
        ok: detail.jointSpacing <= detail.stirrupSpacing + 1e-9,
        severity: 'atencao',
        detail: `c/ ${f(detail.jointSpacing * 100, 0)} em ${f(detail.jointLength * 100, 0)} cm acima e abaixo de cada pavimento (passo corrente c/ ${f(detail.stirrupSpacing * 100, 0)})`,
      })
    }
  }
  return {
    columnId: design.columnId,
    name: design.name,
    manual: !!detail.manual,
    items,
    status: worst(items),
  }
}
