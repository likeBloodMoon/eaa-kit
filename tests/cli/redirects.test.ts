import { stripVTControlCharacters } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runAuditCommand } from '../../src/cli/audit.ts'
import { resolvePages } from '../../src/cli/pages.ts'

/**
 * Where a crawl's entry URL actually leads, and what the run does about it.
 *
 * The case this was written for: `www.gtainside.de` answers with a 301 to
 * `www.gtainside.com`. That is a different site from the one somebody named,
 * so the run stops and says so unless they agree to go on, and when they do,
 * every report says which site it is about.
 */

interface Route {
  status?: number
  location?: string
  body?: string
  type?: string
}

const PAGE = (title: string, extra = ''): string =>
  `<!doctype html><html lang="en"><head><title>${title}</title></head><body><main><h1>${title}</h1>${extra}</main></body></html>`

/**
 * A fake network. It honours `redirect: 'manual'`, which the entry probe uses
 * to see each hop, and follows redirects itself otherwise, the way fetch does
 * for the crawl, setting the response's url to where it ended up.
 */
function network(routes: Record<string, Route>) {
  const requests: Array<{ url: string; headers: Record<string, string> }> = []
  const answer = (href: string): Response => {
    const route = routes[href] ?? { status: 404, body: 'gone' }
    const headers: Record<string, string> = { 'content-type': route.type ?? 'text/html' }
    if (route.location !== undefined) headers.location = route.location
    return new Response(route.body ?? '', { status: route.status ?? 200, headers })
  }
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    let href = String(input)
    requests.push({ url: href, headers: { ...(init?.headers as Record<string, string>) } })
    if (init?.redirect === 'manual') return answer(href)
    for (let hop = 0; hop < 10; hop += 1) {
      const route = routes[href]
      if (route?.location === undefined) break
      href = new URL(route.location, href).href
    }
    const response = answer(href)
    Object.defineProperty(response, 'url', { value: href })
    return response
  }) as typeof fetch
  return { fetchImpl, requests }
}

let stderr: string[] = []
beforeEach(() => {
  stderr = []
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk))
    return true
  })
})
afterEach(() => vi.restoreAllMocks())

const said = (): string => stripVTControlCharacters(stderr.join(''))

const GTA = {
  'https://www.gtainside.de/': { status: 301, location: 'https://www.gtainside.com/' },
  'https://www.gtainside.com/': { body: PAGE('GTA Inside') },
}

describe('an entry that redirects to another site', () => {
  it('stops, says where it went, and names both ways on', async () => {
    const { fetchImpl } = network(GTA)

    const resolved = await resolvePages(undefined, {
      url: 'https://www.gtainside.de/',
      allowRemote: true,
      fetchImpl,
    })

    expect(resolved).toBeUndefined()
    expect(said()).toContain(
      'https://www.gtainside.de/ redirects to https://www.gtainside.com/ (301), which is a different site, so nothing was audited.',
    )
    expect(said()).toContain('→ eaa-kit audit --url https://www.gtainside.com/ --allow-remote')
    expect(said()).toContain('--redirects follow')
  })

  it('asks, and stops on a no', async () => {
    const { fetchImpl } = network(GTA)
    const questions: string[] = []

    const resolved = await resolvePages(undefined, {
      url: 'https://www.gtainside.de/',
      allowRemote: true,
      fetchImpl,
      confirm: async (question) => {
        questions.push(question)
        return false
      },
    })

    expect(resolved).toBeUndefined()
    expect(questions[0]).toContain('Audit https://www.gtainside.com/ instead?')
  })

  it('goes on when approved, and records that it did and why', async () => {
    const { fetchImpl } = network(GTA)

    const resolved = await resolvePages(undefined, {
      url: 'https://www.gtainside.de/',
      allowRemote: true,
      fetchImpl,
      confirm: async () => true,
    })

    expect(resolved?.pages.map((page) => page.absolutePath)).toEqual(['https://www.gtainside.com/'])
    expect(resolved?.completeness.entryRedirect).toEqual({
      requested: 'https://www.gtainside.de/',
      auditedFrom: 'https://www.gtainside.com/',
      statuses: [301],
      followedBecause: 'prompt',
    })
  })

  it('goes on without asking under --redirects follow', async () => {
    const { fetchImpl } = network(GTA)

    const resolved = await resolvePages(undefined, {
      url: 'https://www.gtainside.de/',
      allowRemote: true,
      redirects: 'follow',
      fetchImpl,
      confirm: async () => {
        throw new Error('should not ask')
      },
    })

    expect(resolved?.completeness.entryRedirect?.followedBecause).toBe('flag')
  })

  it('never lets a local entry redirect its way onto the internet', async () => {
    const { fetchImpl } = network({
      'http://localhost:3000/': { status: 302, location: 'https://example.com/' },
      'https://example.com/': { body: PAGE('Elsewhere') },
    })

    const resolved = await resolvePages(undefined, {
      url: 'http://localhost:3000/',
      redirects: 'follow',
      fetchImpl,
    })

    expect(resolved).toBeUndefined()
    expect(said()).toContain('does not crawl remote hosts by default')
  })
})

describe('an entry that redirects within the same site', () => {
  const HTTPS = {
    'http://example.com/': { status: 301, location: 'https://www.example.com/' },
    'https://www.example.com/': { body: PAGE('Example') },
  }

  it('is followed without a question, and still recorded', async () => {
    const { fetchImpl } = network(HTTPS)

    const resolved = await resolvePages(undefined, {
      url: 'http://example.com/',
      allowRemote: true,
      fetchImpl,
    })

    expect(resolved?.completeness.entryRedirect).toMatchObject({
      auditedFrom: 'https://www.example.com/',
      followedBecause: 'same-site',
    })
  })

  it('is refused under --redirects stop', async () => {
    const { fetchImpl } = network(HTTPS)

    const resolved = await resolvePages(undefined, {
      url: 'http://example.com/',
      allowRemote: true,
      redirects: 'stop',
      fetchImpl,
    })

    expect(resolved).toBeUndefined()
    expect(said()).toContain('the same site at another address')
    expect(said()).toContain('--redirects stop was asked for')
  })
})

describe('a sign-in wall in front of the entry', () => {
  it.each([
    [
      '401',
      { 'https://staging.example.com/': { status: 401, body: 'no' } },
      'answered 401: it asks for credentials',
      '--basic-auth user:password',
    ],
    [
      'an identity provider',
      {
        'https://staging.example.com/': {
          status: 302,
          location: 'https://accounts.google.com/o/oauth2/auth?x=1',
        },
        'https://accounts.google.com/o/oauth2/auth?x=1': { body: PAGE('Sign in') },
      },
      'it sends visitors to sign in at https://accounts.google.com',
      '--header "Cookie: <session>"',
    ],
    [
      'a login page on the site',
      {
        'https://staging.example.com/': { status: 302, location: '/users/sign_in' },
        'https://staging.example.com/users/sign_in': { body: PAGE('Sign in') },
      },
      'a sign-in page at https://staging.example.com/users/sign_in',
      '--header "Cookie: <session>"',
    ],
    [
      'a page with a password field',
      {
        'https://staging.example.com/': { status: 302, location: '/gate' },
        'https://staging.example.com/gate': {
          body: PAGE('Gate', '<form><input type="password" name="pw"></form>'),
        },
      },
      'a page with a password field on it',
      '--header "Cookie: <session>"',
    ],
  ] as Array<[string, Record<string, Route>, string, string]>)(
    'stops rather than auditing the form: %s',
    async (_name, routes, evidence, fix) => {
      const { fetchImpl } = network(routes)

      const resolved = await resolvePages(undefined, {
        url: 'https://staging.example.com/',
        allowRemote: true,
        redirects: 'follow',
        fetchImpl,
      })

      expect(resolved).toBeUndefined()
      expect(said()).toContain('is behind a sign-in wall')
      expect(said()).toContain(evidence)
      expect(said()).toContain(fix)
    },
  )

  it('never sends the credentials to another origin on the way', async () => {
    const { fetchImpl, requests } = network({
      'https://staging.example.com/': { status: 302, location: 'https://sso.other.example/login' },
      'https://sso.other.example/login': { body: PAGE('Sign in') },
    })

    await resolvePages(undefined, {
      url: 'https://staging.example.com/',
      allowRemote: true,
      headers: { authorization: 'Basic c2VjcmV0' },
      fetchImpl,
    })

    const offOrigin = requests.filter((request) => request.url.startsWith('https://sso.'))
    expect(offOrigin.length).toBeGreaterThan(0)
    for (const request of offOrigin) expect(request.headers.authorization).toBeUndefined()
    // And with credentials sent, the message says they were not accepted.
    expect(said()).toContain('The credentials that were sent were not accepted')
  })
})

describe('the reports', () => {
  it('say which site they are about when the run followed a redirect', async () => {
    const { fetchImpl } = network(GTA)
    const stdout: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout.push(String(chunk))
      return true
    })

    for (const format of ['console', 'html', 'json', 'sarif'] as const) {
      stdout.length = 0
      await runAuditCommand(undefined, {
        url: 'https://www.gtainside.de/',
        allowRemote: true,
        redirects: 'follow',
        noCache: true,
        format,
        fetchImpl,
      })
      const text = stripVTControlCharacters(stdout.join(''))
      expect(text, format).toContain('https://www.gtainside.com/')
      if (format === 'console') {
        expect(text).toContain('Redirected (301, --redirects follow):')
        expect(text).toContain('from https://www.gtainside.de/')
        expect(text).toContain('to   https://www.gtainside.com/')
      } else if (format === 'html') {
        expect(text).toContain(
          'https://www.gtainside.de/ redirected to https://www.gtainside.com/ (301',
        )
      } else {
        expect(text, format).toContain('"requested": "https://www.gtainside.de/"')
      }
    }
  })
})

describe('pages that all land on one sign-in form', () => {
  it('says it is a sign-in page when the page they land on has a password field', async () => {
    // The entry answers where it was asked, so the probe has nothing to say;
    // it is the pages behind it that are walled off.
    const { fetchImpl } = network({
      'https://example.com/': { body: PAGE('Home', '<a href="/a">a</a><a href="/b">b</a>') },
      'https://example.com/a': { status: 302, location: '/members' },
      'https://example.com/b': { status: 302, location: '/members' },
      'https://example.com/members': {
        body: PAGE('Members', '<form><input type="password"></form>'),
      },
    })

    const resolved = await resolvePages(undefined, {
      url: 'https://example.com/',
      allowRemote: true,
      fetchImpl,
    })

    expect(said()).toContain(
      'which has a password field on it: a sign-in page stands in front of the site',
    )
    expect(resolved?.completeness.unreachable.map((item) => item.reason)).toEqual([
      'answered at https://example.com/members instead, a sign-in page, so this page was not audited',
      'answered at https://example.com/members instead, a sign-in page, so this page was not audited',
    ])
  })
})
