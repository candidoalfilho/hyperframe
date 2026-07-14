/**
 * Cliente do Ollama (modelos locais) — HTTP em localhost:11434.
 * Formatos validados contra Ollama 0.17.x: /api/version, /api/tags,
 * /api/pull (NDJSON com progresso) e /api/chat com tools
 * (tool_calls[].id + function.{name,arguments-objeto}; resultado volta como
 * {role:"tool", tool_call_id, content}).
 */

const BASE = 'http://localhost:11434'

export interface OllamaStatus {
  running: boolean
  version?: string
}

export async function ollamaStatus(): Promise<OllamaStatus> {
  try {
    const res = await fetch(`${BASE}/api/version`, { signal: AbortSignal.timeout(1500) })
    if (!res.ok) return { running: false }
    const data = (await res.json()) as { version?: string }
    return { running: true, version: data.version }
  } catch {
    return { running: false }
  }
}

export interface OllamaModelInfo {
  name: string
  sizeGb: number
}

export async function listOllamaModels(): Promise<OllamaModelInfo[]> {
  const res = await fetch(`${BASE}/api/tags`, { signal: AbortSignal.timeout(3000) })
  if (!res.ok) return []
  const data = (await res.json()) as { models?: { name: string; size: number }[] }
  return (data.models ?? []).map((m) => ({
    name: m.name,
    sizeGb: Math.round((m.size / 1e9) * 10) / 10,
  }))
}

/** modelos recomendados p/ o copiloto (com suporte a tools) */
export const RECOMMENDED_LOCAL_MODELS = [
  { name: 'qwen3:4b', sizeGb: 2.6, note: 'leve — bom p/ notebooks' },
  { name: 'qwen3:8b', sizeGb: 5.2, note: 'recomendado — melhor com ferramentas' },
  { name: 'llama3.1:8b', sizeGb: 4.9, note: 'alternativa consolidada' },
]

/** baixa um modelo com progresso (0–100); cancelável via AbortSignal */
export async function pullOllamaModel(
  name: string,
  onProgress: (pct: number, status: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${BASE}/api/pull`, {
    method: 'POST',
    body: JSON.stringify({ model: name, stream: true }),
    signal,
  })
  if (!res.ok || !res.body) throw new Error(`Falha ao iniciar o download (${res.status}).`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const ev = JSON.parse(line) as {
          status?: string
          total?: number
          completed?: number
          error?: string
        }
        if (ev.error) throw new Error(ev.error)
        if (ev.total && ev.completed !== undefined) {
          onProgress(Math.round((100 * ev.completed) / ev.total), ev.status ?? 'baixando')
        } else if (ev.status) {
          onProgress(ev.status === 'success' ? 100 : -1, ev.status)
        }
      } catch (e) {
        if (e instanceof Error && e.message && !e.message.startsWith('Unexpected')) throw e
      }
    }
  }
}

// ---------------------------------------------------------------------------
// chat com tools
// ---------------------------------------------------------------------------

export interface OllamaToolCall {
  id?: string
  function: { name: string; arguments: Record<string, unknown> }
}

export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: OllamaToolCall[]
  tool_call_id?: string
}

export interface OllamaToolDef {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export interface OllamaChatResult {
  content: string
  toolCalls: { id: string; name: string; input: Record<string, unknown> }[]
}

export async function ollamaChat(
  model: string,
  messages: OllamaChatMessage[],
  tools: OllamaToolDef[],
): Promise<OllamaChatResult> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    body: JSON.stringify({
      model,
      messages,
      tools,
      stream: false,
      options: { num_ctx: 16384 },
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Ollama respondeu ${res.status}: ${body.slice(0, 200)}`)
  }
  const data = (await res.json()) as {
    message?: { content?: string; tool_calls?: OllamaToolCall[] }
    error?: string
  }
  if (data.error) throw new Error(data.error)
  const msg = data.message ?? {}
  return {
    content: msg.content ?? '',
    toolCalls: (msg.tool_calls ?? []).map((tc, i) => ({
      id: tc.id ?? `call_${Date.now()}_${i}`,
      name: tc.function.name,
      input: tc.function.arguments ?? {},
    })),
  }
}
