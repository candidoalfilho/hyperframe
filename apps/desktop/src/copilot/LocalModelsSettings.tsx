import { useEffect, useState } from 'react'
import {
  RECOMMENDED_LOCAL_MODELS,
  listOllamaModels,
  ollamaStatus,
  pullOllamaModel,
  type OllamaModelInfo,
} from './ollama'
import { getLocalModel, setLocalModel } from './agent'

/**
 * Gerenciador de modelos locais (Ollama) nas configurações: status do
 * servidor, modelos instalados (seleção do padrão) e recomendados com
 * download DENTRO do app (barra de progresso, cancelável).
 */
export default function LocalModelsSettings() {
  const [status, setStatus] = useState<{ running: boolean; version?: string } | null>(null)
  const [installed, setInstalled] = useState<OllamaModelInfo[]>([])
  const [selected, setSelected] = useState(getLocalModel())
  const [pulls, setPulls] = useState<Record<string, { pct: number; status: string }>>({})
  const [pullError, setPullError] = useState<string | null>(null)
  const [aborters] = useState(() => new Map<string, AbortController>())

  const refresh = async () => {
    const st = await ollamaStatus()
    setStatus(st)
    if (st.running) {
      setInstalled(await listOllamaModels().catch(() => []))
    }
  }

  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), 5000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startPull = (name: string) => {
    setPullError(null)
    const ctrl = new AbortController()
    aborters.set(name, ctrl)
    setPulls((p) => ({ ...p, [name]: { pct: 0, status: 'iniciando…' } }))
    void pullOllamaModel(
      name,
      (pct, st) => setPulls((p) => ({ ...p, [name]: { pct, status: st } })),
      ctrl.signal,
    )
      .then(async () => {
        setPulls((p) => {
          const next = { ...p }
          delete next[name]
          return next
        })
        await refresh()
        if (!getLocalModel()) {
          setLocalModel(name)
          setSelected(name)
        }
      })
      .catch((err) => {
        setPulls((p) => {
          const next = { ...p }
          delete next[name]
          return next
        })
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setPullError(`Falha ao baixar ${name}: ${err instanceof Error ? err.message : String(err)}`)
        }
      })
      .finally(() => aborters.delete(name))
  }

  if (status === null) {
    return <div className="faint" style={{ fontSize: 12 }}>verificando Ollama…</div>
  }

  if (!status.running) {
    return (
      <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>
        <span className="chip err">Ollama parado</span>
        <p style={{ margin: '8px 0 4px' }}>
          O modo local usa o <strong>Ollama</strong> (runtime gratuito de modelos abertos):
        </p>
        <ol style={{ paddingLeft: 18, margin: '4px 0' }}>
          <li>
            Instale: <span className="mono">brew install ollama</span> (ou ollama.com)
          </li>
          <li>
            Inicie: <span className="mono">ollama serve</span> (ou abra o app do Ollama)
          </li>
        </ol>
        <p className="faint" style={{ fontSize: 11 }}>
          Esta tela detecta o servidor automaticamente — os downloads de modelos acontecem aqui
          dentro do HyperFrame.
        </p>
      </div>
    )
  }

  return (
    <>
      <div style={{ fontSize: 12, marginBottom: 8 }}>
        <span className="chip ok">Ollama {status.version}</span>{' '}
        <span className="muted">rodando em localhost:11434 — tudo offline e privado</span>
      </div>

      {installed.length > 0 && (
        <div className="field">
          <label className="label">Modelo padrão (instalados)</label>
          <select
            className="select"
            style={{ width: '100%' }}
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value)
              setLocalModel(e.target.value)
            }}
          >
            {!selected && <option value="">— escolha —</option>}
            {installed.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name} ({m.sizeGb} GB)
              </option>
            ))}
          </select>
        </div>
      )}

      <label className="label">Modelos recomendados (com suporte a ferramentas)</label>
      {RECOMMENDED_LOCAL_MODELS.map((rm) => {
        const isInstalled = installed.some((m) => m.name === rm.name)
        const pull = pulls[rm.name]
        return (
          <div
            key={rm.name}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '5px 0',
              fontSize: 12,
              borderBottom: '1px solid var(--border)',
            }}
          >
            <span className="mono" style={{ width: 110, flex: 'none' }}>
              {rm.name}
            </span>
            <span className="muted" style={{ flex: 1 }}>
              {rm.sizeGb} GB — {rm.note}
            </span>
            {isInstalled ? (
              <span className="chip ok">instalado</span>
            ) : pull ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 90, height: 6, background: 'var(--bg-3)', borderRadius: 3 }}>
                  <span
                    style={{
                      display: 'block',
                      width: `${Math.max(pull.pct, 2)}%`,
                      height: '100%',
                      background: 'var(--accent)',
                      borderRadius: 3,
                      transition: 'width 0.3s',
                    }}
                  />
                </span>
                <span className="mono" style={{ fontSize: 10, width: 32 }}>
                  {pull.pct >= 0 ? `${pull.pct}%` : '…'}
                </span>
                <button
                  className="btn"
                  style={{ padding: '1px 6px', fontSize: 10, color: 'var(--err)' }}
                  onClick={() => aborters.get(rm.name)?.abort()}
                >
                  ✕
                </button>
              </span>
            ) : (
              <button className="btn" style={{ fontSize: 11 }} onClick={() => startPull(rm.name)}>
                Baixar
              </button>
            )}
          </div>
        )
      })}
      {pullError && (
        <div style={{ color: 'var(--err)', fontSize: 11.5, marginTop: 6 }}>{pullError}</div>
      )}
    </>
  )
}
