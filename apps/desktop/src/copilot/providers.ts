import Anthropic from '@anthropic-ai/sdk'
import { ollamaChat, type OllamaChatMessage, type OllamaToolDef } from './ollama'

/**
 * Abstração de provedores do Copiloto: o loop do agente fala um formato
 * NEUTRO de conversa; cada provedor (Claude API / Ollama local) converte de
 * ida e volta. O provedor Claude preserva os blocos crus da resposta
 * (thinking/tool_use) p/ reenvio fiel nos turnos seguintes.
 */

export interface NToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

export type NMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; toolCalls: NToolCall[]; raw?: unknown }
  | { role: 'toolResults'; results: { id: string; content: string; isError?: boolean }[] }

export interface NResponse {
  text: string
  toolCalls: NToolCall[]
  refusal: boolean
  /** payload específico do provedor p/ ecoar no histórico (Claude: content blocks) */
  raw?: unknown
}

export interface ChatProvider {
  /** rótulo p/ UI e mensagens de erro */
  label: string
  chat(system: string, messages: NMessage[], tools: Anthropic.Tool[]): Promise<NResponse>
}

// ---------------------------------------------------------------------------
// Claude (API da Anthropic)
// ---------------------------------------------------------------------------

export class AnthropicProvider implements ChatProvider {
  label = 'Claude'
  private client: Anthropic
  private model: string

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
    this.model = model
  }

  private toParams(messages: NMessage[]): Anthropic.MessageParam[] {
    const out: Anthropic.MessageParam[] = []
    for (const m of messages) {
      if (m.role === 'user') {
        out.push({ role: 'user', content: m.text })
      } else if (m.role === 'assistant') {
        if (m.raw) {
          // blocos originais (inclui thinking) — obrigatório p/ tool-use fiel
          out.push({ role: 'assistant', content: m.raw as Anthropic.ContentBlockParam[] })
        } else {
          const blocks: Anthropic.ContentBlockParam[] = []
          if (m.text) blocks.push({ type: 'text', text: m.text })
          for (const tc of m.toolCalls) {
            blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input })
          }
          out.push({ role: 'assistant', content: blocks.length > 0 ? blocks : m.text })
        }
      } else {
        out.push({
          role: 'user',
          content: m.results.map(
            (r): Anthropic.ToolResultBlockParam => ({
              type: 'tool_result',
              tool_use_id: r.id,
              content: r.content,
              ...(r.isError ? { is_error: true } : {}),
            }),
          ),
        })
      }
    }
    return out
  }

  async chat(system: string, messages: NMessage[], tools: Anthropic.Tool[]): Promise<NResponse> {
    const isHaiku = this.model.includes('haiku')
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: isHaiku ? 8192 : 16000,
      system,
      // Opus 4.8/Sonnet 5: thinking adaptativo; Haiku 4.5 não suporta
      ...(isHaiku ? {} : { thinking: { type: 'adaptive' as const } }),
      tools,
      messages: this.toParams(messages),
    })
    if (response.stop_reason === 'refusal') {
      return { text: '', toolCalls: [], refusal: true, raw: response.content }
    }
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim()
    const toolCalls = response.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      .map((b) => ({ id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> }))
    return { text, toolCalls, refusal: false, raw: response.content }
  }
}

// ---------------------------------------------------------------------------
// Local (Ollama)
// ---------------------------------------------------------------------------

export class OllamaProvider implements ChatProvider {
  label: string
  private model: string

  constructor(model: string) {
    this.model = model
    this.label = `Local (${model})`
  }

  async chat(system: string, messages: NMessage[], tools: Anthropic.Tool[]): Promise<NResponse> {
    const msgs: OllamaChatMessage[] = [{ role: 'system', content: system }]
    for (const m of messages) {
      if (m.role === 'user') {
        msgs.push({ role: 'user', content: m.text })
      } else if (m.role === 'assistant') {
        msgs.push({
          role: 'assistant',
          content: m.text,
          ...(m.toolCalls.length > 0
            ? {
                tool_calls: m.toolCalls.map((tc) => ({
                  id: tc.id,
                  function: { name: tc.name, arguments: tc.input },
                })),
              }
            : {}),
        })
      } else {
        for (const r of m.results) {
          msgs.push({
            role: 'tool',
            tool_call_id: r.id,
            content: r.isError ? `ERRO: ${r.content}` : r.content,
          })
        }
      }
    }
    const oTools: OllamaToolDef[] = tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description ?? '',
        parameters: t.input_schema as Record<string, unknown>,
      },
    }))
    const result = await ollamaChat(this.model, msgs, oTools)
    return {
      text: result.content.trim(),
      toolCalls: result.toolCalls,
      refusal: false,
    }
  }
}
