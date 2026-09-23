import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { glob } from 'tinyglobby'

/**
 * What a built site says about itself, read from its home page.
 *
 * `init` used to know only what package.json says: a package name and, if
 * somebody filled it in, a homepage. The built site usually says more, and
 * says it outright. `<html lang>` gives the site's language, the canonical
 * link gives its address, and `<title>` gives what it calls itself. These are
 * things the site states, not guesses, which is the only kind of default
 * `init` offers.
 *
 * Read with patterns rather than parsed. This runs before any engine is
 * loaded, and loading jsdom to read three attributes would cost more than the
 * whole first run is meant to take.
 */
export interface SiteFacts {
  /** The BCP 47 tag on `<html lang>`, e.g. `pl-PL`. */
  lang?: string
  /** The origin of `<link rel="canonical">` or `og:url`. */
  url?: string
  title?: string
}

/** The home page, or failing that the first page in path order. */
async function homePage(directory: string): Promise<string | undefined> {
  for (const name of ['index.html', 'index.htm']) {
    const candidate = path.join(directory, name)
    try {
      return await readFile(candidate, 'utf8')
    } catch {
      // not this one
    }
  }
  const pages = (
    await glob(['**/*.html', '**/*.htm'], {
      cwd: directory,
      ignore: ['**/node_modules/**'],
      onlyFiles: true,
      dot: false,
    })
  ).sort()
  const first = pages[0]
  if (first === undefined) return undefined
  try {
    return await readFile(path.join(directory, first), 'utf8')
  } catch {
    return undefined
  }
}

export async function readSiteFacts(directory: string): Promise<SiteFacts> {
  const html = await homePage(directory)
  if (html === undefined) return {}
  return siteFactsFrom(html)
}

export function siteFactsFrom(html: string): SiteFacts {
  const facts: SiteFacts = {}

  const htmlTag = /<html\b[^>]*>/i.exec(html)?.[0]
  const lang = htmlTag === undefined ? undefined : attribute(htmlTag, 'lang')
  if (lang !== undefined && /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(lang)) facts.lang = lang

  const url = canonicalUrl(html)
  if (url !== undefined) facts.url = url

  const title = /<title\b[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim()
  if (title !== undefined && title !== '') facts.title = decodeEntities(title)

  return facts
}

/**
 * The address the site gives for itself. Only an absolute http(s) URL counts:
 * a relative canonical tells you nothing about where the site lives.
 */
function canonicalUrl(html: string): string | undefined {
  const candidates: string[] = []
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = attribute(tag, 'rel')?.toLowerCase().split(/\s+/)
    const href = attribute(tag, 'href')
    if (rel?.includes('canonical') && href !== undefined) candidates.push(href)
  }
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const content = attribute(tag, 'content')
    if (attribute(tag, 'property') === 'og:url' && content !== undefined) candidates.push(content)
  }

  for (const candidate of candidates) {
    try {
      const url = new URL(decodeEntities(candidate))
      if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin
    } catch {
      // not absolute
    }
  }
  return undefined
}

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
  const value = match?.[1] ?? match?.[2] ?? match?.[3]
  return value === undefined ? undefined : value.trim()
}

/** The five entities a title or URL realistically carries. */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
}
