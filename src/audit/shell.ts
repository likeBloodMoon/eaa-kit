/**
 * Whether a page is an empty shell that a script fills in.
 *
 * A single-page app's build writes one `index.html` holding an empty
 * `<div id="root">` and a script tag. The browserless engine does not run
 * scripts, so it audits the empty div, finds nothing wrong with it, and the
 * run reports a clean site that was never looked at. That is the false
 * assurance this tool exists to refuse, so such a page is set aside and named
 * as not audited instead.
 *
 * The test is what a visitor could perceive before any script runs: text,
 * images and media, embedded frames, and form controls. A page with none of
 * those is a shell, whatever its root element is called.
 */
export function isAppShell(html: string): boolean {
  // Linear scans rather than the regular expressions this used to be: each
  // of those ran to the end of the page from every unclosed `<style`, `<!--`
  // or `<` it met, so a page full of them took minutes — and every crawled
  // page goes through here, whoever wrote it.
  const lower = html.toLowerCase()
  const bodyOpen = lower.indexOf('<body')
  const bodyClose = lower.lastIndexOf('</body')
  let body: string
  if (bodyOpen !== -1 && bodyClose > bodyOpen) {
    const tagEnd = html.indexOf('>', bodyOpen)
    body = tagEnd === -1 || tagEnd > bodyClose ? '' : html.slice(tagEnd + 1, bodyClose)
  } else {
    body = withoutElements(html, ['head'], true)
  }
  const visible = withoutComments(body)
  if (
    /<(img|svg|video|audio|canvas|iframe|object|embed|input|select|textarea|button|picture)\b/i.test(
      visible,
    )
  ) {
    return false
  }
  // Never shown as they are, and a noscript apology is not the page either.
  const text = withoutTags(withoutElements(visible, ['script', 'style', 'template', 'noscript']))
    .replace(/&nbsp;|&#160;/g, ' ')
    .trim()
  return text === ''
}

/** `<!-- … -->` taken out; an unclosed one runs to the end, as a browser reads it. */
function withoutComments(html: string): string {
  let output = ''
  let cursor = 0
  for (;;) {
    const open = html.indexOf('<!--', cursor)
    if (open === -1) return output + html.slice(cursor)
    output += html.slice(cursor, open)
    const close = html.indexOf('-->', open + 4)
    if (close === -1) return output
    cursor = close + 3
  }
}

/**
 * Elements with these names taken out with their content. One left open is
 * taken out to the end, which is what the old pattern's failure to match left
 * in place instead; for a page that is never shown either way it is the same
 * answer. `firstOnly` removes just the first, for the head.
 */
function withoutElements(html: string, names: readonly string[], firstOnly = false): string {
  const lower = html.toLowerCase()
  const opening = new RegExp(`<(${names.join('|')})\\b`, 'g')
  let output = ''
  let cursor = 0
  for (;;) {
    opening.lastIndex = cursor
    const match = opening.exec(lower)
    if (match === null) return output + html.slice(cursor)
    output += html.slice(cursor, match.index)
    const close = closingTag(lower, match[1] as string, match.index + match[0].length)
    if (close === -1) return firstOnly ? output + html.slice(match.index) : output
    const end = lower.indexOf('>', close)
    cursor = end === -1 ? html.length : end + 1
    if (firstOnly) return output + html.slice(cursor)
  }
}

/** Where `</name` starts, as a whole name: `</head` is not `</header`. */
function closingTag(lower: string, name: string, from: number): number {
  let at = lower.indexOf(`</${name}`, from)
  while (at !== -1 && /[a-z0-9-]/.test(lower[at + name.length + 2] ?? '')) {
    at = lower.indexOf(`</${name}`, at + 1)
  }
  return at
}

/** Markup taken out, text kept. A `<` with no `>` after it is text, as before. */
function withoutTags(html: string): string {
  let output = ''
  let cursor = 0
  for (;;) {
    const open = html.indexOf('<', cursor)
    if (open === -1) return output + html.slice(cursor)
    const close = html.indexOf('>', open + 1)
    if (close === -1) return output + html.slice(cursor)
    output += html.slice(cursor, open)
    cursor = close + 1
  }
}
