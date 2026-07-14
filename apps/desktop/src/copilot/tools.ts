import Anthropic from '@anthropic-ai/sdk'
import {
  checkConsistency,
  columnSectionLabel,
  dist,
  nextBeamName,
  nextColumnName,
  nextSlabName,
  uid,
  type Beam,
  type Column,
  type ColumnSection,
  type ElementKind,
  type Project,
  type Slab,
  type Vec2,
} from '@hyperframe/engine'
import { useStore } from '../store'

/**
 * Ferramentas do Copiloto: leitura (executam direto) e mutação (exigem
 * aprovação manual do usuário; desabilitadas no modo planejamento).
 * O executor roda sobre as ações do store — toda mutação passa pelo mesmo
 * caminho da UI (invalida resultados, entra no undo/redo).
 */

export const READ_TOOLS = new Set([
  'obter_resumo_projeto',
  'listar_elementos',
  'verificar_consistencia',
  'obter_resultados',
  'rodar_analise',
])

export function isMutatingTool(name: string): boolean {
  return !READ_TOOLS.has(name)
}

export const COPILOT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'obter_resumo_projeto',
    description:
      'Resumo do projeto atual: níveis, plantas, contagem de elementos, materiais, fundação, vento e status da análise. Chame antes de qualquer outra coisa para se situar.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'listar_elementos',
    description:
      'Lista os elementos de uma planta (vigas, lajes, cargas, regiões) e os pilares do edifício, com geometria (m) e seções (m). Use planName para escolher a planta; omita para a primeira.',
    input_schema: {
      type: 'object',
      properties: {
        planName: { type: 'string', description: 'Nome da planta (ex.: "Pavimento Tipo")' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'verificar_consistencia',
    description:
      'Roda a verificação de consistência do modelo (graves/médias/leves) — pilares soltos, vigas sem apoio, lajes degeneradas, laje lisa não suportada etc.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'rodar_analise',
    description:
      'Roda a análise completa (pórtico espacial + dimensionamento NBR). Retorna um resumo: γz, avisos, elementos com falha/atenção e quantitativos. Pode demorar alguns segundos.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'obter_resultados',
    description:
      'Resumo dos resultados da última análise (sem rodar de novo): estabilidade, dimensionamento com falha/atenção, fundações, recalques, quantitativos e custo.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'adicionar_pilar',
    description:
      'Adiciona um pilar (exige aprovação). Posição em m; seção retangular (bw×h, m), circular (d, m) ou L (b,h,tb,th, m). rotationDeg: 0/90/180/270.',
    input_schema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        shape: { type: 'string', enum: ['rect', 'circle', 'L'] },
        bw: { type: 'number', description: 'largura (rect), m' },
        h: { type: 'number', description: 'altura (rect/L), m' },
        d: { type: 'number', description: 'diâmetro (circle), m' },
        b: { type: 'number', description: 'caixa b (L), m' },
        tb: { type: 'number', description: 'aba tb (L), m' },
        th: { type: 'number', description: 'aba th (L), m' },
        rotationDeg: { type: 'number', enum: [0, 90, 180, 270] },
      },
      required: ['x', 'y'],
      additionalProperties: false,
    },
  },
  {
    name: 'adicionar_viga',
    description:
      'Adiciona uma viga em polilinha na planta (exige aprovação). points em m (≥2); seção bw×h em m (padrão 0,2×0,5).',
    input_schema: {
      type: 'object',
      properties: {
        planName: { type: 'string' },
        points: {
          type: 'array',
          items: {
            type: 'object',
            properties: { x: { type: 'number' }, y: { type: 'number' } },
            required: ['x', 'y'],
            additionalProperties: false,
          },
        },
        bw: { type: 'number' },
        h: { type: 'number' },
      },
      required: ['points'],
      additionalProperties: false,
    },
  },
  {
    name: 'adicionar_laje',
    description:
      'Adiciona uma laje (exige aprovação). polygon em m (≥3 vértices, sem repetir o 1º); thickness em m; cargas em kN/m².',
    input_schema: {
      type: 'object',
      properties: {
        planName: { type: 'string' },
        polygon: {
          type: 'array',
          items: {
            type: 'object',
            properties: { x: { type: 'number' }, y: { type: 'number' } },
            required: ['x', 'y'],
            additionalProperties: false,
          },
        },
        thickness: { type: 'number' },
        finishLoad: { type: 'number' },
        liveLoad: { type: 'number' },
      },
      required: ['polygon'],
      additionalProperties: false,
    },
  },
  {
    name: 'atualizar_elemento',
    description:
      'Atualiza um elemento pelo NOME (ex.: "P3", "V2", "L1") ou id (exige aprovação). patch = campos a alterar (unidades SI: m, kN, kN/m²). Ex.: {"section":{"bw":0.25,"h":0.7}} ou {"thickness":0.15} ou {"ribbed":{...}}.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['column', 'beam', 'slab'] },
        name: { type: 'string' },
        patch: { type: 'object', additionalProperties: true },
      },
      required: ['kind', 'name', 'patch'],
      additionalProperties: false,
    },
  },
  {
    name: 'remover_elemento',
    description: 'Remove um elemento pelo nome ou id (exige aprovação).',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['column', 'beam', 'slab', 'wallLoad', 'loadRegion'] },
        name: { type: 'string' },
      },
      required: ['kind', 'name'],
      additionalProperties: false,
    },
  },
  {
    name: 'atualizar_configuracoes',
    description:
      'Atualiza configurações do projeto (exige aprovação). patch parcial de ProjectSettings — ex.: {"concrete":{"fck":35000}}, {"foundation":{"type":"tubulao"}}, {"soilInteraction":{"enabled":true}}, {"slabMethod":"grelha"} (lajes lisas/contorno qualquer), {"groundBeamKs":20000} (baldrames Winkler, kN/m³). Unidades: kPa, m, kN.',
    input_schema: {
      type: 'object',
      properties: { patch: { type: 'object', additionalProperties: true } },
      required: ['patch'],
      additionalProperties: false,
    },
  },
]

// ---------------------------------------------------------------------------
// executor
// ---------------------------------------------------------------------------

const fmt2 = (n: number): string => (Math.round(n * 100) / 100).toString()

function planByName(project: Project, planName?: string) {
  if (!planName) return project.plans[0]
  return (
    project.plans.find((p) => p.name.toLowerCase() === planName.toLowerCase()) ??
    project.plans[0]
  )
}

function findByName<T extends { id: string; name: string }>(list: T[], name: string): T | null {
  return (
    list.find((e) => e.id === name) ??
    list.find((e) => e.name.toLowerCase() === name.toLowerCase()) ??
    null
  )
}

function projectSummary(): string {
  const s = useStore.getState()
  const p = s.project
  const st = p.settings
  const lines: string[] = []
  lines.push(`Projeto: ${p.name}`)
  lines.push(
    `Níveis (${p.levels.length}): ` +
      p.levels
        .map((l) => `${l.name} @ ${fmt2(l.elevation)} m${l.planId ? '' : ' (sem planta)'}`)
        .join(' · '),
  )
  for (const plan of p.plans) {
    lines.push(
      `Planta "${plan.name}": ${plan.beams.length} vigas, ${plan.slabs.length} lajes, ${plan.wallLoads.length} cargas de parede, ${plan.loadRegions.length} regiões`,
    )
  }
  lines.push(`Pilares: ${p.columns.length}`)
  lines.push(
    `Concreto C${Math.round(st.concrete.fck / 1000)} · CAA ${st.caa} · lajes: ${st.slabMethod === 'grelha' ? 'grelha' : 'Marcus'} · fundação: ${st.foundation.type} · vento: ${st.wind.enabled ? `V0=${st.wind.v0} m/s` : 'desligado'} · interação solo-estrutura: ${st.soilInteraction.enabled ? 'ligada' : 'desligada'} · incêndio: ${st.fire.enabled ? 'ligado' : 'desligado'}`,
  )
  lines.push(`Análise: ${s.analysisStatus}${s.results ? ` (${s.results.warnings.length} avisos)` : ''}`)
  return lines.join('\n')
}

function listElements(planName?: string): string {
  const p = useStore.getState().project
  const plan = planByName(p, planName)
  const lines: string[] = []
  lines.push(
    `Pilares (${p.columns.length}): ` +
      p.columns
        .map((c) => `${c.name} (${fmt2(c.pos.x)};${fmt2(c.pos.y)}) ${columnSectionLabel(c.section)} rot ${c.rotationDeg}°`)
        .join(' · '),
  )
  if (!plan) return lines.join('\n')
  lines.push(`Planta "${plan.name}":`)
  for (const b of plan.beams) {
    const L = b.path.reduce((s, pt, i) => (i > 0 ? s + dist(b.path[i - 1], pt) : 0), 0)
    lines.push(
      `  ${b.name}: ${b.path.map((pt) => `(${fmt2(pt.x)};${fmt2(pt.y)})`).join('→')} ${Math.round(b.section.bw * 100)}x${Math.round(b.section.h * 100)} L=${fmt2(L)} m${(b.openings?.length ?? 0) > 0 ? ` ${b.openings!.length} furo(s)` : ''}`,
    )
  }
  for (const sl of plan.slabs) {
    lines.push(
      `  ${sl.name}: ${sl.polygon.length} vértices, h=${Math.round(sl.thickness * 100)} cm, g2=${sl.finishLoad} q=${sl.liveLoad} kN/m²${sl.ribbed ? ' (nervurada)' : ''}`,
    )
  }
  for (const wl of plan.wallLoads) {
    const beam = plan.beams.find((b) => b.id === wl.beamId)
    lines.push(`  Parede ${wl.w} kN/m sobre ${beam?.name ?? '?'}${wl.x0 !== undefined ? ` [${wl.x0}–${wl.x1} m]` : ''}`)
  }
  for (const rg of plan.loadRegions) {
    lines.push(`  Região ${rg.name} (${rg.kind}) g=${rg.g} q=${rg.q} kN/m²`)
  }
  return lines.join('\n')
}

function consistencyReport(): string {
  const issues = checkConsistency(useStore.getState().project)
  if (issues.length === 0) return 'Nenhuma inconsistência encontrada — modelo pronto p/ análise.'
  return issues.map((i) => `[${i.severity.toUpperCase()}] ${i.message}`).join('\n')
}

function resultsSummary(): string {
  const s = useStore.getState()
  const r = s.results
  if (!r) return 'Sem resultados — a análise ainda não foi executada (use rodar_analise).'
  const lines: string[] = []
  lines.push(`Análise ok em ${Math.round(r.elapsedMs)} ms — ${r.model.stats.members} barras, ${r.model.stats.dofs} GDL.`)
  for (const gz of r.stability.gammaZ) {
    lines.push(`γz ${gz.dir} = ${gz.value.toFixed(3)} (${gz.classification})`)
  }
  const bad = (arr: { status: string }[]) => ({
    falha: arr.filter((x) => x.status === 'falha').length,
    atencao: arr.filter((x) => x.status === 'atencao').length,
  })
  const vb = bad(r.beamDesign)
  const pb = bad(r.columnDesign)
  const lb = bad(r.slabDesign)
  const fb = bad(r.foundations)
  lines.push(
    `Vigas: ${r.beamDesign.length} vãos (${vb.falha} falha/${vb.atencao} atenção) · Pilares: ${r.columnDesign.length} (${pb.falha}/${pb.atencao}) · Lajes: ${r.slabDesign.length} (${lb.falha}/${lb.atencao}) · Fundações: ${r.foundations.length} (${fb.falha}/${fb.atencao})`,
  )
  const fails = [
    ...r.beamDesign.filter((x) => x.status === 'falha').map((x) => `Viga ${x.beamName} vão ${x.spanIndex + 1}`),
    ...r.columnDesign.filter((x) => x.status === 'falha').map((x) => `Pilar ${x.name}`),
    ...r.slabDesign.filter((x) => x.status === 'falha').map((x) => `Laje ${x.name}`),
    ...r.foundations.filter((x) => x.status === 'falha').map((x) => `Fundação ${x.name}`),
  ]
  if (fails.length > 0) lines.push(`FALHAS: ${fails.join(', ')}`)
  if (r.soilInteraction.enabled) {
    lines.push(`Recalque máx (ELS-QP): ${(r.soilInteraction.maxSettlement * 1000).toFixed(1)} mm`)
  }
  const q = r.quantities
  lines.push(
    `Quantitativos: ${q.concrete.total.toFixed(1)} m³ concreto · ${Math.round(q.steel.total)} kg aço · ${Math.round(q.formwork)} m² fôrma${q.cost.enabled ? ` · custo ≈ R$ ${Math.round(q.cost.total)}` : ''}`,
  )
  if (r.warnings.length > 0) {
    lines.push('Avisos:')
    for (const w of r.warnings.slice(0, 12)) lines.push(`  • ${w}`)
    if (r.warnings.length > 12) lines.push(`  … +${r.warnings.length - 12} avisos`)
  }
  return lines.join('\n')
}

/** roda a análise e espera o worker terminar */
async function runAnalysisAndWait(): Promise<string> {
  const store = useStore
  store.getState().runAnalysis()
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, 150))
    const st = store.getState().analysisStatus
    if (st === 'done') return resultsSummary()
    if (st === 'error') return 'A análise falhou — verifique o modelo (verificar_consistencia ajuda a achar a causa).'
  }
  return 'Tempo esgotado aguardando a análise.'
}

function buildColumnSection(input: Record<string, unknown>): ColumnSection {
  const shape = (input.shape as string) ?? 'rect'
  if (shape === 'circle') return { shape: 'circle', d: (input.d as number) ?? 0.4 }
  if (shape === 'L') {
    return {
      shape: 'L',
      b: (input.b as number) ?? 0.5,
      h: (input.h as number) ?? 0.5,
      tb: (input.tb as number) ?? 0.2,
      th: (input.th as number) ?? 0.2,
    }
  }
  return { bw: (input.bw as number) ?? 0.25, h: (input.h as number) ?? 0.6 }
}

/** executa uma ferramenta; retorna o texto do tool_result */
export async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  const store = useStore
  const state = () => store.getState()

  switch (name) {
    case 'obter_resumo_projeto':
      return projectSummary()
    case 'listar_elementos':
      return listElements(input.planName as string | undefined)
    case 'verificar_consistencia':
      return consistencyReport()
    case 'rodar_analise':
      return runAnalysisAndWait()
    case 'obter_resultados':
      return resultsSummary()

    case 'adicionar_pilar': {
      const p = state().project
      const pos: Vec2 = { x: input.x as number, y: input.y as number }
      const col: Column = {
        id: uid('col'),
        name: nextColumnName(p),
        pos,
        section: buildColumnSection(input),
        rotationDeg: ((input.rotationDeg as 0 | 90 | 180 | 270) ?? 0),
        baseLevelId: p.levels[0].id,
        topLevelId: p.levels[p.levels.length - 1].id,
      }
      useStore.setState((s) => ({
        project: { ...s.project, columns: [...s.project.columns, col] },
        dirty: true,
        results: null,
        analysisStatus: 'idle',
      }))
      return `Pilar ${col.name} adicionado em (${fmt2(pos.x)};${fmt2(pos.y)}) — ${columnSectionLabel(col.section)}.`
    }

    case 'adicionar_viga': {
      const p = state().project
      const plan = planByName(p, input.planName as string | undefined)
      if (!plan) return 'Erro: planta não encontrada.'
      const points = input.points as Vec2[]
      if (!points || points.length < 2) return 'Erro: forneça ≥ 2 pontos.'
      const beam: Beam = {
        id: uid('bm'),
        name: nextBeamName(p, plan.id),
        path: points.map((pt) => ({ x: pt.x, y: pt.y })),
        section: { bw: (input.bw as number) ?? 0.2, h: (input.h as number) ?? 0.5 },
      }
      useStore.setState((s) => ({
        project: {
          ...s.project,
          plans: s.project.plans.map((pl) =>
            pl.id === plan.id ? { ...pl, beams: [...pl.beams, beam] } : pl,
          ),
        },
        dirty: true,
        results: null,
        analysisStatus: 'idle',
      }))
      return `Viga ${beam.name} adicionada na planta "${plan.name}" (${points.length} vértices).`
    }

    case 'adicionar_laje': {
      const p = state().project
      const plan = planByName(p, input.planName as string | undefined)
      if (!plan) return 'Erro: planta não encontrada.'
      const polygon = input.polygon as Vec2[]
      if (!polygon || polygon.length < 3) return 'Erro: forneça ≥ 3 vértices.'
      const slab: Slab = {
        id: uid('sl'),
        name: nextSlabName(p, plan.id),
        polygon: polygon.map((pt) => ({ x: pt.x, y: pt.y })),
        thickness: (input.thickness as number) ?? 0.12,
        finishLoad: (input.finishLoad as number) ?? 1.0,
        liveLoad: (input.liveLoad as number) ?? 1.5,
      }
      useStore.setState((s) => ({
        project: {
          ...s.project,
          plans: s.project.plans.map((pl) =>
            pl.id === plan.id ? { ...pl, slabs: [...pl.slabs, slab] } : pl,
          ),
        },
        dirty: true,
        results: null,
        analysisStatus: 'idle',
      }))
      return `Laje ${slab.name} adicionada na planta "${plan.name}".`
    }

    case 'atualizar_elemento': {
      const kind = input.kind as 'column' | 'beam' | 'slab'
      const nm = input.name as string
      const patch = input.patch as Record<string, unknown>
      const p = state().project
      if (kind === 'column') {
        const col = findByName(p.columns, nm)
        if (!col) return `Erro: pilar "${nm}" não encontrado.`
        state().updateColumn(col.id, patch as Partial<Column>)
        return `Pilar ${col.name} atualizado: ${JSON.stringify(patch)}.`
      }
      if (kind === 'beam') {
        const beam = p.plans.flatMap((pl) => pl.beams).find((b) => b.id === nm || b.name.toLowerCase() === nm.toLowerCase())
        if (!beam) return `Erro: viga "${nm}" não encontrada.`
        state().updateBeam(beam.id, patch as Partial<Beam>)
        return `Viga ${beam.name} atualizada: ${JSON.stringify(patch)}.`
      }
      const slab = p.plans.flatMap((pl) => pl.slabs).find((sl) => sl.id === nm || sl.name.toLowerCase() === nm.toLowerCase())
      if (!slab) return `Erro: laje "${nm}" não encontrada.`
      state().updateSlab(slab.id, patch as Partial<Slab>)
      return `Laje ${slab.name} atualizada: ${JSON.stringify(patch)}.`
    }

    case 'remover_elemento': {
      const kind = input.kind as ElementKind
      const nm = input.name as string
      const p = state().project
      let id: string | null = null
      let label = nm
      if (kind === 'column') {
        const el = findByName(p.columns, nm)
        id = el?.id ?? null
        label = el?.name ?? nm
      } else {
        for (const pl of p.plans) {
          const list =
            kind === 'beam' ? pl.beams : kind === 'slab' ? pl.slabs : kind === 'loadRegion' ? pl.loadRegions : pl.wallLoads
          const el = (list as { id: string; name?: string }[]).find(
            (e) => e.id === nm || (e.name ?? '').toLowerCase() === nm.toLowerCase(),
          )
          if (el) {
            id = el.id
            label = (el as { name?: string }).name ?? nm
            break
          }
        }
      }
      if (!id) return `Erro: ${kind} "${nm}" não encontrado.`
      state().deleteElement({ kind, id })
      return `${kind} ${label} removido.`
    }

    case 'atualizar_configuracoes': {
      const patch = input.patch as Record<string, unknown>
      const st = state().project.settings
      // merge raso por chave de 1º nível p/ não perder campos de objetos aninhados
      const merged: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(patch)) {
        const cur = (st as unknown as Record<string, unknown>)[k]
        merged[k] =
          cur && typeof cur === 'object' && !Array.isArray(cur) && v && typeof v === 'object' && !Array.isArray(v)
            ? { ...(cur as object), ...(v as object) }
            : v
      }
      state().updateSettings(merged as never)
      return `Configurações atualizadas: ${JSON.stringify(patch)}.`
    }

    default:
      return `Ferramenta desconhecida: ${name}`
  }
}

/** descrição curta p/ o cartão de aprovação */
export function describeToolCall(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'adicionar_pilar':
      return `Adicionar pilar em (${input.x}; ${input.y})${input.shape ? ` — ${input.shape}` : ''}`
    case 'adicionar_viga':
      return `Adicionar viga com ${(input.points as unknown[])?.length ?? '?'} pontos`
    case 'adicionar_laje':
      return `Adicionar laje com ${(input.polygon as unknown[])?.length ?? '?'} vértices`
    case 'atualizar_elemento':
      return `Atualizar ${input.kind} "${input.name}": ${JSON.stringify(input.patch)}`
    case 'remover_elemento':
      return `REMOVER ${input.kind} "${input.name}"`
    case 'atualizar_configuracoes':
      return `Alterar configurações: ${JSON.stringify(input.patch)}`
    default:
      return `${name}(${JSON.stringify(input)})`
  }
}
