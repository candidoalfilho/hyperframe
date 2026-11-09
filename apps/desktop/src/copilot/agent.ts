import Anthropic from '@anthropic-ai/sdk'
import { COPILOT_TOOLS, executeTool, ghostForToolCall, isMutatingTool } from './tools'
import {
  AnthropicProvider,
  OllamaProvider,
  type ChatProvider,
  type NMessage,
} from './providers'
import { platform } from '../platform'
import { useStore } from '../store'

/**
 * Loop do Copiloto (tool-use manual): mensagem → modelo → ferramentas →
 * resultados → modelo… As ferramentas de mutação pausam o loop até o usuário
 * aprovar/recusar (cartões na UI). No modo planejamento, só ferramentas de
 * leitura são oferecidas. Funciona com Claude (API) ou modelos locais
 * (Ollama) via a abstração de provedores.
 */

export const COPILOT_MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5 (recomendado)' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5 (rápido)' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5 (econômico)' },
] as const

/** ids salvos de versões antigas → geração atual (mais barata e melhor) */
const MODEL_MIGRATION: Record<string, string> = {
  'claude-opus-4-8': 'claude-opus-5-5',
  'claude-sonnet-5': 'claude-sonnet-5-5',
  'claude-haiku-4-5': 'claude-haiku-5-5',
}

export type ProviderKind = 'claude' | 'local'

const LS_KEY = 'hyperframe.copilot.apiKey'
const LS_MODEL = 'hyperframe.copilot.model'
const LS_PROVIDER = 'hyperframe.copilot.provider'
const LS_LOCAL_MODEL = 'hyperframe.copilot.localModel'

export function getApiKey(): string {
  return localStorage.getItem(LS_KEY) ?? ''
}
export function setApiKey(key: string): void {
  if (key) localStorage.setItem(LS_KEY, key)
  else localStorage.removeItem(LS_KEY)
}
export function getModel(): string {
  const saved = localStorage.getItem(LS_MODEL) ?? 'claude-opus-5-5'
  return MODEL_MIGRATION[saved] ?? saved
}
export function setModel(model: string): void {
  localStorage.setItem(LS_MODEL, model)
}
export function getProviderKind(): ProviderKind {
  return (localStorage.getItem(LS_PROVIDER) as ProviderKind) ?? 'claude'
}
export function setProviderKind(kind: ProviderKind): void {
  localStorage.setItem(LS_PROVIDER, kind)
}
export function getLocalModel(): string {
  return localStorage.getItem(LS_LOCAL_MODEL) ?? ''
}
export function setLocalModel(model: string): void {
  localStorage.setItem(LS_LOCAL_MODEL, model)
}

/** cria o provedor conforme as preferências salvas (null = não configurado) */
export function buildProvider(): ChatProvider | null {
  if (getProviderKind() === 'local') {
    if (!platform.copilotLocal) return null
    const model = getLocalModel()
    return model ? new OllamaProvider(model) : null
  }
  if (!platform.copilotAnthropic) return null
  const key = getApiKey()
  return key ? new AnthropicProvider(key, getModel()) : null
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
  toolName?: string
  pending?: boolean
  /** resposta chegando em streaming (cursor piscante na UI) */
  streaming?: boolean
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
  /** resumo do raciocínio em andamento (null = não está pensando) */
  onThinking?: (text: string | null) => void
}

let seq = 0
const eid = (): string => `ce${++seq}`

export class CopilotAgent {
  private provider: ChatProvider
  private messages: NMessage[] = []
  private entries: ChatEntry[] = []
  private cb: CopilotCallbacks
  private aborted = false
  private abortCtl: AbortController | null = null
  private lastUserText: string | null = null
  private lastContextNote: string | undefined
  planMode = false

  constructor(provider: ChatProvider, cb: CopilotCallbacks) {
    this.provider = provider
    this.cb = cb
  }

  /** troca o provedor mantendo a conversa (painel reaberto / modelo trocado) */
  setProvider(provider: ChatProvider): void {
    this.provider = provider
  }
  /** religa os callbacks a um painel recém-montado e re-emite o histórico */
  attach(cb: CopilotCallbacks): void {
    this.cb = cb
    cb.onEntries(this.entries)
  }

  get providerLabel(): string {
    return this.provider.label
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
  private patchById(id: string, patch: Partial<ChatEntry>): void {
    this.entries = this.entries.map((e) => (e.id === id ? { ...e, ...patch } : e))
    this.cb.onEntries(this.entries)
  }

  stop(): void {
    this.aborted = true
    this.abortCtl?.abort()
  }

  clear(): void {
    this.messages = []
    this.entries = []
    this.cb.onEntries(this.entries)
  }

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

  async send(
    userText: string,
    describeToolCall: (n: string, i: Record<string, unknown>) => string,
    /** contexto da UI (menções @, seleção atual) — vai pro modelo, não pro chat */
    contextNote?: string,
  ): Promise<void> {
    this.aborted = false
    this.abortCtl = new AbortController()
    this.cb.onBusy(true)
    this.lastUserText = userText
    this.lastContextNote = contextNote
    this.push({ id: eid(), role: 'user', text: userText })
    this.messages.push({
      role: 'user',
      text: contextNote ? `${userText}\n\n[Contexto da UI — não visível no chat]\n${contextNote}` : userText,
    })

    const tools = this.planMode
      ? COPILOT_TOOLS.filter((t) => !isMutatingTool(t.name))
      : COPILOT_TOOLS
    const system = this.planMode ? SYSTEM_PROMPT + PLAN_MODE_EXTRA : SYSTEM_PROMPT

    try {
      for (let iter = 0; iter < 20; iter++) {
        if (this.aborted) break

        // entrada de streaming: cria no 1º delta e vai acrescentando
        let streamId: string | null = null
        let streamBuf = ''
        const onText = (delta: string): void => {
          if (this.aborted) return
          this.cb.onThinking?.(null)
          streamBuf += delta
          if (!streamId) {
            streamId = eid()
            this.push({ id: streamId, role: 'assistant', text: streamBuf, streaming: true })
          } else {
            this.patchById(streamId, { text: streamBuf })
          }
        }
        // resumo do raciocínio (linha "pensando…" do composer)
        let thinkBuf = ''
        const onThinking = (delta: string): void => {
          if (this.aborted) return
          thinkBuf += delta
          this.cb.onThinking?.(thinkBuf)
        }

        const response = await this.provider.chat(
          system,
          this.messages,
          tools,
          onText,
          this.abortCtl.signal,
          onThinking,
        )
        this.cb.onThinking?.(null)

        if (response.refusal) {
          if (streamId) this.patchById(streamId, { streaming: false })
          this.push({
            id: eid(),
            role: 'error',
            text: 'O modelo recusou esta solicitação por política de segurança.',
          })
          break
        }

        if (streamId) {
          this.patchById(streamId, { text: response.text, streaming: false })
        } else if (response.text) {
          this.push({ id: eid(), role: 'assistant', text: response.text })
        }
        this.messages.push({
          role: 'assistant',
          text: response.text,
          toolCalls: response.toolCalls,
          raw: response.raw,
        })

        if (response.toolCalls.length === 0) break

        const results: { id: string; content: string; isError?: boolean }[] = []
        for (const tc of response.toolCalls) {
          if (this.aborted) {
            results.push({ id: tc.id, content: 'Interrompido pelo usuário.', isError: true })
            continue
          }
          const mutating = isMutatingTool(tc.name)
          const desc = describeToolCall(tc.name, tc.input)
          this.push({ id: eid(), role: 'tool', toolName: tc.name, text: desc, pending: true })

          let approved = true
          if (mutating) {
            // fantasma no editor 2D enquanto a aprovação está pendente
            useStore.getState().setAiGhost(ghostForToolCall(tc.name, tc.input))
            try {
              approved = await this.askApproval(tc.id, tc.name, desc)
            } finally {
              useStore.getState().setAiGhost(null)
            }
          }
          if (!approved) {
            this.replaceLast({ pending: false, text: `${desc} — recusado` })
            results.push({
              id: tc.id,
              content:
                'O usuário RECUSOU esta ação. Não tente de novo sem novas instruções; pergunte o que ele prefere.',
              isError: true,
            })
            continue
          }
          try {
            const out = await executeTool(tc.name, tc.input)
            this.replaceLast({ pending: false })
            results.push({ id: tc.id, content: out })
          } catch (err) {
            this.replaceLast({ pending: false, text: `${desc} — erro` })
            results.push({
              id: tc.id,
              content: `Erro ao executar: ${err instanceof Error ? err.message : String(err)}`,
              isError: true,
            })
          }
        }
        this.messages.push({ role: 'toolResults', results })
      }
    } catch (err) {
      let msg: string
      if (err instanceof Anthropic.APIUserAbortError || this.aborted) {
        // parada pedida pelo usuário — não é erro
        this.entries = this.entries.map((e) => (e.streaming ? { ...e, streaming: false } : e))
        this.cb.onEntries(this.entries)
        this.cb.onBusy(false)
        this.cb.onApproval(null)
        useStore.getState().setAiGhost(null)
        return
      }
      if (err instanceof Anthropic.AuthenticationError) {
        msg = 'Chave da API inválida — confira em Configurações → Copiloto IA.'
      } else if (err instanceof Anthropic.RateLimitError) {
        msg = 'Limite de requisições atingido — aguarde um pouco e tente de novo.'
      } else if (err instanceof Anthropic.APIConnectionError) {
        msg = 'Falha de conexão com a API — verifique sua internet.'
      } else if (err instanceof Anthropic.APIError) {
        msg = `Erro da API (${err.status}): ${err.message}`
      } else if (err instanceof TypeError && this.provider instanceof OllamaProvider) {
        msg = 'Não consegui falar com o Ollama — ele está rodando? (ollama serve)'
      } else {
        msg = `Erro: ${err instanceof Error ? err.message : String(err)}`
      }
      this.push({ id: eid(), role: 'error', text: msg })
    } finally {
      this.cb.onBusy(false)
      this.cb.onApproval(null)
      this.cb.onThinking?.(null)
      useStore.getState().setAiGhost(null)
    }
  }

  /** regenera a última resposta: volta até a última mensagem do usuário e reenvia */
  retry(describeToolCall: (n: string, i: Record<string, unknown>) => string): void {
    if (!this.lastUserText) return
    // corta o histórico da API até ANTES do último turno do usuário
    let lastUser = -1
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === 'user') {
        lastUser = i
        break
      }
    }
    if (lastUser < 0) return
    this.messages = this.messages.slice(0, lastUser)
    // corta as entradas do chat a partir da última mensagem do usuário
    let lastEntry = -1
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i].role === 'user') {
        lastEntry = i
        break
      }
    }
    if (lastEntry >= 0) {
      this.entries = this.entries.slice(0, lastEntry)
      this.cb.onEntries(this.entries)
    }
    void this.send(this.lastUserText, describeToolCall, this.lastContextNote)
  }
}

// ---------------------------------------------------------------------------
// sessão única: a conversa sobrevive a fechar/reabrir o painel e à troca de
// modelo (o provedor é trocado por baixo, o histórico fica)
// ---------------------------------------------------------------------------

let session: CopilotAgent | null = null

export function getCopilotSession(cb: CopilotCallbacks): CopilotAgent | null {
  const provider = buildProvider()
  if (!provider) return null
  if (!session) {
    session = new CopilotAgent(provider, cb)
    cb.onEntries([])
  } else {
    session.setProvider(provider)
    session.attach(cb)
  }
  return session
}

export function resetCopilotSession(): void {
  session = null
}
