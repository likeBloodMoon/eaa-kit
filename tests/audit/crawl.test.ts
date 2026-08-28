import { describe, expect, it } from 'vitest'
import {
  CrawlError,
  crawlSite,
  disallowedPaths,
  linksFrom,
  pageIdentity,
  parseEntryUrl,
  urlsFromSitemap,
} from '../../src/audit/crawl.ts'

/** A site in a record, served by a fetch stand-in. No network, no server. */
function site(
  pages: Record<
    string,
    string | { body: string; type?: string; status?: number; redirectedTo?: string }
  >,
): {
  fetchImpl: typeof fetch
  requests: string[]
} {
  const requests: string[] = []
  const fetchImpl = (async (input: string | URL) => {
    const url = new URL(typeof input === 'string' ? input : input.href)
    requests.push(url.pathname)
    const entry = pages[url.pathname]
    if (entry === undefined) {
      return new Response('gone', { status: 404, headers: { 'content-type': 'text/html' } })
    }
    const {
      body,
      type = 'text/html; charset=utf-8',
      status = 200,
      redirectedTo,
    } = typeof entry === 'string' ? { body: entry, redirectedTo: undefined } : entry
    const response = new Response(body, { status, headers: { 'content-type': type } })
    // redirect: 'follow' resolves with the final response, whose `url` is where
    // it ended up. That is the only thing the crawler can see a redirect by.
    if (redirectedTo !== undefined) {
      Object.defineProperty(response, 'url', { value: redirectedTo })
    }
    return response
  }) as unknown as typeof fetch
  return { fetchImpl, requests }
}

const page = (body: string): string => `<!doctype html><html lang="en"><body>${body}</body></html>`

describe('parseEntryUrl', () => {
  it.each(['http://localhost:3000', 'http://127.0.0.1:8080', 'http://[::1]:3000'])(
    'accepts %s without an opt-in',
    (url) => {
      expect(parseEntryUrl(url).origin).toBeTruthy()
    },
  )

  it('refuses a remote host unless it is asked to', () => {
    // A tool that fails builds should not be one flag away from crawling
    // production, or somebody else's site, out of CI.
    expect(() => parseEntryUrl('https://example.com')).toThrow(CrawlError)
    expect(() => parseEntryUrl('https://example.com')).toThrow(/--allow-remote/)
  })

  it('crawls a remote host when it is', () => {
    expect(parseEntryUrl('https://example.com', true).host).toBe('example.com')
  })

  it.each(['not a url', 'localhost:3000', 'ftp://localhost'])('rejects %s', (raw) => {
    expect(() => parseEntryUrl(raw)).toThrow(CrawlError)
  })
})

describe('pageIdentity', () => {
  it.each([
    ['http://localhost/', '/'],
    ['http://localhost/about/', 'about/'],
    ['http://localhost/a/b.html', 'a/b.html'],
    // A tracking parameter does not make it a different page, and a baseline
    // keyed on one would never match twice.
    ['http://localhost/x?utm_source=n', 'x'],
    ['http://localhost/x#top', 'x'],
  ])('%s -> %s', (url, expected) => {
    expect(pageIdentity(new URL(url))).toBe(expected)
  })
})

describe('linksFrom', () => {
  const from = new URL('http://localhost/')

  it('finds same-origin links in every quoting style', () => {
    const found = linksFrom(`<a href="/a">1</a><a href='/b'>2</a><a href=/c>3</a>`, from).map(
      (url) => url.pathname,
    )

    expect(found).toEqual(['/a', '/b', '/c'])
  })

  it.each([
    ['off-origin', '<a href="https://example.com/x">x</a>'],
    ['mailto', '<a href="mailto:a@b.c">x</a>'],
    ['tel', '<a href="tel:+431">x</a>'],
    ['javascript', '<a href="javascript:void(0)">x</a>'],
    ['a bare fragment', '<a href="#main">x</a>'],
    ['an asset', '<a href="/brochure.pdf">x</a>'],
    ['an empty href', '<a href="">x</a>'],
  ])('leaves %s alone', (_name, html) => {
    expect(linksFrom(html, from)).toEqual([])
  })

  it('resolves a relative link against the page it was found on', () => {
    const found = linksFrom('<a href="c">x</a>', new URL('http://localhost/a/b/'))

    expect(found[0]?.pathname).toBe('/a/b/c')
  })

  it('drops the fragment so one page is not crawled twice', () => {
    const found = linksFrom('<a href="/a#one">1</a><a href="/a#two">2</a>', from)

    expect(found).toHaveLength(1)
  })
})

describe('urlsFromSitemap', () => {
  it('reads the locations, ignoring other origins', () => {
    const found = urlsFromSitemap(
      `<urlset><url><loc>http://localhost/a</loc></url>
       <url><loc>https://example.com/b</loc></url>
       <url><loc>http://localhost/c</loc></url></urlset>`,
      new URL('http://localhost/'),
    )

    expect(found.map((url) => url.pathname)).toEqual(['/a', '/c'])
  })

  it('survives a document that is not a sitemap', () => {
    expect(urlsFromSitemap('<html><body>nope</body></html>', new URL('http://localhost/'))).toEqual(
      [],
    )
  })
})

describe('disallowedPaths', () => {
  it('reads the wildcard group only', () => {
    const blocked = disallowedPaths(
      'User-agent: Googlebot\nDisallow: /secret\n\nUser-agent: *\nDisallow: /admin\nDisallow: /api\n',
    )

    expect(blocked).toEqual(['/admin', '/api'])
  })

  it('treats an empty Disallow as allowing everything', () => {
    expect(disallowedPaths('User-agent: *\nDisallow:\n')).toEqual([])
  })

  it('ignores comments', () => {
    expect(disallowedPaths('User-agent: *\nDisallow: /x # why\n')).toEqual(['/x'])
  })
})

describe('crawlSite', () => {
  const entry = new URL('http://localhost:3000/')

  it('follows links from the entry point and returns the pages', async () => {
    const { fetchImpl } = site({
      '/': page('<a href="/about">a</a><a href="/kontakt">k</a>'),
      '/about': page('<h1>About</h1>'),
      '/kontakt': page('<h1>Kontakt</h1>'),
    })

    const result = await crawlSite(entry, { fetchImpl })

    expect(result.pages.map((p) => p.relativePath)).toEqual(['/', 'about', 'kontakt'])
    expect(result.discovery).toBe('links')
  })

  it('prefers the sitemap, which finds pages nothing links to', async () => {
    const { fetchImpl } = site({
      '/sitemap.xml': {
        body: '<urlset><url><loc>http://localhost:3000/orphan</loc></url></urlset>',
        type: 'application/xml',
      },
      '/': page('<h1>Home</h1>'),
      '/orphan': page('<h1>Orphan</h1>'),
    })

    const result = await crawlSite(entry, { fetchImpl })

    expect(result.discovery).toBe('sitemap')
    expect(result.pages.map((p) => p.relativePath)).toContain('orphan')
  })

  it('still follows links when the sitemap is incomplete', async () => {
    // A sitemap listing three of forty pages would otherwise be worse than none.
    const { fetchImpl } = site({
      '/sitemap.xml': {
        body: '<urlset><url><loc>http://localhost:3000/a</loc></url></urlset>',
        type: 'application/xml',
      },
      '/': page('<a href="/b">b</a>'),
      '/a': page('<h1>A</h1>'),
      '/b': page('<h1>B</h1>'),
    })

    const result = await crawlSite(entry, { fetchImpl })

    expect(result.pages.map((p) => p.relativePath)).toEqual(['/', 'a', 'b'])
  })

  it('returns pages sorted, so two crawls of a site agree', async () => {
    const { fetchImpl } = site({
      '/': page('<a href="/z">z</a><a href="/m">m</a><a href="/a">a</a>'),
      '/z': page('z'),
      '/m': page('m'),
      '/a': page('a'),
    })

    const first = await crawlSite(entry, { fetchImpl })
    const second = await crawlSite(entry, { fetchImpl })

    expect(first.pages.map((p) => p.relativePath)).toEqual(second.pages.map((p) => p.relativePath))
    expect(first.pages.map((p) => p.relativePath)).toEqual(['/', 'a', 'm', 'z'])
  })

  it('stops at maxPages and says so', async () => {
    const { fetchImpl } = site({
      '/': page('<a href="/a">a</a><a href="/b">b</a><a href="/c">c</a>'),
      '/a': page('a'),
      '/b': page('b'),
      '/c': page('c'),
    })

    const result = await crawlSite(entry, { fetchImpl, maxPages: 2 })

    expect(result.pages).toHaveLength(2)
    expect(result.truncated).toBe(true)
  })

  it('stops following links at maxDepth', async () => {
    const { fetchImpl } = site({
      '/': page('<a href="/one">1</a>'),
      '/one': page('<a href="/two">2</a>'),
      '/two': page('<a href="/three">3</a>'),
      '/three': page('3'),
    })

    const result = await crawlSite(entry, { fetchImpl, maxDepth: 1 })

    expect(result.pages.map((p) => p.relativePath)).toEqual(['/', 'one'])
  })

  it('records a page it could not fetch rather than dropping it silently', async () => {
    const { fetchImpl } = site({ '/': page('<a href="/missing">m</a>') })

    const result = await crawlSite(entry, { fetchImpl })

    expect(result.pages.map((p) => p.relativePath)).toEqual(['/'])
    expect(result.failures).toEqual([{ url: 'http://localhost:3000/missing', reason: 'HTTP 404' }])
  })

  it('refuses to audit something that is not HTML', async () => {
    // A crawl follows links, and a link can point at anything. Auditing a JSON
    // endpoint as markup produces findings about a document that was never a page.
    const { fetchImpl } = site({
      '/': page('<a href="/api/data">d</a>'),
      '/api/data': { body: '{"a":1}', type: 'application/json' },
    })

    const result = await crawlSite(entry, { fetchImpl })

    expect(result.pages.map((p) => p.relativePath)).toEqual(['/'])
    expect(result.failures[0]?.reason).toMatch(/not HTML \(application\/json\)/)
  })

  it('honours robots.txt', async () => {
    const { fetchImpl, requests } = site({
      '/robots.txt': { body: 'User-agent: *\nDisallow: /admin\n', type: 'text/plain' },
      '/': page('<a href="/admin/users">u</a><a href="/ok">o</a>'),
      '/admin/users': page('secret'),
      '/ok': page('ok'),
    })

    const result = await crawlSite(entry, { fetchImpl })

    expect(result.pages.map((p) => p.relativePath)).toEqual(['/', 'ok'])
    expect(requests).not.toContain('/admin/users')
  })

  it('ignores robots.txt when told to', async () => {
    const { fetchImpl } = site({
      '/robots.txt': { body: 'User-agent: *\nDisallow: /admin\n', type: 'text/plain' },
      '/': page('<a href="/admin">a</a>'),
      '/admin': page('admin'),
    })

    const result = await crawlSite(entry, { fetchImpl, ignoreRobots: true })

    expect(result.pages.map((p) => p.relativePath)).toEqual(['/', 'admin'])
  })

  it('does not fetch a page twice', async () => {
    const { fetchImpl, requests } = site({
      '/': page('<a href="/a">1</a><a href="/a">2</a>'),
      '/a': page('<a href="/">home</a>'),
    })

    await crawlSite(entry, { fetchImpl })

    expect(requests.filter((path) => path === '/a')).toHaveLength(1)
    expect(requests.filter((path) => path === '/')).toHaveLength(1)
  })

  it('strips a byte-order mark, as the directory collector does', async () => {
    const { fetchImpl } = site({ '/': `﻿${page('<h1>x</h1>')}` })

    const result = await crawlSite(entry, { fetchImpl })

    expect(result.pages[0]?.html.charCodeAt(0)).not.toBe(0xfeff)
  })

  it('carries the page URL as its absolute path, since there is no file', async () => {
    const { fetchImpl } = site({ '/about': page('x'), '/': page('<a href="/about">a</a>') })

    const result = await crawlSite(entry, { fetchImpl })

    expect(result.pages.map((p) => p.absolutePath)).toEqual([
      'http://localhost:3000/',
      'http://localhost:3000/about',
    ])
  })
})

describe('crawlSite and redirects', () => {
  const entry = new URL('http://localhost:3000/')

  it('refuses a page that was redirected off the origin', async () => {
    // The hole this closes: parseEntryUrl guards the entry point, and the link
    // and sitemap filters guard what is discovered, but a redirect is the one
    // way out of the origin that neither of them sees. Without this check a
    // loopback crawl follows it and audits whatever it lands on, which is
    // exactly what --allow-remote exists to gate.
    const { fetchImpl } = site({
      '/': page('<a href="/away">away</a>'),
      '/away': { body: page('<h1>elsewhere</h1>'), redirectedTo: 'https://example.com/away' },
    })

    const result = await crawlSite(entry, { fetchImpl })

    expect(result.pages.map((p) => p.relativePath)).toEqual(['/'])
    expect(result.failures).toEqual([
      {
        url: 'http://localhost:3000/away',
        reason: 'redirected off http://localhost:3000 to https://example.com',
      },
    ])
  })

  it('refuses one redirected to another port on the same host', async () => {
    // A different port is a different origin, and on a developer's machine it
    // is a different application.
    const { fetchImpl } = site({
      '/': page('<a href="/admin">a</a>'),
      '/admin': { body: page('<h1>x</h1>'), redirectedTo: 'http://localhost:9999/admin' },
    })

    const result = await crawlSite(entry, { fetchImpl })

    expect(result.pages).toHaveLength(1)
    expect(result.failures[0]?.reason).toMatch(/redirected off/)
  })

  it('names the redirect rather than whatever it happened to return', async () => {
    // An off-origin redirect to a PDF should report the redirect: it is the
    // fact that matters, and "not HTML" would hide it.
    const { fetchImpl } = site({
      '/': page('<a href="/doc">d</a>'),
      '/doc': {
        body: '%PDF-1.4',
        type: 'application/pdf',
        redirectedTo: 'https://cdn.example.com/doc.pdf',
      },
    })

    const result = await crawlSite(entry, { fetchImpl })

    expect(result.failures[0]?.reason).toMatch(/^redirected off/)
  })

  it('still follows a redirect that stays on the origin', async () => {
    // Trailing-slash and canonical redirects are ordinary, and refusing them
    // would make the crawler useless on most real sites.
    const { fetchImpl } = site({
      '/': page('<a href="/about">a</a>'),
      '/about': { body: page('<h1>About</h1>'), redirectedTo: 'http://localhost:3000/about/' },
    })

    const result = await crawlSite(entry, { fetchImpl })

    expect(result.pages.map((p) => p.relativePath)).toEqual(['/', 'about/'])
    expect(result.failures).toEqual([])
  })
})
