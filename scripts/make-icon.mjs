// Gera o ícone-fonte 1024×1024 do HyperFrame (PNG puro, sem dependências).
// Uso: node scripts/make-icon.mjs → scripts/icon-1024.png
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const S = 1024
const px = Buffer.alloc(S * S * 4)

function set(x, y, [r, g, b, a = 255]) {
  if (x < 0 || y < 0 || x >= S || y >= S) return
  const i = (y * S + x) * 4
  px[i] = r
  px[i + 1] = g
  px[i + 2] = b
  px[i + 3] = a
}

function rect(x0, y0, w, h, c) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, c)
}

const bg = [19, 20, 25, 255]
const panel = [33, 36, 46, 255]
const orange = [255, 160, 40, 255]
const blue = [77, 163, 255, 255]

// fundo com cantos arredondados
const R = 180
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const cx = x < R ? R : x > S - R ? S - R : x
    const cy = y < R ? R : y > S - R ? S - R : y
    const inside =
      (x >= R && x < S - R) || (y >= R && y < S - R)
        ? true
        : (x - cx) ** 2 + (y - cy) ** 2 <= R * R
    if (inside) set(x, y, bg)
  }
}

// pórtico estilizado 3×3 (pilares + vigas)
const t = 64
const lo = 232
const hi = 728
const span = hi - lo + t // 560
rect(lo - 90, hi + t, span + 180, 28, panel) // linha do terreno
for (const x of [lo, (lo + hi) / 2, hi]) rect(x, lo, t, span, orange) // pilares
rect(lo, lo, span, t, orange) // viga topo
rect(lo, (lo + hi) / 2, span, t, blue) // viga intermediária (destaque)
rect(lo, hi, span, t, orange) // viga base

// ---------------------------------------------------------------- PNG encode
const table = new Int32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  table[n] = c
}
function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return ~c >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(S, 0)
ihdr.writeUInt32BE(S, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA
const raw = Buffer.alloc((S * 4 + 1) * S)
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0 // filtro none
  px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4)
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

const out = join(dirname(fileURLToPath(import.meta.url)), 'icon-1024.png')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, png)
console.log(`ícone gerado: ${out} (${png.length} bytes)`)
