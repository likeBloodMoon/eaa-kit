/**
 * What the entry URL of a crawl actually leads to, found before any page is
 * crawled.
 *
 * Two things can put a run somewhere other than where it was sent, and both
 * used to be discovered too late or not at all:
 *
 * - **A redirect to another site.** `https://www.gtainside.de` answers with a
 *   301 to `https://www.gtainside.com`. The crawl refused every page as
 *   "redirected off", and the run ended with an error that did not say what to
 *   do about it. The run should stop and say where the site went, and it should
 *   only go on there when somebody agrees to.
 * - **A sign-in wall.** A preview deployment or a staging CMS answers 401, or
 *   sends every request to a login form. The crawl then audited the login form
 *   and reported it as the site, which is the failure this tool is written
 *   against: a clean result for pages nobody looked at.
 *
 * So the entry is fetched first, one hop at a time, with redirects not
 * followed automatically. That gives the whole chain, the status of each hop,
 * and the page at the end of it. What to do with a redirect is the caller's
 * decision. It depends on flags and on whether there is a terminal to ask at.
 * This module only establishes the facts.
 */

/** How many redirects to follow before calling it a loop. */
const MAX_HOPS = 10

export interface Hop {
  url: string
  status: number
}

/**
 * Why the entry looks like a sign-in wall, strongest evidence first. Each one is
 * something the site itself said, not an inference from how its URLs behave.
 */
export type SignInEvidence =
  /** The server refused the request and asked for credentials. */
  | 'http-401'
  /** The server refused the request outright. */
  | 'http-403'
  /** A redirect ended at a known identity provider. */
  | 'identity-provider'
  /** A redirect ended at a path that is a sign-in page by name. */
  | 'sign-in-path'
  /** A redirect ended at a page with a password field on it. */
  | 'password-field'

export interface EntryProbe {
  /** Every URL requested, the entry first. The last one answered without redirecting. */
  hops: Hop[]
  /** Where the chain ended. */
  final: URL
  /** The status the final URL answered with. */
  status: number
  /** Set when the entry is behind a sign-in wall, with what showed it. */
  signIn?: SignInEvidence
  /** Set when the chain did not end: too many hops, or a request failed. */
  error?: string
}

/** The origins that sign people in for other sites. Suffix-matched. */
const IDENTITY_PROVIDERS = [
  'accounts.google.com',
  'login.microsoftonline.com',
  'login.live.com',
  'login.windows.net',
  'b2clogin.com',
  'okta.com',
  'oktapreview.com',
  'auth0.com',
  'onelogin.com',
  'amazoncognito.com',
  'appleid.apple.com',
  'id.atlassian.com',
]

/**
 * Paths that are a sign-in page by name: `/login`, `/sign-in`, `/wp-login.php`,
 * Keycloak's `/protocol/openid-connect/auth`, and a few other languages' words.
 */
const SIGN_IN_PATH =
  /(?:^|\/)(?:log-?in|sign-?in|signin|sso|oauth2?|authorize|auth|anmelden|connexion|accedi|inloggen|logowanie|wp-login\.php|users\/sign_in|openid-connect\/auth)(?:[/.?]|$)/i

export function isIdentityProvider(url: URL): boolean {
  const host = url.hostname.toLowerCase()
  return IDENTITY_PROVIDERS.some((provider) => host === provider || host.endsWith(`.${provider}`))
}

export function isSignInPath(url: URL): boolean {
  return SIGN_IN_PATH.test(url.pathname)
}

/** A form somebody types a password into. The shape every sign-in page has. */
export function hasPasswordField(html: string): boolean {
  return /<input\b[^>]*\btype\s*=\s*["']?password\b/i.test(html)
}

/**
 * Whether two URLs are the same site in the sense a reader means it: the same
 * host, give or take a leading `www.`, over http or https. A redirect between
 * two of these is the site tidying its own address, not a different site.
 */
export function isSameSite(a: URL, b: URL): boolean {
  const host = (url: URL): string => url.hostname.toLowerCase().replace(/^www\./, '')
  return host(a) === host(b) && a.port === b.port
}

export interface ProbeOptions {
  fetchImpl?: typeof fetch
  timeoutMs: number
  /**
   * The caller's credentials. Sent only while a hop stays on the entry's
   * origin: `fetch` drops an Authorization header on a cross-origin redirect
   * for the same reason, and a manual chain has to do it itself.
   */
  headers?: Record<string, string>
  maxBodyBytes: number
}

/** Follow the entry's redirects one at a time, and look at where they end. */
export async function probeEntry(entry: URL, options: ProbeOptions): Promise<EntryProbe> {
  const impl = options.fetchImpl ?? fetch
  const hops: Hop[] = []
  let current = new URL(entry.href)

  for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
    let response: Response
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), options.timeoutMs)
    try {
      response = await impl(current.href, {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'user-agent': 'eaa-kit',
          ...(current.origin === entry.origin ? options.headers : {}),
        },
      })
    } catch (cause) {
      clearTimeout(timer)
      const reason = controller.signal.aborted
        ? `timed out after ${options.timeoutMs}ms`
        : cause instanceof Error
          ? cause.message
          : String(cause)
      return { hops, final: current, status: 0, error: reason }
    }
    clearTimeout(timer)
    hops.push({ url: current.href, status: response.status })

    const location = response.headers.get('location')
    if (response.status >= 300 && response.status < 400 && location !== null) {
      await discard(response)
      current = new URL(location, current)
      current.hash = ''
      continue
    }

    const result: EntryProbe = { hops, final: current, status: response.status }
    const signIn = await signInEvidence(entry, current, response, options.maxBodyBytes)
    if (signIn !== undefined) result.signIn = signIn
    await discard(response)
    return result
  }

  return {
    hops,
    final: current,
    status: 0,
    error: `more than ${MAX_HOPS} redirects, which is a loop or close enough to one`,
  }
}

async function signInEvidence(
  entry: URL,
  final: URL,
  response: Response,
  maxBodyBytes: number,
): Promise<SignInEvidence | undefined> {
  if (response.status === 401) return 'http-401'
  if (response.status === 403) return 'http-403'

  // Only a redirect can put a sign-in page where the site was asked for. An
  // entry that answers at its own address with a form on it may simply be a
  // site whose home page has a login box, and that is the site.
  if (final.href === entry.href) return undefined
  if (isIdentityProvider(final)) return 'identity-provider'
  if (isSignInPath(final)) return 'sign-in-path'
  if (!response.ok) return undefined

  const type = response.headers.get('content-type') ?? ''
  if (!/\b(?:text\/html|application\/xhtml\+xml)\b/i.test(type)) return undefined
  const text = await readUpTo(response, maxBodyBytes)
  return hasPasswordField(text) ? 'password-field' : undefined
}

/**
 * Let go of a body that was not read, so the connection is released. One that
 * was read is locked to its reader and already finished with.
 */
async function discard(response: Response): Promise<void> {
  if (response.body === null || response.body.locked) return
  await response.body.cancel()
}

/** A body, cut off at a limit rather than refused: this only looks for a form. */
async function readUpTo(response: Response, limit: number): Promise<string> {
  const reader = response.body?.getReader()
  if (reader === undefined) return ''
  const decoder = new TextDecoder()
  let text = ''
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    text += decoder.decode(value, { stream: true })
    if (size >= limit) {
      await reader.cancel()
      break
    }
  }
  return text
}

/** What each piece of evidence is, in words, for the message and the report. */
export function describeSignIn(evidence: SignInEvidence, at: string): string {
  switch (evidence) {
    case 'http-401':
      return `${at} answered 401: it asks for credentials before it shows any page`
    case 'http-403':
      return `${at} answered 403: it refuses requests that are not signed in`
    case 'identity-provider':
      return `it sends visitors to sign in at ${new URL(at).origin}`
    case 'sign-in-path':
      return `it sends visitors to a sign-in page at ${at}`
    case 'password-field':
      return `it sends visitors to ${at}, a page with a password field on it`
  }
}
