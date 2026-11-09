import { useEffect, useMemo, useRef, useState } from 'react'
import {
  COPILOT_MODELS,
  getCopilotSession,
  getLocalModel,
  getModel,
  getProviderKind,
  setLocalModel as persistLocalModel,
  setModel as persistModel,
  type ChatEntry,
  type CopilotAgent,
  type PendingApproval,
} from './agent'
import {
  describeElementsByName,
  describeSelection,
  describeToolCall,
  listMentionables,
  type Mentionable,
} from './tools'
import { extractMentions, mentionQueryAt } from './md'
import Markdown from './Markdown'
import { listOllamaModels, ollamaStatus } from './ollama'
import { useStore } from '../store'
import { getUiZoom } from '../ui/zoom'
import { IconClose } from '../components/Icons'

/**
 * Copiloto IA — composer no estilo do app do Claude: saudação centralizada,
 * caixa arredondada com toggle Chat|Planejar e modelo como texto, streaming
 * com linha de raciocínio ("pensando…"), markdown com chips clicáveis,
 * menções @elemento, comandos /, fantasma das propostas no editor 2D,
 * conversa persistente e painel redimensionável.
 */

const LS_WIDTH = 'hyperframe.copilot.width'

const SLASH_COMMANDS = [
  {
    cmd: '/verificar',
    label: 'Verificar consistência',
    prompt:
      'Verifique a consistência do modelo e explique cada problema encontrado, do mais grave ao mais leve.',
  },
  {
    cmd: '/analisar',
    label: 'Rodar análise',
    prompt:
      'Rode a análise completa e me dê um resumo executivo: estabilidade global, elementos reprovados ou em atenção, e o que você atacaria primeiro.',
  },
  {
    cmd: '/otimizar',
    label: 'Otimizar seções',
    prompt:
      'Analise o modelo e proponha otimizações de seções (pilares, vigas, lajes) priorizando economia de concreto e aço sem reprovar nenhuma verificação. Apresente um plano antes de mudar qualquer coisa.',
  },
  {
    cmd: '/explicar',
    label: 'Explicar resultados',
    prompt:
      'Explique os resultados da última análise em linguagem acessível: o que está bom, o que preocupa e por quê.',
  },
] as const

const SUGGESTIONS = [
  'Confira a consistência e rode a análise',
  'Por que o γz está alto? O que você sugere?',
  'Quais vigas estão mais folgadas? Dá pra reduzir?',
] as const

export default function CopilotPanel({ onClose }: { onClose: () => void }) {
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const selection = useStore((s) => s.selection)
  const aiGhost = useStore((s) => s.aiGhost)
  const [entries, setEntries] = useState<ChatEntry[]>([])
  const [approval, setApproval] = useState<PendingApproval | null>(null)
  const [busy, setBusy] = useState(false)
  const [thinking, setThinking] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [caret, setCaret] = useState(0)
  const [planMode, setPlanMode] = useState(false)
  const [includeSelection, setIncludeSelection] = useState(true)
  const [popupIdx, setPopupIdx] = useState(0)
  const [cfgTick, setCfgTick] = useState(0)
  const [localModels, setLocalModels] = useState<string[]>([])
  const [localUp, setLocalUp] = useState(true)
  const [width, setWidth] = useState(() =>
    Math.min(680, Math.max(340, Number(localStorage.getItem(LS_WIDTH) ?? '440') || 440)),
  )
  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  // re-lê a configuração quando as configurações fecham
  useEffect(() => {
    if (!settingsOpen) setCfgTick((t) => t + 1)
  }, [settingsOpen])

  const kind = getProviderKind()

  // modelos locais instalados (p/ o seletor do composer)
  useEffect(() => {
    if (kind !== 'local') return
    let alive = true
    void (async () => {
      const st = await ollamaStatus()
      if (!alive) return
      setLocalUp(st.running)
      if (st.running) {
        const models = await listOllamaModels().catch(() => [])
        if (alive) setLocalModels(models.map((m) => m.name))
      }
    })()
    return () => {
      alive = false
    }
  }, [kind, cfgTick])

  // sessão única: a conversa sobrevive a fechar/reabrir o painel
  const agent: CopilotAgent | null = useMemo(
    () =>
      getCopilotSession({
        onEntries: setEntries,
        onApproval: setApproval,
        onBusy: setBusy,
        onThinking: setThinking,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cfgTick],
  )

  useEffect(() => {
    if (agent) agent.planMode = planMode
  }, [agent, planMode])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [entries, approval, thinking])

  // autogrow do textarea
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 150)}px`
  }, [input])

  const ready = agent !== null && (kind === 'claude' || localUp)
  const selName = selection ? describeSelection() : null
  const empty = entries.length === 0

  // ---- popups do composer (menção @ e comandos /) ----
  const mentionables = useMemo(() => listMentionables(), [entries.length, cfgTick])
  const mq = mentionQueryAt(input, caret)
  const mentionMatches = mq
    ? mentionables
        .filter((m) => m.name.toLowerCase().startsWith(mq.query.toLowerCase()))
        .slice(0, 8)
    : []
  const slashMatches =
    input.startsWith('/') && !input.includes(' ')
      ? SLASH_COMMANDS.filter((c) => c.cmd.startsWith(input.toLowerCase()))
      : []
  const popup: 'mention' | 'slash' | null =
    mentionMatches.length > 0 ? 'mention' : slashMatches.length > 0 ? 'slash' : null

  useEffect(() => setPopupIdx(0), [mq?.query, input.startsWith('/')])

  const insertMention = (name: string) => {
    if (!mq) return
    const next = `${input.slice(0, mq.start)}@${name} ${input.slice(caret)}`
    setInput(next)
    const pos = mq.start + name.length + 2
    requestAnimationFrame(() => {
      taRef.current?.focus()
      taRef.current?.setSelectionRange(pos, pos)
      setCaret(pos)
    })
  }

  const applySlash = (cmd: (typeof SLASH_COMMANDS)[number]) => {
    setInput(cmd.prompt)
    requestAnimationFrame(() => taRef.current?.focus())
  }

  const send = () => {
    const text = input.trim()
    if (!text || !agent || busy || !ready) return
    const names = extractMentions(
      text,
      mentionables.map((m) => m.name),
    )
    const ctx: string[] = []
    if (names.length > 0) ctx.push(`Elementos mencionados pelo usuário:\n${describeElementsByName(names)}`)
    if (includeSelection && selName) ctx.push(`Elemento selecionado no canvas: ${selName}`)
    setInput('')
    void agent.send(text, describeToolCall, ctx.length > 0 ? ctx.join('\n\n') : undefined)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (popup) {
      const n = popup === 'mention' ? mentionMatches.length : slashMatches.length
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setPopupIdx((i) => (i + 1) % n)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setPopupIdx((i) => (i - 1 + n) % n)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        if (popup === 'mention') insertMention(mentionMatches[popupIdx].name)
        else applySlash(slashMatches[popupIdx])
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  // ---- redimensionar arrastando a borda esquerda ----
  const onResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const zoom = getUiZoom()
    const move = (ev: PointerEvent) => {
      const w = Math.min(680, Math.max(340, (window.innerWidth - ev.clientX) / zoom))
      setWidth(w)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setWidth((w) => {
        localStorage.setItem(LS_WIDTH, String(Math.round(w)))
        return w
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width,
        maxWidth: '92vw',
        background: 'var(--bg-1)',
        borderLeft: '1px solid var(--border-strong)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 60,
        boxShadow: '-8px 0 24px rgba(0,0,0,0.35)',
      }}
    >
      <style>{`
        @keyframes hf-think-pulse { 0%,100% { opacity: .25 } 50% { opacity: 1 } }
        .hf-think-dot { width:5px;height:5px;border-radius:50%;background:var(--accent-fill);display:inline-block;animation:hf-think-pulse 1.2s ease-in-out infinite }
        .hf-msg-action { background:none;border:none;cursor:pointer;color:var(--text-dim);opacity:.55;font-size:13px;padding:2px 4px;border-radius:5px }
        .hf-msg-action:hover { opacity:1;background:var(--bg-2) }
      `}</style>

      {/* alça de redimensionamento */}
      <div
        onPointerDown={onResizeStart}
        title="Arraste para redimensionar"
        style={{ position: 'absolute', left: -3, top: 0, bottom: 0, width: 7, cursor: 'col-resize', zIndex: 61 }}
      />

      {/* cabeçalho */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          borderBottom: empty ? 'none' : '1px solid var(--border)',
          flex: 'none',
        }}
      >
        <strong style={{ fontSize: 13, fontFamily: 'var(--display)' }}>Copiloto</strong>
        <div style={{ flex: 1 }} />
        <button className="btn-icon" title="Nova conversa" onClick={() => agent?.clear()}>
          ↺
        </button>
        <button className="btn-icon" title="Fechar" onClick={onClose}>
          <IconClose />
        </button>
      </div>

      {/* mensagens */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px 16px',
          display: empty && ready ? 'flex' : undefined,
          flexDirection: 'column',
          justifyContent: empty && ready ? 'center' : undefined,
        }}
      >
        {!ready ? (
          <SetupHint kind={kind} localUp={localUp} onOpenSettings={() => setSettingsOpen(true)} />
        ) : empty ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, paddingBottom: 40 }}>
            <div
              style={{
                fontFamily: 'var(--display)',
                fontSize: 26,
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <span style={{ color: 'var(--accent-fill)', fontSize: 28 }}>✳</span> Vamos calcular
            </div>
            <div className="faint" style={{ fontSize: 11.5, textAlign: 'center', lineHeight: 1.5, maxWidth: 300 }}>
              {kind === 'local' ? (
                <>
                  <span className="chip ok">local</span> {getLocalModel()} — privado e offline
                </>
              ) : (
                <>Lê, planeja e edita o modelo — toda mudança passa por você.</>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 14, alignItems: 'center' }}>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setInput(s)
                    taRef.current?.focus()
                  }}
                  style={{
                    fontSize: 12,
                    padding: '5px 12px',
                    background: 'transparent',
                    border: 'none',
                    borderRadius: 100,
                    cursor: 'pointer',
                    color: 'var(--text-dim)',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          entries.map((e, i) => (
            <Entry
              key={e.id}
              e={e}
              isLast={i === entries.length - 1}
              busy={busy}
              onRetry={() => agent?.retry(describeToolCall)}
            />
          ))
        )}

        {approval && (
          <div
            style={{
              border: '1px solid var(--accent)',
              borderRadius: 12,
              padding: 12,
              marginTop: 8,
              fontSize: 12.5,
              background: 'var(--bg-2)',
            }}
          >
            <div style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="chip warn">aprovação</span>
              <span className="mono muted" style={{ fontSize: 11 }}>
                {approval.name}
              </span>
            </div>
            <div style={{ marginBottom: 6 }}>{approval.description}</div>
            {aiGhost && (
              <div className="faint" style={{ fontSize: 11, marginBottom: 8 }}>
                ✨ pré-visualização tracejada no editor 2D
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => approval.resolve(true)}>
                Aprovar
              </button>
              <button
                className="btn"
                style={{ fontSize: 12, color: 'var(--err)' }}
                onClick={() => approval.resolve(false)}
              >
                Recusar
              </button>
            </div>
          </div>
        )}

        {/* linha de raciocínio — estilo app do Claude */}
        {busy && !approval && !entries.some((e) => e.streaming) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, minHeight: 18 }}>
            <span style={{ display: 'inline-flex', gap: 3, flex: 'none' }}>
              <span className="hf-think-dot" />
              <span className="hf-think-dot" style={{ animationDelay: '0.4s' }} />
            </span>
            <span
              className="faint"
              style={{
                fontSize: 11.5,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                direction: 'rtl',
                textAlign: 'left',
              }}
            >
              {thinking ? thinking.replace(/\s+/g, ' ').slice(-120) : 'Pensando…'}
            </span>
          </div>
        )}
      </div>

      {/* composer */}
      <div style={{ padding: '8px 14px 8px', flex: 'none' }}>
        {/* chip de contexto: seleção atual */}
        {ready && selName && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <button
              type="button"
              title={
                includeSelection
                  ? 'Seleção enviada como contexto — clique para remover'
                  : 'Clique para incluir a seleção como contexto'
              }
              onClick={() => setIncludeSelection((v) => !v)}
              className="mono"
              style={{
                fontSize: 10.5,
                padding: '2px 9px',
                borderRadius: 100,
                border: '1px solid var(--border)',
                background: includeSelection ? 'var(--bg-2)' : 'transparent',
                color: 'var(--text-dim)',
                cursor: 'pointer',
                textDecoration: includeSelection ? 'none' : 'line-through',
              }}
            >
              📎 {selName}
            </button>
          </div>
        )}

        <div style={{ position: 'relative' }}>
          {/* popup de menção / comandos */}
          {ready && popup && (
            <div
              style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                right: 0,
                marginBottom: 8,
                background: 'var(--bg-2)',
                border: '1px solid var(--border-strong)',
                borderRadius: 14,
                overflow: 'hidden',
                boxShadow: '0 -6px 24px rgba(0,0,0,0.3)',
                zIndex: 5,
                padding: '6px 0',
              }}
            >
              <div
                className="faint"
                style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, padding: '4px 14px 6px' }}
              >
                {popup === 'mention' ? 'Elementos do projeto' : 'Comandos'}
              </div>
              {popup === 'mention'
                ? mentionMatches.map((m, i) => (
                    <PopupRow key={`${m.kind}:${m.name}`} active={i === popupIdx} onClick={() => insertMention(m.name)}>
                      <b className="mono" style={{ fontSize: 11.5 }}>
                        {m.name}
                      </b>{' '}
                      <span className="faint" style={{ fontSize: 11 }}>
                        {m.detail}
                      </span>
                    </PopupRow>
                  ))
                : slashMatches.map((c, i) => (
                    <PopupRow key={c.cmd} active={i === popupIdx} onClick={() => applySlash(c)}>
                      <b className="mono" style={{ fontSize: 11.5 }}>
                        {c.cmd}
                      </b>{' '}
                      <span className="faint" style={{ fontSize: 11 }}>
                        {c.label}
                      </span>
                    </PopupRow>
                  ))}
            </div>
          )}

          <div
            style={{
              border: '1px solid var(--border-strong)',
              borderRadius: 16,
              background: 'var(--bg-2)',
              padding: '10px 12px 8px',
            }}
          >
            <textarea
              ref={taRef}
              rows={1}
              style={{
                width: '100%',
                resize: 'none',
                border: 'none',
                outline: 'none',
                background: 'transparent',
                color: 'inherit',
                fontSize: 13,
                fontFamily: 'var(--sans)',
                lineHeight: 1.45,
                maxHeight: 150,
              }}
              placeholder={ready ? 'Como posso ajudar no seu projeto?' : 'Configure o copiloto primeiro'}
              disabled={!ready}
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                setCaret(e.target.selectionStart ?? e.target.value.length)
              }}
              onKeyUp={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
              onClick={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
              onKeyDown={onKeyDown}
            />
            {/* barra inferior do composer */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <button
                type="button"
                title="Mencionar elemento do projeto"
                onClick={() => {
                  setInput((v) => `${v}@`)
                  requestAnimationFrame(() => {
                    taRef.current?.focus()
                    const pos = (taRef.current?.value.length ?? 1)
                    taRef.current?.setSelectionRange(pos, pos)
                    setCaret(pos)
                  })
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-dim)',
                  fontSize: 17,
                  cursor: 'pointer',
                  padding: '0 2px',
                  lineHeight: 1,
                }}
              >
                +
              </button>
              {/* toggle segmentado Chat | Planejar */}
              <div
                style={{
                  display: 'flex',
                  border: '1px solid var(--border)',
                  borderRadius: 9,
                  padding: 2,
                  gap: 2,
                }}
              >
                {(
                  [
                    ['Chat', false],
                    ['Planejar', true],
                  ] as const
                ).map(([label, mode]) => (
                  <button
                    key={label}
                    type="button"
                    title={
                      mode
                        ? 'Modo planejamento: só lê o modelo e propõe um plano — nenhuma modificação'
                        : 'Modo chat: pode propor mudanças (com sua aprovação)'
                    }
                    onClick={() => setPlanMode(mode)}
                    style={{
                      fontSize: 11,
                      padding: '3px 10px',
                      borderRadius: 7,
                      border: 'none',
                      cursor: 'pointer',
                      background: planMode === mode ? 'var(--border)' : 'transparent',
                      color: planMode === mode ? 'inherit' : 'var(--text-dim)',
                      fontWeight: planMode === mode ? 600 : 400,
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div style={{ flex: 1 }} />
              {/* modelo como texto, estilo app do Claude */}
              {kind === 'claude' ? (
                <select
                  value={getModel()}
                  onChange={(e) => {
                    persistModel(e.target.value)
                    setCfgTick((t) => t + 1)
                  }}
                  title="Modelo Claude (a conversa continua)"
                  style={{
                    appearance: 'none',
                    WebkitAppearance: 'none',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-dim)',
                    fontSize: 11.5,
                    fontFamily: 'var(--sans)',
                    cursor: 'pointer',
                    textAlign: 'right',
                    outline: 'none',
                  }}
                >
                  {COPILOT_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label.replace(/ \(.*\)/, '')}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  value={getLocalModel()}
                  onChange={(e) => {
                    persistLocalModel(e.target.value)
                    setCfgTick((t) => t + 1)
                  }}
                  title="Modelo local (Ollama)"
                  style={{
                    appearance: 'none',
                    WebkitAppearance: 'none',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-dim)',
                    fontSize: 11.5,
                    maxWidth: 130,
                    cursor: 'pointer',
                    textAlign: 'right',
                    outline: 'none',
                  }}
                >
                  {getLocalModel() && !localModels.includes(getLocalModel()) && (
                    <option value={getLocalModel()}>{getLocalModel()}</option>
                  )}
                  {localModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              )}
              {busy ? (
                <button
                  onClick={() => agent?.stop()}
                  title="Parar"
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 9,
                    border: 'none',
                    background: 'var(--err)',
                    color: '#fff',
                    fontSize: 11,
                    cursor: 'pointer',
                    flex: 'none',
                  }}
                >
                  ■
                </button>
              ) : (
                <button
                  disabled={!ready || !input.trim()}
                  onClick={send}
                  title="Enviar (Enter)"
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 9,
                    border: 'none',
                    background: !ready || !input.trim() ? 'var(--border)' : 'var(--accent-fill)',
                    color: !ready || !input.trim() ? 'var(--text-dim)' : 'var(--accent-fg)',
                    fontSize: 15,
                    fontWeight: 700,
                    cursor: !ready || !input.trim() ? 'default' : 'pointer',
                    flex: 'none',
                  }}
                >
                  ↑
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="faint" style={{ fontSize: 10, marginTop: 5, textAlign: 'center' }}>
          Mudanças exigem aprovação · ⌘Z desfaz · IA pode errar — revise como eng. responsável.
        </div>
      </div>
    </div>
  )
}

function PopupRow({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault()
        onClick()
      }}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '7px 14px',
        background: active ? 'var(--accent-soft)' : 'transparent',
        border: 'none',
        cursor: 'pointer',
        color: 'inherit',
      }}
    >
      {children}
    </button>
  )
}

function SetupHint({
  kind,
  localUp,
  onOpenSettings,
}: {
  kind: 'claude' | 'local'
  localUp: boolean
  onOpenSettings: () => void
}) {
  return (
    <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>
      {kind === 'claude' ? (
        <>
          <p style={{ marginTop: 0 }}>
            O Copiloto usa a API do Claude para <strong>ler, planejar e editar</strong> seu modelo
            estrutural — com aprovação manual de cada mudança.
          </p>
          <ol style={{ paddingLeft: 18, margin: '8px 0' }}>
            <li>
              Crie uma chave em <span className="mono">console.anthropic.com</span>
            </li>
            <li>Cole em Configurações → Copiloto IA</li>
          </ol>
        </>
      ) : !localUp ? (
        <>
          <p style={{ marginTop: 0 }}>
            Modo <strong>local</strong> selecionado, mas o Ollama não está rodando.
          </p>
          <p>
            Inicie com <span className="mono">ollama serve</span> (ou abra o app do Ollama) e volte
            aqui. Sem Ollama? <span className="mono">brew install ollama</span> ou ollama.com.
          </p>
        </>
      ) : (
        <>
          <p style={{ marginTop: 0 }}>
            Modo <strong>local</strong> ativo, mas nenhum modelo selecionado.
          </p>
          <p>Baixe/escolha um modelo em Configurações → Copiloto IA (ex.: qwen3:8b).</p>
        </>
      )}
      <button className="btn btn-primary" style={{ marginTop: 6 }} onClick={onOpenSettings}>
        Abrir configurações
      </button>
      <p className="faint" style={{ fontSize: 11 }}>
        Claude (API): melhor qualidade. Local (Ollama): grátis, offline e privado — mais fraco com
        ferramentas. Nada disso entra no arquivo do projeto.
      </p>
    </div>
  )
}

function Entry({
  e,
  isLast,
  busy,
  onRetry,
}: {
  e: ChatEntry
  isLast: boolean
  busy: boolean
  onRetry: () => void
}) {
  if (e.role === 'tool') {
    return (
      <div style={{ margin: '4px 0', fontSize: 11.5 }} className="mono">
        <span className={`chip ${e.pending ? 'warn' : 'ok'}`}>{e.pending ? '…' : '✓'}</span>{' '}
        <span className="muted">{e.text}</span>
      </div>
    )
  }
  if (e.role === 'error') {
    return <div style={{ margin: '8px 0', fontSize: 12.5, color: 'var(--err)' }}>{e.text}</div>
  }
  if (e.role === 'user') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '12px 0' }}>
        <div
          style={{
            maxWidth: '85%',
            fontSize: 12.5,
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            background: 'var(--bg-2)',
            borderRadius: '16px 16px 5px 16px',
            padding: '8px 13px',
          }}
        >
          {e.text}
        </div>
      </div>
    )
  }
  // assistente — serifa, estilo app do Claude
  return (
    <div
      style={{
        margin: '12px 0',
        fontSize: 13.5,
        lineHeight: 1.6,
        fontFamily: "Georgia, 'Times New Roman', serif",
      }}
    >
      <Markdown text={e.text} />
      {e.streaming && (
        <span
          style={{
            display: 'inline-block',
            width: 7,
            height: 13,
            background: 'var(--accent)',
            marginLeft: 2,
            verticalAlign: 'text-bottom',
          }}
        />
      )}
      {!e.streaming && (
        <div style={{ display: 'flex', gap: 2, marginTop: 4, fontFamily: 'var(--sans)' }}>
          <button
            type="button"
            className="hf-msg-action"
            title="Copiar resposta"
            onClick={() => void navigator.clipboard.writeText(e.text).catch(() => {})}
          >
            ⧉
          </button>
          {isLast && !busy && (
            <button
              type="button"
              className="hf-msg-action"
              title="Regenerar (mudanças já aplicadas permanecem — ⌘Z desfaz)"
              onClick={onRetry}
            >
              ↻
            </button>
          )}
        </div>
      )}
    </div>
  )
}
