import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  credentialsRoute,
  runBrowserAudit,
  siteOrigins,
} from '../../../src/audit/runners/playwright.ts'

/**
 * Credentials given with --header go to the audited site and nowhere else.
 *
 * Against a real Chromium, because the bug this guards against lived in how
 * Chromium applies context-wide headers: to every request a page makes,
 * including the fonts, analytics and CDN scripts of whatever site is audited.
 */

interface Seen {
  path: string
  headers: IncomingHttpHeaders
}

let site: Server
let thirdParty: Server
let siteOrigin: string
let thirdPartyOrigin: string
const siteRequests: Seen[] = []
const thirdPartyRequests: Seen[] = []

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
    })
  })
}

beforeAll(async () => {
  thirdParty = createServer((request, response) => {
    thirdPartyRequests.push({ path: request.url ?? '', headers: request.headers })
    response.writeHead(200, { 'content-type': 'text/css' }).end('body { margin: 0 }')
  })
  thirdPartyOrigin = await listen(thirdParty)

  site = createServer((request, response) => {
    siteRequests.push({ path: request.url ?? '', headers: request.headers })
    if (request.url === '/moved.css') {
      response.writeHead(302, { location: `${thirdPartyOrigin}/landed.css` }).end()
      return
    }
    if (request.url === '/own.css') {
      response.writeHead(200, { 'content-type': 'text/css' }).end('h1 { color: #111 }')
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' }).end(
      `<!doctype html><html lang="en"><head><title>t</title>
       <link rel="stylesheet" href="/own.css">
       <link rel="stylesheet" href="${thirdPartyOrigin}/font.css">
       <link rel="stylesheet" href="/moved.css">
       </head><body><main><h1>Hello</h1></main></body></html>`,
    )
  })
  siteOrigin = await listen(site)
})

afterAll(async () => {
  await Promise.all([site, thirdParty].map((server) => new Promise((r) => server.close(r))))
})

describe('credentials in browser mode', () => {
  it('reach the site and its assets, and never a third party, even through a redirect', async () => {
    const page = { absolutePath: `${siteOrigin}/`, relativePath: '/', html: '' }

    const [audit] = await runBrowserAudit(undefined, [page], {
      headers: { 'x-preview-token': 'secret-123' },
      timeoutMs: 30_000,
    })

    expect(audit?.error).toBeUndefined()
    // Sets, because the runner may load a page more than once.
    expect([...new Set(siteRequests.map((seen) => seen.path))].sort()).toEqual([
      '/',
      '/moved.css',
      '/own.css',
    ])
    for (const seen of siteRequests) expect(seen.headers['x-preview-token']).toBe('secret-123')
    for (const seen of thirdPartyRequests) expect(seen.headers['x-preview-token']).toBeUndefined()
  }, 120_000)
})

describe('credentialsRoute', () => {
  // The redirect hop is checked from the browser's side: what it attached to
  // the redirected request. Chromium will not then send that request to
  // another loopback port from a document handed back by a route, so the far
  // server cannot be the witness here; the browser's own request record can.
  it('follows a redirect off the site without the credentials', async () => {
    const { chromium } = await import('playwright')
    const browser = await chromium.launch()
    try {
      const context = await browser.newContext()
      await context.route(
        '**/*',
        credentialsRoute(new Set([siteOrigin]), { 'x-preview-token': 'secret-123' }) as never,
      )
      const page = await context.newPage()
      const sent = new Map<string, string | undefined>()
      page.on('request', (request) => {
        void request.allHeaders().then((headers) => {
          sent.set(new URL(request.url()).pathname, headers['x-preview-token'])
        })
      })

      await page.goto(`${siteOrigin}/`, { waitUntil: 'load' })
      await page.waitForTimeout(500)

      // The site's own requests are fetched by the route, so the site's server
      // is the witness for those, and the browser's record for the hop.
      const atSite = siteRequests.filter((seen) => seen.path === '/moved.css')
      expect(atSite.length).toBeGreaterThan(0)
      for (const seen of atSite) expect(seen.headers['x-preview-token']).toBe('secret-123')
      expect(sent.has('/landed.css')).toBe(true)
      expect(sent.get('/landed.css')).toBeUndefined()
      expect(sent.get('/font.css')).toBeUndefined()
    } finally {
      await browser.close()
    }
  }, 60_000)
})

describe('siteOrigins', () => {
  it('takes the crawled pages and the loopback server, and nothing off disk', () => {
    const origins = siteOrigins(
      [
        { absolutePath: 'https://preview.example.com/a/', relativePath: 'a/', html: '' },
        { absolutePath: '/home/me/dist/index.html', relativePath: 'index.html', html: '' },
      ],
      'http://127.0.0.1:4000',
    )

    expect([...origins].sort()).toEqual(['http://127.0.0.1:4000', 'https://preview.example.com'])
  })
})
