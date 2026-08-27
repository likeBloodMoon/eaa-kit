import { TOOL_VERSION } from '../version.ts'

/**
 * Markdown-to-HTML for exactly the subset the statement templates emit, and
 * nothing else.
 *
 * A general markdown parser is a dependency and a licence audit for a document
 * whose entire vocabulary is four block types. What the templates produce:
 *
 *   # heading            level-1 and level-2 headings
 *   ## heading
 *   paragraph text       soft-wrapped; joined back into one paragraph
 *   - list item          with two-space continuation lines belonging to it
 *   ---                  a horizontal rule before the disclaimer
 *
 * Anything else is emitted as literal text, escaped. Emphasis, links, images
 * and code spans are deliberately not implemented: a `**` in someone's issue
 * description is far more likely to be a typo than a request for bold, and
 * silently swallowing characters out of a legal document is the worse failure.
 * Bare URLs and email addresses do become links, because they are unusable in
 * an HTML document otherwise.
 */

export interface HtmlDocumentOptions {
  /**
   * BCP 47 tag for the document text, e.g. 'de'. Becomes `<html lang>`, without
   * which a screen reader announces German prose with an English voice.
   */
  lang: string
  /** `<title>` when the markdown has no level-1 heading to take one from. */
  fallbackTitle: string
}

/**
 * A standalone, self-contained HTML page.
 *
 * Self-contained because the common destination is a CMS or a static host where
 * a second file would have to be wired up by hand. The markup inside `<main>`
 * carries no classes and no inline styles, so lifting it into an existing page
 * template and dropping this one's `<style>` block is a copy and paste.
 */
export function toHtmlDocument(markdown: string, options: HtmlDocumentOptions): string {
  const body = toHtmlBody(markdown)
  const title = firstHeading(markdown) ?? options.fallbackTitle

  return `<!doctype html>
<html lang="${escapeAttribute(options.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="eaa-kit ${escapeAttribute(TOOL_VERSION)}">
<title>${escapeText(title)}</title>
<style>
${STYLES}
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`
}

/** The document body: the block elements alone, for embedding in a page. */
export function toHtmlBody(markdown: string): string {
  const html: string[] = []
  const lines = markdown.split('\n')
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''

    if (line.trim() === '') {
      index += 1
      continue
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    if (heading?.[1] && heading[2] !== undefined) {
      const level = heading[1].length
      html.push(`<h${level}>${inline(heading[2].trim())}</h${level}>`)
      index += 1
      continue
    }

    // Three or more dashes on their own line. Markdown also allows this as a
    // setext underline, but the templates never put text above it.
    if (/^-{3,}$/.test(line.trim())) {
      html.push('<hr>')
      index += 1
      continue
    }

    if (isListItem(line)) {
      const list = takeList(lines, index)
      html.push(list.html)
      index = list.next
      continue
    }

    const paragraph = takeParagraph(lines, index)
    html.push(`<p>${inline(paragraph.text)}</p>`)
    index = paragraph.next
  }

  return html.join('\n')
}

const STYLES = `:root { color-scheme: light dark; }
body { margin: 0; background: #ffffff; color: #1a1a1a;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; line-height: 1.6; }
main { max-width: 44rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
h1 { font-size: 1.9rem; line-height: 1.25; margin: 0 0 1.5rem; }
h2 { font-size: 1.3rem; line-height: 1.3; margin: 2.5rem 0 0.75rem; }
p { margin: 0 0 1rem; }
ul { margin: 0 0 1rem; padding-left: 1.25rem; }
li + li { margin-top: 0.75rem; }
a { color: #0b4fa8; }
a:focus-visible { outline: 3px solid currentColor; outline-offset: 2px; }
hr { border: 0; border-top: 1px solid #767676; margin: 2.5rem 0; }
@media (prefers-color-scheme: dark) {
  body { background: #121212; color: #ededed; }
  a { color: #9ec1ff; }
}`

function isListItem(line: string): boolean {
  return /^[-*]\s+/.test(line)
}

/** A continuation line: indented, and part of the item above it. */
function isContinuation(line: string): boolean {
  return /^\s+\S/.test(line) && !isListItem(line.trim())
}

/**
 * One `<ul>`, with each item's continuation lines kept inside the item it
 * belongs to. The templates put an issue's standards reference, reason and
 * remedy date on those lines, and promoting them to items of their own would
 * read as four separate barriers instead of one described in detail.
 */
function takeList(lines: string[], from: number): { html: string; next: number } {
  const items: string[][] = []
  let index = from

  while (index < lines.length) {
    const line = lines[index] ?? ''

    if (isListItem(line)) {
      items.push([line.replace(/^[-*]\s+/, '').trim()])
      index += 1
      continue
    }

    const current = items.at(-1)
    if (current && isContinuation(line)) {
      current.push(line.trim())
      index += 1
      continue
    }

    break
  }

  const rendered = items.map((item) => `  <li>${item.map(inline).join('<br>\n  ')}</li>`).join('\n')

  return { html: `<ul>\n${rendered}\n</ul>`, next: index }
}

/** Soft-wrapped lines are one paragraph, as in markdown. */
function takeParagraph(lines: string[], from: number): { text: string; next: number } {
  const collected: string[] = []
  let index = from

  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (line.trim() === '' || isListItem(line) || /^#{1,3}\s/.test(line) || /^-{3,}$/.test(line)) {
      break
    }
    collected.push(line.trim())
    index += 1
  }

  return { text: collected.join(' '), next: index }
}

function firstHeading(markdown: string): string | undefined {
  for (const line of markdown.split('\n')) {
    const match = /^#\s+(.*)$/.exec(line)
    if (match?.[1]) return match[1].trim()
  }
  return undefined
}

/** URLs and email addresses, which the templates write bare. */
const LINKABLE = /(https?:\/\/[^\s<>"']+|[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+)/g

function inline(text: string): string {
  let output = ''
  let cursor = 0

  for (const match of text.matchAll(LINKABLE)) {
    const raw = match[0]
    const start = match.index

    output += escapeText(text.slice(cursor, start))

    // A URL at the end of a sentence swallows the full stop otherwise, and a
    // trailing bracket belongs to the prose unless the URL opened one.
    const trailing = trailingPunctuation(raw)
    const target = raw.slice(0, raw.length - trailing.length)
    const href = target.includes('@') ? `mailto:${target}` : target

    output += `<a href="${escapeAttribute(href)}">${escapeText(target)}</a>${escapeText(trailing)}`
    cursor = start + raw.length
  }

  return output + escapeText(text.slice(cursor))
}

function trailingPunctuation(candidate: string): string {
  let end = candidate.length
  while (end > 0) {
    const character = candidate[end - 1] ?? ''
    if ('.,;:!?'.includes(character)) {
      end -= 1
      continue
    }
    // Only unmatched, so https://en.wikipedia.org/wiki/Foo_(bar) survives.
    if (character === ')' && !candidate.slice(0, end).includes('(')) {
      end -= 1
      continue
    }
    break
  }
  return candidate.slice(end)
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
