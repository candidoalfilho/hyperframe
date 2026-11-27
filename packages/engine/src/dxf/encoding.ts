/**
 * Codificação de texto do DXF (issue #28).
 *
 * DXF anterior ao AutoCAD 2007 — o R12 que o HyperFrame grava — não é UTF-8:
 * o texto vai na página de códigos do desenho ($DWGCODEPAGE, ANSI_1252 nos
 * Windows ocidentais). Gravado em UTF-8, "×" abre como "Ã—" e "φ" como "Ï†".
 *
 * Saída: o arquivo sai em bytes CP1252 com a página declarada no cabeçalho.
 * O que não existe na página é trocado antes: "φ" vira "Ø" (o símbolo de
 * diâmetro que o AutoCAD tem em qualquer fonte), letras gregas e sinais como
 * "≥" seguem a mesma transliteração do PDF, e o que sobrar vai como
 * `\U+XXXX`, a forma que o DXF define para caracteres fora da página.
 *
 * Entrada: um DXF de terceiros pode vir em CP1252 (o comum) ou em UTF-8
 * (AutoCAD 2007 em diante); `decodeDxfBytes` decide pelos bytes.
 */

import { CP1252, transliterate } from '../report/pdf'

/** byte CP1252 do caractere, ou null se a página não o tem */
function cp1252Byte(cp: number): number | null {
  if (cp < 0x80) return cp
  if (cp >= 0xa0 && cp <= 0xff) return cp
  return CP1252[cp] ?? null
}

/** byte CP1252 (0x80–0x9F) → ponto Unicode */
const CP1252_REVERSE: Record<number, number> = Object.fromEntries(
  Object.entries(CP1252).map(([cp, byte]) => [byte, Number(cp)]),
)

/**
 * Texto pronto para o DXF: só caracteres da página ANSI_1252; os demais são
 * transliterados ou escritos como `\U+XXXX`.
 */
export function dxfSafeText(s: string): string {
  let out = ''
  for (const ch of transliterate(s)) {
    const cp = ch.codePointAt(0) ?? 63
    if (cp1252Byte(cp) !== null) out += ch
    else if (cp <= 0xffff) out += `\\U+${cp.toString(16).toUpperCase().padStart(4, '0')}`
    else out += '?'
  }
  return out
}

/** conteúdo do DXF (já passado por `dxfSafeText`) → bytes CP1252 do arquivo */
export function encodeDxf(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length)
  let n = 0
  for (const ch of text) bytes[n++] = cp1252Byte(ch.codePointAt(0) ?? 63) ?? 63
  return n === bytes.length ? bytes : bytes.slice(0, n)
}

/** UTF-8 válido → texto; null se a sequência de bytes não é UTF-8 */
function tryUtf8(b: Uint8Array): string | null {
  let out = ''
  let i = b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 3 : 0
  while (i < b.length) {
    const c = b[i]
    let n = 0
    let cp = 0
    if (c < 0x80) {
      out += String.fromCharCode(c)
      i++
      continue
    } else if (c >= 0xc2 && c <= 0xdf) {
      n = 1
      cp = c & 0x1f
    } else if (c >= 0xe0 && c <= 0xef) {
      n = 2
      cp = c & 0x0f
    } else if (c >= 0xf0 && c <= 0xf4) {
      n = 3
      cp = c & 0x07
    } else return null
    for (let k = 1; k <= n; k++) {
      const t = b[i + k] // undefined = arquivo acaba no meio da sequência
      if (t === undefined || (t & 0xc0) !== 0x80) return null
      cp = (cp << 6) | (t & 0x3f)
    }
    // formas longas demais e substitutos não são UTF-8 válido
    if ((n === 2 && cp < 0x800) || (n === 3 && cp < 0x10000) || (cp >= 0xd800 && cp <= 0xdfff) || cp > 0x10ffff) return null
    out += String.fromCodePoint(cp)
    i += n + 1
  }
  return out
}

/** bytes de um arquivo DXF → texto: UTF-8 se for válido, senão ANSI_1252 */
export function decodeDxfBytes(bytes: Uint8Array): string {
  const utf8 = tryUtf8(bytes)
  if (utf8 !== null) return utf8
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i]
    out += String.fromCharCode(c >= 0x80 && c <= 0x9f ? (CP1252_REVERSE[c] ?? c) : c)
  }
  return out
}

/**
 * Texto de uma entidade lida do DXF: `\U+XXXX` vira o caractere e os códigos
 * de controle do AutoCAD viram o símbolo (%%c = Ø, %%d = °, %%p = ±).
 */
export function decodeDxfText(s: string): string {
  return s
    .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/%%[cC]/g, 'Ø')
    .replace(/%%[dD]/g, '°')
    .replace(/%%[pP]/g, '±')
    .replace(/%%%/g, '%')
}
