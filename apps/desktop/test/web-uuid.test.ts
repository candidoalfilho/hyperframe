import { describe, expect, it } from 'vitest'
import { parseRoute } from '../src/web/route'
import { newUuid } from '../src/web/uuid'

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('newUuid', () => {
  it('usa crypto.randomUUID quando existe', () => {
    expect(newUuid()).toMatch(V4)
  })

  it('sem randomUUID (contexto inseguro) gera v4 com getRandomValues', () => {
    const insecure = { getRandomValues: crypto.getRandomValues.bind(crypto) }
    const ids = new Set(Array.from({ length: 200 }, () => newUuid(insecure)))
    expect(ids.size).toBe(200)
    for (const id of ids) {
      expect(id).toMatch(V4)
      expect(parseRoute(`#/p/${id}`)).toEqual({ kind: 'project', id })
    }
  })
})
