import { describe, expect, it } from 'vitest'
import { servedUrl } from '../../../src/audit/runners/playwright.ts'

/**
 * Its own file rather than part of playwright.test.ts, because that suite
 * launches a real browser in setup and skips wholesale where one is not
 * installed. This is a pure function and should be checked everywhere.
 */
describe('servedUrl', () => {
  it('addresses a page under the local server', () => {
    expect(servedUrl('http://127.0.0.1:4000', 'blog/post-1.html')).toBe(
      'http://127.0.0.1:4000/blog/post-1.html',
    )
  })

  it.each([
    ['a fragment character', 'faq#1.html', 'faq%231.html'],
    ['a query character', 'a?b.html', 'a%3Fb.html'],
    ['a space', 'my page.html', 'my%20page.html'],
    ['an umlaut', 'über-uns.html', '%C3%BCber-uns.html'],
  ])('encodes %s, which would otherwise address a different page', (_label, name, encoded) => {
    // Unencoded, the browser reads everything after # or ? as a fragment or a
    // query and audits the wrong page, or none at all.
    expect(servedUrl('http://127.0.0.1:4000', name)).toBe(`http://127.0.0.1:4000/${encoded}`)
  })

  it('keeps the separators between segments', () => {
    expect(servedUrl('http://127.0.0.1:4000', 'a b/c d/e.html')).toBe(
      'http://127.0.0.1:4000/a%20b/c%20d/e.html',
    )
  })
})
