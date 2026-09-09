/**
 * Request headers for the pages this tool fetches.
 *
 * The two places a small agency stages work are the two this tool could not
 * reach: a preview deployment, which every host protects by default, and a CMS
 * staging site behind basic auth or a session cookie. `--url` sent one fixed
 * pair of headers and had no way to add to it, so auditing either meant putting
 * the site on the public internet first.
 *
 * These values are credentials. They are handled on the principle that the tool
 * never writes one down: nothing here reaches a report, a baseline, a SARIF log
 * or the completeness record, and the errors below name the header rather than
 * echoing what was typed, because a malformed `--header` is exactly the case
 * where the value is a token and the terminal is a CI log.
 *
 * For the same reason there is no `headers` key in `eaa.config`. That file is
 * committed; a token in it is a token in the repository, and a tool that
 * offered the field would be inviting that. Pass them as flags — a shell
 * expands `--header "Authorization: Bearer $TOKEN"` — or as the GitHub Action's
 * input, which reads from `secrets`.
 */

/** Thrown for a header this cannot parse. Never carries the value. */
export class HeaderError extends Error {
  override readonly name = 'HeaderError'
}

/**
 * `Name: value` into a pair.
 *
 * Lenient about the space after the colon and about a value containing colons,
 * which `Authorization: Basic …` and a `Cookie` both do. Strict about the name,
 * because a header name is a token by RFC 9110 and anything else is a typo that
 * a server would reject in a way nobody could read.
 */
export function parseHeader(input: string): [string, string] {
  const at = input.indexOf(':')
  if (at <= 0) {
    throw new HeaderError('a header must be written "Name: value"')
  }

  const name = input.slice(0, at).trim()
  const value = input.slice(at + 1).trim()

  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) {
    throw new HeaderError(`"${name}" is not a valid header name`)
  }
  if (value === '') {
    throw new HeaderError(`the ${name} header was given no value`)
  }
  // A newline in a header value is request splitting. Nothing this tool builds
  // is a proxy, but the value comes from a command line and the cost of
  // refusing is nothing.
  if (/[\r\n]/.test(value)) {
    throw new HeaderError(`the ${name} header contains a line break`)
  }

  return [name, value]
}

/** Several `Name: value` strings into the record the fetchers take. */
export function parseHeaders(inputs: readonly string[]): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const input of inputs) {
    const [name, value] = parseHeader(input)
    headers[name] = value
  }
  return headers
}

/**
 * `user:password` into an `Authorization` header.
 *
 * Sugar for the header somebody would otherwise have to base64 by hand, which
 * is the one credential a staging site is most likely to be behind. A password
 * may contain colons; a username may not, which is basic auth's own rule.
 */
export function basicAuth(input: string): [string, string] {
  const at = input.indexOf(':')
  if (at <= 0) {
    throw new HeaderError('basic auth must be written "user:password"')
  }
  const encoded = Buffer.from(input, 'utf8').toString('base64')
  return ['Authorization', `Basic ${encoded}`]
}

/**
 * The headers a run will send, from whichever flags were given.
 *
 * `--basic-auth` first, so an explicit `--header "Authorization: …"` beats it:
 * a typed header is the more specific thing to have asked for.
 */
export function requestHeaders(options: {
  header?: readonly string[]
  basicAuth?: string
}): Record<string, string> | undefined {
  const headers: Record<string, string> = {}
  if (options.basicAuth !== undefined) {
    const [name, value] = basicAuth(options.basicAuth)
    headers[name] = value
  }
  Object.assign(headers, parseHeaders(options.header ?? []))
  return Object.keys(headers).length === 0 ? undefined : headers
}
