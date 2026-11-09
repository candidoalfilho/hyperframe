import { memo, type ReactNode } from 'react'
import { parseMd, type Inline } from './md'
import { selectElementByName } from './tools'

/**
 * Renderer do markdown do Copiloto. Nomes de elementos (P3/V2/L7) viram chips
 * clicáveis que selecionam o elemento no canvas (e trocam de nível se preciso).
 */

function InlineSpan({ inl, i }: { inl: Inline; i: number }) {
  switch (inl.t) {
    case 'bold':
      return <strong key={i}>{inl.text}</strong>
    case 'italic':
      return <em key={i}>{inl.text}</em>
    case 'code':
      return (
        <code
          key={i}
          className="mono"
          style={{
            background: 'var(--bg-3, var(--bg-2))',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: '0 4px',
            fontSize: '0.92em',
          }}
        >
          {inl.text}
        </code>
      )
    case 'elem':
      return (
        <button
          key={i}
          type="button"
          className="mono"
          title={`Selecionar ${inl.name} no canvas`}
          onClick={() => selectElementByName(inl.name)}
          style={{
            background: 'var(--accent-soft)',
            color: 'var(--accent-dim)',
            border: '1px solid var(--accent-dim)',
            borderRadius: 5,
            padding: '0 5px',
            fontSize: '0.88em',
            fontWeight: 600,
            cursor: 'pointer',
            verticalAlign: 'baseline',
          }}
        >
          {inl.name}
        </button>
      )
    default:
      return <span key={i}>{inl.text}</span>
  }
}

const renderInlines = (inls: Inline[]): ReactNode =>
  inls.map((inl, i) => <InlineSpan key={i} inl={inl} i={i} />)

export default memo(function Markdown({ text }: { text: string }) {
  const blocks = parseMd(text)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'h':
            return (
              <div key={i} style={{ fontWeight: 700, fontSize: b.level <= 2 ? 14 : 13 }}>
                {renderInlines(b.inlines)}
              </div>
            )
          case 'ul':
            return (
              <ul key={i} style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {b.items.map((it, j) => (
                  <li key={j}>{renderInlines(it)}</li>
                ))}
              </ul>
            )
          case 'ol':
            return (
              <ol key={i} style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {b.items.map((it, j) => (
                  <li key={j}>{renderInlines(it)}</li>
                ))}
              </ol>
            )
          case 'codeblock':
            return (
              <pre
                key={i}
                className="mono"
                style={{
                  margin: 0,
                  padding: '8px 10px',
                  background: 'var(--bg-3, var(--bg-2))',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  fontSize: 11.5,
                  overflowX: 'auto',
                  whiteSpace: 'pre',
                }}
              >
                {b.text}
              </pre>
            )
          default:
            return (
              <p key={i} style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                {renderInlines(b.inlines)}
              </p>
            )
        }
      })}
    </div>
  )
})
