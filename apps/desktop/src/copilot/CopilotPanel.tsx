import { useEffect, useMemo, useRef, useState } from 'react'
import {
  COPILOT_MODELS,
  CopilotAgent,
  buildProvider,
  getLocalModel,
  getModel,
  getProviderKind,
  setLocalModel as persistLocalModel,
  setModel as persistModel,
  type ChatEntry,
  type PendingApproval,
} from './agent'
import { describeToolCall } from './tools'
import { listOllamaModels, ollamaStatus } from './ollama'
import { useStore } from '../store'
import { IconClose } from '../components/Icons'

/**
 * Painel do Copiloto IA: chat com aprovações manuais (estilo Claude Code),
 * modo planejamento e dois provedores — Claude (API) ou modelos locais
 * (Ollama), configurados em Configurações → Copiloto IA.
 */
export default function CopilotPanel({ onClose }: { onClose: () => void }) {
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const [entries, setEntries] = useState<ChatEntry[]>([])
  const [approval, setApproval] = useState<PendingApproval | null>(null)
  const [busy, setBusy] = useState(false)
  const [input, setInput] = useState('')
  const [planMode, setPlanMode] = useState(false)
  const [cfgTick, setCfgTick] = useState(0)
  const [localModels, setLocalModels] = useState<string[]>([])
  const [localUp, setLocalUp] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  // re-lê a configuração quando as configurações fecham
  useEffect(() => {
    if (!settingsOpen) setCfgTick((t) => t + 1)
  }, [settingsOpen])

  const kind = getProviderKind()

  // modelos locais instalados (p/ o seletor do cabeçalho)
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

  const agent = useMemo(() => {
    const provider = buildProvider()
    if (!provider) return null
    return new CopilotAgent(provider, {
      onEntries: setEntries,
      onApproval: setApproval,
      onBusy: setBusy,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfgTick])

  useEffect(() => {
    if (agent) agent.planMode = planMode
  }, [agent, planMode])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [entries, approval])

  const ready = agent !== null && (kind === 'claude' || localUp)

  const send = () => {
    const text = input.trim()
    if (!text || !agent || busy || !ready) return
    setInput('')
    void agent.send(text, describeToolCall)
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 400,
        maxWidth: '90vw',
        background: 'var(--bg-1)',
        borderLeft: '1px solid var(--border-strong)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 60,
        boxShadow: '-8px 0 24px rgba(0,0,0,0.35)',
      }}
    >
      {/* cabeçalho */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px',
          borderBottom: '1px solid var(--border)',
          flex: 'none',
        }}
      >
        <strong style={{ fontSize: 13 }}>✨ Copiloto</strong>
        {kind === 'claude' ? (
          <select
            className="select"
            style={{ fontSize: 11, maxWidth: 145 }}
            value={getModel()}
            onChange={(e) => {
              persistModel(e.target.value)
              setCfgTick((t) => t + 1)
            }}
            title="Modelo Claude (trocar reinicia a conversa)"
          >
            {COPILOT_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        ) : (
          <select
            className="select"
            style={{ fontSize: 11, maxWidth: 145 }}
            value={getLocalModel()}
            onChange={(e) => {
              persistLocalModel(e.target.value)
              setCfgTick((t) => t + 1)
            }}
            title="Modelo local (Ollama)"
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
        <label
          style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer' }}
          title="No modo planejamento o copiloto só lê o modelo e propõe um plano — nenhuma modificação"
        >
          <input type="checkbox" checked={planMode} onChange={(e) => setPlanMode(e.target.checked)} />
          Planejar
        </label>
        <div style={{ flex: 1 }} />
        <button
          className="btn-icon"
          title="Limpar conversa"
          onClick={() => {
            agent?.clear()
            setEntries([])
          }}
        >
          ↺
        </button>
        <button className="btn-icon" title="Fechar" onClick={onClose}>
          <IconClose />
        </button>
      </div>

      {/* mensagens */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {!ready ? (
          <SetupHint kind={kind} localUp={localUp} onOpenSettings={() => setSettingsOpen(true)} />
        ) : entries.length === 0 ? (
          <div className="faint" style={{ fontSize: 12, lineHeight: 1.6 }}>
            {kind === 'local' && (
              <div style={{ marginBottom: 8 }}>
                <span className="chip ok">local</span> rodando em {getLocalModel()} — privado e
                offline. Modelos locais são mais fracos com ferramentas que o Claude.
              </div>
            )}
            Exemplos:
            <br />• “Confira a consistência e rode a análise”
            <br />• “Por que o γz está alto? O que você sugere?”
            <br />• “Adicione um pilar 30×30 em (2; 6) e uma viga ligando P2 a ele”
            <br />• “Troque as lajes do tipo para nervuradas h=25”
          </div>
        ) : (
          entries.map((e) => <Entry key={e.id} e={e} />)
        )}

        {approval && (
          <div
            style={{
              border: '1px solid var(--accent)',
              borderRadius: 8,
              padding: 10,
              marginTop: 8,
              fontSize: 12.5,
              background: 'var(--bg-2)',
            }}
          >
            <div style={{ marginBottom: 6 }}>
              <span className="chip warn">aprovação</span>{' '}
              <span className="mono" style={{ fontSize: 11 }}>
                {approval.name}
              </span>
            </div>
            <div style={{ marginBottom: 8 }}>{approval.description}</div>
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
        {busy && !approval && (
          <div className="faint" style={{ fontSize: 11.5, marginTop: 8 }}>
            pensando…
          </div>
        )}
      </div>

      {/* entrada */}
      <div style={{ padding: 10, borderTop: '1px solid var(--border)', flex: 'none' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <textarea
            className="input"
            style={{ flex: 1, resize: 'none', height: 54, fontSize: 12.5, fontFamily: 'var(--sans)' }}
            placeholder={
              ready
                ? planMode
                  ? 'Peça um plano (modo planejamento — sem mudanças)…'
                  : 'Peça algo ao copiloto…'
                : 'Configure o copiloto primeiro'
            }
            disabled={!ready}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
          />
          {busy ? (
            <button className="btn" style={{ color: 'var(--err)' }} onClick={() => agent?.stop()} title="Parar">
              ■
            </button>
          ) : (
            <button className="btn btn-primary" disabled={!ready || !input.trim()} onClick={send}>
              ➤
            </button>
          )}
        </div>
        <div className="faint" style={{ fontSize: 10, marginTop: 4 }}>
          Mudanças exigem aprovação · desfazer com ⌘Z · IA pode errar — revise como eng. responsável.
        </div>
      </div>
    </div>
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

function Entry({ e }: { e: ChatEntry }) {
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
  return (
    <div
      style={{
        margin: '8px 0',
        fontSize: 12.5,
        lineHeight: 1.55,
        whiteSpace: 'pre-wrap',
        ...(e.role === 'user'
          ? {
              background: 'rgba(77,163,255,0.09)',
              border: '1px solid rgba(77,163,255,0.25)',
              borderRadius: 8,
              padding: '6px 9px',
            }
          : {}),
      }}
    >
      {e.text}
    </div>
  )
}
