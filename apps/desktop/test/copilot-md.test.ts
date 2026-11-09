import { describe, expect, it } from 'vitest'
import { extractMentions, mentionQueryAt, parseInlines, parseMd } from '../src/copilot/md'

describe('markdown do Copiloto — inlines', () => {
  it('negrito, itálico, código e texto', () => {
    expect(parseInlines('a **b** *c* `d` e')).toEqual([
      { t: 'text', text: 'a ' },
      { t: 'bold', text: 'b' },
      { t: 'text', text: ' ' },
      { t: 'italic', text: 'c' },
      { t: 'text', text: ' ' },
      { t: 'code', text: 'd' },
      { t: 'text', text: ' e' },
    ])
  })

  it('nomes de elementos viram chips (P3, V12, L1)', () => {
    const r = parseInlines('a viga V12 apoia em P3 e recebe L1')
    expect(r.filter((x) => x.t === 'elem').map((x) => (x.t === 'elem' ? x.name : ''))).toEqual([
      'V12',
      'P3',
      'L1',
    ])
  })

  it('não vira chip dentro de palavra (VAO10, SOLP1)', () => {
    expect(parseInlines('VAO10 não é elemento').some((x) => x.t === 'elem')).toBe(false)
  })
})

describe('markdown do Copiloto — blocos', () => {
  it('título, lista e parágrafo', () => {
    const b = parseMd('## Plano\n- item um\n- item dois\n\ntexto final')
    expect(b.map((x) => x.t)).toEqual(['h', 'ul', 'p'])
    expect(b[1].t === 'ul' && b[1].items.length).toBe(2)
  })

  it('lista numerada e bloco de código', () => {
    const b = parseMd('1. um\n2. dois\n```\ncódigo\n```')
    expect(b.map((x) => x.t)).toEqual(['ol', 'codeblock'])
    expect(b[1].t === 'codeblock' && b[1].text).toBe('código')
  })
})

describe('menções @ do composer', () => {
  it('detecta token @ sendo digitado no cursor', () => {
    expect(mentionQueryAt('mude @P', 7)).toEqual({ start: 5, query: 'P' })
    expect(mentionQueryAt('sem arroba', 10)).toBeNull()
    // e-mail não dispara menção (@ precisa vir após espaço/início)
    expect(mentionQueryAt('a@b', 3)).toBeNull()
  })

  it('extrai nomes conhecidos, inclusive com espaço, sem duplicar', () => {
    const known = ['P3', 'V12', 'Pavimento Tipo']
    expect(extractMentions('olhe @P3 e @Pavimento Tipo, depois @P3 de novo', known)).toEqual([
      'P3',
      'Pavimento Tipo',
    ])
    expect(extractMentions('nada aqui @X9', known)).toEqual([])
  })
})
