import { useEffect, useRef, useState } from 'react'

/**
 * Prompt de nome (modal) chamável de código assíncrono — `askName()` devolve
 * o texto digitado ou null (cancelado). `<NamePromptHost />` precisa estar
 * montado uma vez na raiz.
 */

interface Pending {
  title: string
  label: string
  initial: string
  resolve: (v: string | null) => void
}

let show: ((p: Pending) => void) | null = null

export function askName(title: string, label: string, initial: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (!show) {
      // host não montado (não deveria acontecer) — cai no prompt do navegador
      const v = window.prompt(title, initial)
      resolve(v?.trim() ? v.trim() : null)
      return
    }
    show({ title, label, initial, resolve })
  })
}

export function NamePromptHost() {
  const [pending, setPending] = useState<Pending | null>(null)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    show = (p) => {
      setValue(p.initial)
      setPending(p)
    }
    return () => {
      show = null
    }
  }, [])

  useEffect(() => {
    if (pending) inputRef.current?.select()
  }, [pending])

  if (!pending) return null
  const close = (v: string | null) => {
    pending.resolve(v)
    setPending(null)
  }
  const ok = () => {
    const v = value.trim()
    if (v) close(v)
  }

  return (
    <div className="modal-overlay" onClick={() => close(null)}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">{pending.title}</div>
        <div className="modal-body">
          <div className="field">
            <label className="label">{pending.label}</label>
            <input
              ref={inputRef}
              className="input"
              style={{ width: '100%' }}
              value={value}
              spellCheck={false}
              autoFocus
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') ok()
                else if (e.key === 'Escape') close(null)
                e.stopPropagation()
              }}
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={() => close(null)}>
            Cancelar
          </button>
          <button className="btn btn-primary" disabled={!value.trim()} onClick={ok}>
            Salvar
          </button>
        </div>
      </div>
    </div>
  )
}
