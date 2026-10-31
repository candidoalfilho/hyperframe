// Servidor estático mínimo (sem dependências) p/ testar a build web local:
//   /      → site/ (landing)
//   /app/  → apps/desktop/dist-web/ (gerado por `npm run build:web`)
// Uso: node scripts/serve-web.mjs [porta]   (padrão 4173; ou PORT=…)
// Escuta só em 127.0.0.1; HOST=0.0.0.0 p/ expor na rede local.
import { createServer } from 'node:http'
import { createReadStream, realpathSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const SITE = join(root, 'site')
const APP = join(root, 'apps', 'desktop', 'dist-web')
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 4173)
const HOST = process.env.HOST ?? '127.0.0.1'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
}

const inside = (p, base) => p === base || p.startsWith(base + sep)

/** caminho do arquivo a servir, null (404) ou undefined (URL malformada → 400) */
function fileFor(urlPath) {
  const [base, rel] = urlPath === '/app' || urlPath.startsWith('/app/')
    ? [APP, urlPath.slice(4)]
    : [SITE, urlPath]
  let decoded
  try {
    decoded = decodeURIComponent(rel)
  } catch {
    return undefined
  }
  const p = normalize(join(base, decoded))
  if (!inside(p, base)) return null // path traversal
  try {
    // symlinks não podem apontar p/ fora da pasta servida
    if (!inside(realpathSync(p), realpathSync(base))) return null
    const st = statSync(p)
    if (st.isDirectory()) {
      const idx = join(p, 'index.html')
      return statSync(idx).isFile() ? idx : null
    }
    return st.isFile() ? p : null
  } catch {
    return null
  }
}

createServer((req, res) => {
  const urlPath = new URL(req.url ?? '/', 'http://x').pathname
  if (urlPath === '/app') {
    res.writeHead(301, { location: '/app/' }).end()
    return
  }
  const file = fileFor(urlPath)
  if (file === undefined) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('400')
    return
  }
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404')
    return
  }
  res.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
  })
  createReadStream(file).pipe(res)
}).listen(PORT, HOST, () => {
  const h = HOST === '0.0.0.0' || HOST === '::' ? 'localhost' : HOST
  console.log(`HyperFrame web: http://${h}:${PORT}/ (landing) · http://${h}:${PORT}/app/ (app)`)
})
