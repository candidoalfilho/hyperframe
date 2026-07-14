import Anthropic from '@anthropic-ai/sdk'
import { COPILOT_TOOLS, executeTool, isMutatingTool } from './tools'

/**
 * Loop do Copiloto (tool-use manual): mensagem → Claude → ferramentas →
 * resultados → Claude… As ferramentas de mutação pausam o loop até o usuário
 * aprovar/recusar (cartões na UI). No modo planejamento, só ferramentas de
 * leitura são oferecidas.
 *
 * A chave da API fica em localStorage (NUNCA no arquivo do projeto) e as
 * chamadas saem direto do app p/ api.anthropic.com (dangerouslyAllowBrowser).
 */

export const COPILOT_MODELS = [
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 (recomendado)' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 (rápido)' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (econômico)' },
] as const

const LS_KEY = 'hyperframe.copilot.apiKey'
const LS_MODEL = 'hyperframe.copilot.model'

export function getApiKey(): string {
  return localStorage.getItem(LS_KEY) ?? ''
}
export function setApiKey(key: string): void {
  if (key) localStorage.setItem(LS_KEY, key)
  else localStorage.removeItem(LS_KEY)
}
export function getModel(): string {
  return localStorage.getItem(LS_MODEL) ?? 'claude-opus-4-8'
}
export function setModel(model: string): void {
  localStorage.setItem(LS_MODEL, model)
}

const SYSTEM_PROMPT = `Você é o Copiloto do HyperFrame — software brasileiro de análise e dimensionamento estrutural de edifícios de concreto armado pelas normas ABNT (NBR 6118/6120/6122/6123/8681/14432/15200).

Contexto técnico:
- Unidades internas SI: metros, kN, kN·m, kPa (fck 30 MPa = 30000 kPa). A UI exibe cm/MPa.
- Planta: eixos X/Y em metros. Pilares são contínuos entre níveis; vigas são polilinhas por planta; lajes são polígonos (maciças ou nervuradas).
- O fluxo usual: modelar → verificar consistência → rodar análise → revisar dimensionamento/avisos → ajustar.

Regras de conduta:
- Responda SEMPRE em português brasileiro, curto e técnico.
- Comece se situando: use obter_resumo_projeto (e listar_elementos quando precisar de geometria) antes de propor ou fazer mudanças.
- Mudanças no modelo exigem aprovação manual do usuário (a UI cuida disso) — proponha em lotes pequenos e explique o porquê de cada uma em 1 frase.
- Depois de mudar o modelo, rode verificar_consistencia; rode rodar_analise quando o usuário quiser resultados.
- Nunca invente valores de norma; se faltar dado (ex.: sondagem, V0 do vento), pergunte.
- Você é assistente de engenharia — o engenheiro responsável decide. Em dúvida estrutural relevante, recomende verificação humana.`

const PLAN_MODE_EXTRA = `

MODO PLANEJAMENTO ATIVO: você NÃO pode modificar o modelo (as ferramentas de mutação estão indisponíveis). Investigue com as ferramentas de leitura e produza um plano numerado, curto e executável das mudanças propostas. Pergunte o que estiver ambíguo. Quando o usuário sair do modo planejamento, você poderá executar.`

// ---------------------------------------------------------------------------

export interface ChatEntry {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'error'
  text: string
  /** ferramenta associada (role 'tool') */
  toolName?: string
  pending?: boolean
}

export interface PendingApproval {
  toolUseId: string
  name: string
  description: string
  resolve: (approved: boolean) => void
}

export interface CopilotCallbacks {
  onEntries: (entries: ChatEntry[]) => void
  onApproval: (pending: PendingApproval | null) => void
  onBusy: (busy: boolean) => void
}

let seq = 0
const eid = (): string => `ce${++seq}`

export class CopilotAgent {
  private client: Anthropic
  private model: string
  private messages: Anthropic.MessageParam[] = []
  private entries: ChatEntry[] = []
  private cb: CopilotCallbacks
  private aborted = false
  planMode = false

  constructor(apiKey: string, model: string, cb: CopilotCallbacks) {
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
    this.model = model
    this.cb = cb
  }

  private push(entry: ChatEntry): void {
    this.entries = [...this.entries, entry]
    this.cb.onEntries(this.entries)
  }
  private replaceLast(patch: Partial<ChatEntry>): void {
    this.entries = this.entries.map((e, i) =>
      i === this.entries.length - 1 ? { ...e, ...patch } : e,
    )
    this.cb.onEntries(this.entries)
  }

  stop(): void {
    this.aborted = true
  }

  clear(): void {
    this.messages = []
    this.entries = []
    this.cb.onEntries(this.entries)
  }

  /** pede aprovação ao usuário e espera a decisão */
  private askApproval(toolUseId: string, name: string, description: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.cb.onApproval({
        toolUseId,
        name,
        description,
        resolve: (ok) => {
          this.cb.onApproval(null)
          resolve(ok)
        },
      })
    })
  }

  async send(userText: string, describeToolCall: (n: string, i: Record<string, unknown>) => string): Promise<void> {
    this.aborted = false
    this.cb.onBusy(true)
    this.push({ id: eid(), role: 'user', text: userText })
    this.messages.push({ role: 'user', content: userText })

    const tools = this.planMode
      ? COPILOT_TOOLS.filter((t) => !isMutatingTool(t.name))
      : COPILOT_TOOLS
    const system = this.planMode ? SYSTEM_PROMPT + PLAN_MODE_EXTRA : SYSTEM_PROMPT

    try {
      for (let iter = 0; iter < 20; iter++) {
        if (this.aborted) break
        const isHaiku = this.model.includes('haiku')
        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: isHaiku ? 8192 : 16000,
          system,
          // Opus 4.8/Sonnet 5: thinking adaptativo; Haiku 4.5 não suporta
          ...(isHaiku ? {} : { thinking: { type: 'adaptive' as const } }),
          tools,
          messages: this.messages,
        })

        if (response.stop_reason === 'refusal') {
          this.push({
            id: eid(),
            role: 'error',
            text: 'O modelo recusou esta solicitação por política de segurança.',
          })
          break
        }

        // texto do assistente
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim()
        if (text) this.push({ id: eid(), role: 'assistant', text })

        this.messages.push({ role: 'assistant', content: response.content })

        if (response.stop_reason !== 'tool_use') break

        const toolUses = response.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
        )
        const results: Anthropic.ToolResultBlockParam[] = []
        for (const tu of toolUses) {
          if (this.aborted) {
            results.push({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: 'Interrompido pelo usuário.',
              is_error: true,
            })
            continue
          }
          const input = (tu.input ?? {}) as Record<string, unknown>
          const mutating = isMutatingTool(tu.name)
          const desc = describeToolCall(tu.name, input)
          this.push({
            id: eid(),
            role: 'tool',
            toolName: tu.name,
            text: desc,
            pending: true,
          })

          let approved = true
          if (mutating) {
            approved = await this.askApproval(tu.id, tu.name, desc)
          }
          if (!approved) {
            this.replaceLast({ pending: false, text: `${desc} — recusado` })
            results.push({
              type: 'tool_result',
              tool_use_id: tu.id,
              content:
                'O usuário RECUSOU esta ação. Não tente de novo sem novas instruções; pergunte o que ele prefere.',
              is_error: true,
            })
            continue
          }
          try {
            const out = await executeTool(tu.name, input)
            this.replaceLast({ pending: false })
            results.push({ type: 'tool_result', tool_use_id: tu.id, content: out })
          } catch (err) {
            this.replaceLast({ pending: false, text: `${desc} — erro` })
            results.push({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: `Erro ao executar: ${err instanceof Error ? err.message : String(err)}`,
              is_error: true,
            })
          }
        }
        // todos os resultados numa única mensagem de usuário
        this.messages.push({ role: 'user', content: results })
      }
    } catch (err) {
      let msg: string
      if (err instanceof Anthropic.AuthenticationError) {
        msg = 'Chave da API inválida — confira em Configurações → Copiloto IA.'
      } else if (err instanceof Anthropic.RateLimitError) {
        msg = 'Limite de requisições atingido — aguarde um pouco e tente de novo.'
      } else if (err instanceof Anthropic.APIConnectionError) {
        msg = 'Falha de conexão com a API — verifique sua internet.'
      } else if (err instanceof Anthropic.APIError) {
        msg = `Erro da API (${err.status}): ${err.message}`
      } else {
        msg = `Erro: ${err instanceof Error ? err.message : String(err)}`
      }
      this.push({ id: eid(), role: 'error', text: msg })
    } finally {
      this.cb.onBusy(false)
      this.cb.onApproval(null)
    }
  }
}
