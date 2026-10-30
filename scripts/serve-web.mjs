// Servidor estático mínimo (sem dependências) p/ testar a build web local:
//   /      → site/ (landing)
//   /app/  → apps/desktop/dist-web/ (gerado por `npm run build:web`)
// Uso: node scripts/serve-web.mjs [porta]   (padrão 4173; ou PORT=…)
import { createServer } from 'node:http'
import { createReadStream, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const SITE = join(root, 'site')
const APP = join(root, 'apps', 'desktop', 'dist-web')
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 4173)

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

function fileFor(urlPath) {
  const [base, rel] = urlPath === '/app' || urlPath.startsWith('/app/')
    ? [APP, urlPath.slice(4)]
    : [SITE, urlPath]
  const p = normalize(join(base, decodeURIComponent(rel)))
  if (p !== base && !p.startsWith(base + sep)) return null // path traversal
  try {
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
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404')
    return
  }
  res.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
  })
  createReadStream(file).pipe(res)
}).listen(PORT, () => {
  console.log(`HyperFrame web: http://localhost:${PORT}/ (landing) · http://localhost:${PORT}/app/ (app)`)
})
