/**
 * Markdown mínimo do Copiloto — parser PURO (testável em node, zero deps).
 * Suporta: títulos (#..###), listas -/* e numeradas, blocos ``` , parágrafos;
 * inline: **negrito**, *itálico*, `código` e referência a elemento (P3/V2/L7),
 * que a UI transforma em chip clicável.
 */

export type Inline =
  | { t: 'text'; text: string }
  | { t: 'bold'; text: string }
  | { t: 'italic'; text: string }
  | { t: 'code'; text: string }
  | { t: 'elem'; name: string }

export type Block =
  | { t: 'p'; inlines: Inline[] }
  | { t: 'h'; level: number; inlines: Inline[] }
  | { t: 'ul'; items: Inline[][] }
  | { t: 'ol'; items: Inline[][] }
  | { t: 'codeblock'; text: string }

/** nomes de elementos do HyperFrame: P1, V12, L3 (pilar/viga/laje) */
const ELEM_RE = /\b([PVL]\d{1,3})\b/

export function parseInlines(src: string): Inline[] {
  const out: Inline[] = []
  let rest = src
  // tokens em ordem de prioridade: código, negrito, itálico, elemento
  const patterns: { re: RegExp; make: (m: RegExpMatchArray) => Inline }[] = [
    { re: /`([^`]+)`/, make: (m) => ({ t: 'code', text: m[1] }) },
    { re: /\*\*([^*]+)\*\*/, make: (m) => ({ t: 'bold', text: m[1] }) },
    { re: /\*([^*]+)\*/, make: (m) => ({ t: 'italic', text: m[1] }) },
    { re: ELEM_RE, make: (m) => ({ t: 'elem', name: m[1] }) },
  ]
  while (rest.length > 0) {
    let best: { idx: number; len: number; inline: Inline } | null = null
    for (const p of patterns) {
      const m = rest.match(p.re)
      if (m && m.index !== undefined && (!best || m.index < best.idx)) {
        best = { idx: m.index, len: m[0].length, inline: p.make(m) }
      }
    }
    if (!best) {
      out.push({ t: 'text', text: rest })
      break
    }
    if (best.idx > 0) out.push({ t: 'text', text: rest.slice(0, best.idx) })
    out.push(best.inline)
    rest = rest.slice(best.idx + best.len)
  }
  return out
}

export function parseMd(src: string): Block[] {
  const blocks: Block[] = []
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '') {
      i++
      continue
    }
    // bloco de código
    if (line.trimStart().startsWith('```')) {
      const buf: string[] = []
      i++
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        buf.push(lines[i])
        i++
      }
      i++ // fecha ```
      blocks.push({ t: 'codeblock', text: buf.join('\n') })
      continue
    }
    // título
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      blocks.push({ t: 'h', level: h[1].length, inlines: parseInlines(h[2]) })
      i++
      continue
    }
    // lista com marcador
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: Inline[][] = []
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(parseInlines(lines[i].replace(/^\s*[-*•]\s+/, '')))
        i++
      }
      blocks.push({ t: 'ul', items })
      continue
    }
    // lista numerada
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: Inline[][] = []
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(parseInlines(lines[i].replace(/^\s*\d+[.)]\s+/, '')))
        i++
      }
      blocks.push({ t: 'ol', items })
      continue
    }
    // parágrafo (agrupa linhas até a próxima em branco/estrutura)
    const buf: string[] = [line]
    i++
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^\s*[-*•]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i]) &&
      !/^#{1,4}\s+/.test(lines[i]) &&
      !lines[i].trimStart().startsWith('```')
    ) {
      buf.push(lines[i])
      i++
    }
    blocks.push({ t: 'p', inlines: parseInlines(buf.join('\n')) })
  }
  return blocks
}

// ---------------------------------------------------------------------------
// menções @elemento — helpers puros do composer
// ---------------------------------------------------------------------------

/** token @… sendo digitado imediatamente antes do cursor (null = nenhum) */
export function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const upto = text.slice(0, caret)
  const m = upto.match(/@([\p{L}\p{N} _-]{0,24})$/u)
  if (!m || m.index === undefined) return null
  // @ precisa estar no início ou após espaço/pontuação
  if (m.index > 0 && !/[\s(,;:]/.test(upto[m.index - 1])) return null
  return { start: m.index, query: m[1] }
}

/** nomes conhecidos citados como @Nome no texto (sem duplicatas, ordem de aparição) */
export function extractMentions(text: string, known: string[]): string[] {
  const out: string[] = []
  const lower = new Map(known.map((n) => [n.toLowerCase(), n]))
  for (const m of text.matchAll(/@([\p{L}\p{N} _-]+)/gu)) {
    // tenta casar o nome mais longo possível (plantas têm espaço: "Pavimento Tipo")
    const raw = m[1]
    for (let end = raw.length; end > 0; end--) {
      const cand = raw.slice(0, end).trim().toLowerCase()
      const hit = lower.get(cand)
      if (hit) {
        if (!out.includes(hit)) out.push(hit)
        break
      }
    }
  }
  return out
}
