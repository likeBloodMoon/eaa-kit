import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runBrowserAudit, siteOrigins } from '../../../src/audit/runners/playwright.ts'

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
    if (request.url === '/own.css') {
      response.writeHead(200, { 'content-type': 'text/css' }).end('h1 { color: #111 }')
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' }).end(
      `<!doctype html><html lang="en"><head><title>t</title>
       <link rel="stylesheet" href="/own.css">
       <link rel="stylesheet" href="${thirdPartyOrigin}/font.css">
       </head><body><main><h1>Hello</h1></main></body></html>`,
    )
  })
  siteOrigin = await listen(site)
})

afterAll(async () => {
  await Promise.all([site, thirdParty].map((server) => new Promise((r) => server.close(r))))
})

describe('credentials in browser mode', () => {
  it('reach the site and its assets, and never a third party', async () => {
    const page = { absolutePath: `${siteOrigin}/`, relativePath: '/', html: '' }

    const [audit] = await runBrowserAudit(undefined, [page], {
      headers: { 'x-preview-token': 'secret-123' },
      timeoutMs: 30_000,
    })

    expect(audit?.error).toBeUndefined()
    expect(siteRequests.map((seen) => seen.path).sort()).toEqual(['/', '/own.css'])
    for (const seen of siteRequests) expect(seen.headers['x-preview-token']).toBe('secret-123')
    expect(thirdPartyRequests.length).toBeGreaterThan(0)
    for (const seen of thirdPartyRequests) expect(seen.headers['x-preview-token']).toBeUndefined()
  }, 120_000)
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
