/**
 * Rotas da build web por HASH: `#/p/<uuid>` abre um projeto do navegador.
 *
 * Hash (e não History API) porque o app é publicado como site estático sob um
 * subcaminho (/app/) — o servidor nunca vê o fragmento, então não há
 * necessidade de rewrite p/ index.html em nenhum host (GitHub Pages, Netlify,
 * `npx serve`…) e um recarregamento sempre cai no mesmo arquivo.
 */

export type WebRoute = { kind: 'home' } | { kind: 'project'; id: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parseRoute(hash: string): WebRoute {
  const m = /^#?\/p\/([^/?#]+)\/?$/.exec(hash)
  if (m && UUID_RE.test(m[1])) return { kind: 'project', id: m[1].toLowerCase() }
  return { kind: 'home' }
}

export function routeHash(route: WebRoute): string {
  return route.kind === 'project' ? `#/p/${route.id}` : ''
}

/**
 * No store, `fileName` identifica o destino do "Salvar": caminho absoluto no
 * desktop; na web, `idb:<uuid>` aponta p/ o registro no IndexedDB.
 */
const WEB_PREFIX = 'idb:'

export const webFileName = (id: string): string => `${WEB_PREFIX}${id}`

export function webProjectId(fileName: string | null | undefined): string | null {
  return fileName?.startsWith(WEB_PREFIX) ? fileName.slice(WEB_PREFIX.length) : null
}
