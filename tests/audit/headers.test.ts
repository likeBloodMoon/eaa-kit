import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { collapsedOnto, crawlSite } from '../../src/audit/crawl.ts'
import { basicAuth, HeaderError, parseHeader, requestHeaders } from '../../src/audit/headers.ts'

describe('parsing one header', () => {
  it('splits on the first colon, so a value may contain more', () => {
    expect(parseHeader('Authorization: Bearer a:b:c')).toEqual(['Authorization', 'Bearer a:b:c'])
  })

  it('does not mind the space after the colon', () => {
    expect(parseHeader('X-Token:abc')).toEqual(['X-Token', 'abc'])
  })

  it('refuses one with no colon at all', () => {
    expect(() => parseHeader('Authorization Bearer abc')).toThrow(HeaderError)
  })

  it('refuses a name that is not a header name', () => {
    expect(() => parseHeader('Not A Header: value')).toThrow(/not a valid header name/)
  })

  it('refuses an empty value rather than sending one', () => {
    expect(() => parseHeader('X-Token:   ')).toThrow(/no value/)
  })

  it('refuses a line break in the value', () => {
    expect(() => parseHeader('X-Token: a\r\nX-Other: b')).toThrow(/line break/)
  })

  it('never repeats the value in the error, because the value is a credential', () => {
    // The case this protects: a malformed --header in CI, where the message
    // lands in a log somebody else can read.
    try {
      parseHeader('Bad Name: sk-secret-token')
      expect.unreachable('should have thrown')
    } catch (cause) {
      expect(String(cause)).not.toContain('sk-secret-token')
    }
  })
})

describe('basic auth', () => {
  it('encodes user and password the way the header wants', () => {
    expect(basicAuth('alex:hunter2')).toEqual([
      'Authorization',
      `Basic ${Buffer.from('alex:hunter2').toString('base64')}`,
    ])
  })

  it('allows colons in the password', () => {
    const [, value] = basicAuth('alex:hun:ter2')
    expect(Buffer.from(value.replace('Basic ', ''), 'base64').toString()).toBe('alex:hun:ter2')
  })

  it('refuses a pair with no colon', () => {
    expect(() => basicAuth('alexhunter2')).toThrow(HeaderError)
  })
})

describe('the headers a run sends', () => {
  it('is undefined when neither flag was given, so nothing changes for anybody else', () => {
    expect(requestHeaders({})).toBeUndefined()
  })

  it('combines both flags', () => {
    const headers = requestHeaders({ header: ['X-Token: abc'], basicAuth: 'alex:hunter2' })

    expect(Object.keys(headers ?? {}).sort()).toEqual(['Authorization', 'X-Token'])
  })

  it('lets a typed Authorization header beat --basic-auth', () => {
    const headers = requestHeaders({
      header: ['Authorization: Bearer typed'],
      basicAuth: 'alex:hunter2',
    })

    expect(headers?.['Authorization']).toBe('Bearer typed')
  })
})

/**
 * The crawl against a server that answers 401 without credentials — the two
 * cases this feature exists for, a preview deployment and a CMS staging site.
 */
describe('crawling a protected site', () => {
  let server: Server
  let origin: string
  const seen: Array<{ path: string; auth?: string; token?: string }> = []

  beforeAll(async () => {
    const expected = `Basic ${Buffer.from('alex:hunter2').toString('base64')}`
    server = createServer((request, response) => {
      const auth = request.headers.authorization
      const token = request.headers['x-preview-token']
      seen.push({
        path: request.url ?? '',
        ...(auth === undefined ? {} : { auth }),
        ...(typeof token === 'string' ? { token } : {}),
      })

      if (auth !== expected && token !== 'letmein') {
        response.writeHead(401, { 'www-authenticate': 'Basic realm="staging"' })
        response.end('unauthorized')
        return
      }
      if (request.url === '/sitemap.xml') {
        response.writeHead(200, { 'content-type': 'application/xml' })
        response.end(
          `<?xml version="1.0"?><urlset><url><loc>${origin}/</loc></url><url><loc>${origin}/about/</loc></url></urlset>`,
        )
        return
      }
      if (request.url === '/robots.txt') {
        response.writeHead(200, { 'content-type': 'text/plain' })
        response.end('User-agent: *\nAllow: /\n')
        return
      }
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(
        `<!doctype html><html lang="en"><head><title>${request.url}</title></head><body><main><p>Hi.</p></main></body></html>`,
      )
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('reaches nothing without credentials', async () => {
    const result = await crawlSite(new URL(`${origin}/`), {})

    expect(result.pages).toHaveLength(0)
    expect(result.failures[0]?.reason).toBe('HTTP 401')
  })

  it('audits the site with --basic-auth', async () => {
    const result = await crawlSite(new URL(`${origin}/`), {
      headers: Object.fromEntries([basicAuth('alex:hunter2')]),
    })

    expect(result.pages.length).toBeGreaterThan(0)
  })

  it('audits it with a header instead', async () => {
    const result = await crawlSite(new URL(`${origin}/`), {
      headers: { 'X-Preview-Token': 'letmein' },
    })

    expect(result.pages.length).toBeGreaterThan(0)
  })

  it('sends them on robots.txt and the sitemap too, not only on pages', async () => {
    // A site that needs credentials needs them for all three. Without this the
    // crawl silently loses the sitemap and finds only what the pages link to.
    seen.length = 0
    await crawlSite(new URL(`${origin}/`), { headers: { 'X-Preview-Token': 'letmein' } })

    const paths = seen.filter((entry) => entry.token === 'letmein').map((entry) => entry.path)
    expect(paths).toContain('/robots.txt')
    expect(paths).toContain('/sitemap.xml')
    expect(paths).toContain('/')
  })

  it('never writes a credential into what it reports', async () => {
    const result = await crawlSite(new URL(`${origin}/`), {
      headers: { 'X-Preview-Token': 'letmein' },
    })

    expect(JSON.stringify(result)).not.toContain('letmein')
  })
})

/**
 * The wall that looks like a success: a site whose unauthenticated requests are
 * redirected to a sign-in page, which answers 200 with a form. Every request
 * succeeds, the crawl audits the login page, and without this the report says
 * it measured the whole site.
 */
describe('a sign-in page standing in front of the site', () => {
  let server: Server
  let origin: string

  beforeAll(async () => {
    server = createServer((request, response) => {
      const signedIn = (request.headers.cookie ?? '').includes('session=valid')
      if (request.url === '/login') {
        response.writeHead(200, { 'content-type': 'text/html' })
        response.end(
          '<!doctype html><html lang="en"><head><title>Sign in</title></head><body><main><form><input name="password"></form></main></body></html>',
        )
        return
      }
      if (!signedIn) {
        response.writeHead(302, { location: '/login' })
        response.end()
        return
      }
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(
        `<!doctype html><html lang="en"><head><title>${request.url}</title></head><body><main><a href="/pricing/">Pricing</a><a href="/about/">About</a></main></body></html>`,
      )
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('is reported as pages that were never reached, not as a clean run', async () => {
    const result = await crawlSite(new URL(`${origin}/`), {})

    // The crawl "succeeded": every request answered 200.
    expect(result.pages).toHaveLength(1)
    expect(result.failures).toHaveLength(0)
    // And this is what stops the report claiming it audited the site.
    const collapsed = collapsedOnto(result)
    expect(collapsed.length).toBeGreaterThan(0)
    expect(collapsed[0]?.landedOn).toBe(`${origin}/login`)
  })

  it('says nothing once the credentials are given', async () => {
    const result = await crawlSite(new URL(`${origin}/`), {
      headers: { Cookie: 'session=valid' },
    })

    expect(result.pages.length).toBeGreaterThan(1)
    expect(collapsedOnto(result)).toEqual([])
  })
})

describe('redirects that are nothing of the sort', () => {
  let server: Server
  let origin: string

  beforeAll(async () => {
    // A locale prefix on the entry and trailing-slash normalisation on links:
    // both ordinary, and neither may be reported as an unreachable page.
    server = createServer((request, response) => {
      const path = request.url ?? '/'
      if (path === '/') {
        response.writeHead(302, { location: '/en/' })
        response.end()
        return
      }
      if (path === '/en/about' || path === '/en/pricing') {
        response.writeHead(301, { location: `${path}/` })
        response.end()
        return
      }
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(
        `<!doctype html><html lang="en"><head><title>${path}</title></head><body><main><a href="/en/about">About</a><a href="/en/pricing">Pricing</a></main></body></html>`,
      )
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('are recorded but never counted against the run', async () => {
    const result = await crawlSite(new URL(`${origin}/`), {})

    expect(result.pages.length).toBe(3)
    expect(result.redirects.length).toBeGreaterThan(0)
    expect(collapsedOnto(result)).toEqual([])
  })
})
