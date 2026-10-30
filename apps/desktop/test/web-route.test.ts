import { describe, expect, it } from 'vitest'
import { parseRoute, routeHash, webFileName, webProjectId } from '../src/web/route'

const ID = '3c6a5b8f-b963-4d54-81f9-803a06e158c9'

describe('rota web (#/p/<uuid>)', () => {
  it('reconhece projeto pelo uuid (normaliza maiúsculas)', () => {
    expect(parseRoute(`#/p/${ID}`)).toEqual({ kind: 'project', id: ID })
    expect(parseRoute(`#/p/${ID.toUpperCase()}`)).toEqual({ kind: 'project', id: ID })
  })

  it('qualquer outra coisa é a tela inicial', () => {
    for (const h of ['', '#', '#/', '#/p/', '#/p/123', `#/x/${ID}`, `#/p/${ID}/extra`]) {
      expect(parseRoute(h)).toEqual({ kind: 'home' })
    }
  })

  it('routeHash é o inverso de parseRoute', () => {
    expect(parseRoute(routeHash({ kind: 'project', id: ID }))).toEqual({ kind: 'project', id: ID })
    expect(parseRoute(routeHash({ kind: 'home' }))).toEqual({ kind: 'home' })
  })

  it('fileName idb:<uuid> ⇄ id', () => {
    expect(webProjectId(webFileName(ID))).toBe(ID)
    expect(webProjectId('/Users/x/obra.hyperframe.json')).toBeNull()
    expect(webProjectId(null)).toBeNull()
    expect(webProjectId(undefined)).toBeNull()
  })
})
