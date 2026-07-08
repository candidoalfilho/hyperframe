import { useState, type CSSProperties } from 'react'
import { fmtInput, parseNum } from './format'

/**
 * Input numérico padrão do HyperFrame:
 *  - estado local em string; commit no blur E no Enter; Esc/inv. reverte
 *  - exibe vírgula decimal; aceita vírgula OU ponto ao interpretar
 */

interface BaseProps {
  digits?: number
  /** remove zeros finais na exibição (padrão true) */
  trim?: boolean
  min?: number
  max?: number
  disabled?: boolean
  style?: CSSProperties
  className?: string
  title?: string
  placeholder?: string
}

interface NumberFieldProps extends BaseProps {
  value: number
  onCommit: (v: number) => void
}

export function NumberField({
  value,
  onCommit,
  digits = 2,
  trim = true,
  min,
  max,
  disabled,
  style,
  className,
  title,
  placeholder,
}: NumberFieldProps) {
  const [text, setText] = useState<string | null>(null)

  const commit = () => {
    if (text === null) return
    const n = parseNum(text)
    setText(null)
    if (n === null) return // inválido → reverte
    if (min !== undefined && n < min) return
    if (max !== undefined && n > max) return
    if (n !== value) onCommit(n)
  }

  return (
    <input
      className={className ? `input ${className}` : 'input'}
      style={style}
      title={title}
      placeholder={placeholder}
      disabled={disabled}
      inputMode="decimal"
      spellCheck={false}
      value={text ?? fmtInput(value, digits, trim)}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur() // blur dispara o commit
        } else if (e.key === 'Escape') {
          setText(null)
          e.currentTarget.blur()
        }
      }}
    />
  )
}

interface OptionalNumberFieldProps extends BaseProps {
  value: number | undefined
  /** campo vazio → undefined */
  onCommit: (v: number | undefined) => void
}

/** Variante opcional: vazio = "automático" (undefined). */
export function OptionalNumberField({
  value,
  onCommit,
  digits = 2,
  trim = true,
  min,
  max,
  disabled,
  style,
  className,
  title,
  placeholder,
}: OptionalNumberFieldProps) {
  const [text, setText] = useState<string | null>(null)

  const commit = () => {
    if (text === null) return
    const raw = text.trim()
    setText(null)
    if (!raw) {
      if (value !== undefined) onCommit(undefined)
      return
    }
    const n = parseNum(raw)
    if (n === null) return
    if (min !== undefined && n < min) return
    if (max !== undefined && n > max) return
    if (n !== value) onCommit(n)
  }

  return (
    <input
      className={className ? `input ${className}` : 'input'}
      style={style}
      title={title}
      placeholder={placeholder}
      disabled={disabled}
      inputMode="decimal"
      spellCheck={false}
      value={text ?? (value === undefined ? '' : fmtInput(value, digits, trim))}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          setText(null)
          e.currentTarget.blur()
        }
      }}
    />
  )
}
