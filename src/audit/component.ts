import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { glob } from 'tinyglobby'
import { toPosix } from '../fs.ts'
import { collapse } from '../text.ts'

/**
 * Which source file a failing element was written in.
 *
 * Route mapping names the page, and on a site built from components the page is
 * not where the fix goes: a header with a missing `alt` appears on every page
 * that renders it and is written in none of them. The Issues view can already
 * tell that one element is shared across pages; this says which file to open.
 *
 * The method is deliberately dumb. Take a literal out of the failing markup —
 * an image path, a link target, an id — and look for it in the project's own
 * source. Frameworks do emit source positions, but only in development builds,
 * and an auditor runs against production output. A literal survives every
 * compiler.
 *
 * It never guesses. A literal found in two files names neither, because a wrong
 * file is worse than none: it sends somebody to edit code that was not the
 * cause, and costs more than the minute it saved.
 */

/** Where component source is expected to live. */
const SOURCE_GLOBS = [
  '**/*.{tsx,jsx,ts,js,mjs,vue,svelte,astro,mdx,md,html,php,erb,twig,liquid,hbs}',
] as const

/** Never source: dependencies, build output, version control. */
const NEVER = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/_site/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/.svelte-kit/**',
  '**/.output/**',
  '**/coverage/**',
  '**/*.min.js',
] as const

/** Files read into the index. A ceiling, not a target. */
const MAX_FILES = 2000

/** Bytes per file. A source file past this is generated or vendored. */
const MAX_BYTES = 512 * 1024

export interface ComponentIndex {
  /** Project-relative path to its contents. */
  files: Map<string, string>
}

/**
 * Read the project's source once, so every element can be looked up against it.
 *
 * Once rather than per element: a site with forty violations would otherwise
 * walk the tree forty times for an answer that does not change.
 */
export async function buildComponentIndex(cwd: string): Promise<ComponentIndex> {
  const found = await glob([...SOURCE_GLOBS], {
    cwd,
    ignore: [...NEVER],
    onlyFiles: true,
    dot: false,
  })

  const files = new Map<string, string>()
  for (const relative of found.slice(0, MAX_FILES).sort()) {
    try {
      const source = await readFile(path.resolve(cwd, relative), 'utf8')
      if (source.length <= MAX_BYTES) files.set(toPosix(relative), source)
    } catch {
      // Unreadable is not source we can search.
    }
  }
  return { files }
}

/**
 * Literals worth searching for, most distinctive first.
 *
 * An image path or a link target is written by hand and survives compilation.
 * A class name may be generated, and text content may be interpolated, so both
 * come after. Anything short is dropped: `/` appears in every file.
 */
export function searchTermsFor(html: string): string[] {
  const terms: string[] = []
  const add = (value: string | undefined): void => {
    if (value === undefined) return
    const trimmed = value.trim()
    // Short, or a template placeholder that was interpolated at build time and
    // therefore appears nowhere in the source as written.
    if (trimmed.length < 4 || trimmed.includes('${')) return
    if (!terms.includes(trimmed)) terms.push(trimmed)
  }

  for (const attribute of ['src', 'href', 'id', 'data-testid', 'name', 'action']) {
    const match = new RegExp(`\\s${attribute}\\s*=\\s*["']([^"']+)["']`, 'i').exec(html)
    add(match?.[1])
  }

  // Text content last: it is the least reliable, being the thing most likely to
  // come from a CMS or a translation file rather than the component.
  const text = collapse(html.replace(/<[^>]*>/g, ' '))
  if (text.length >= 8) add(text.slice(0, 60))

  return terms
}

/** Where an element was written: the file, and where in it. */
export interface ComponentLocation {
  /** Project-relative path, POSIX separators. */
  file: string
  /** 1-based line the matched literal sits on. */
  line: number
  /** 1-based column. */
  column: number
}

/**
 * The one source file this element was written in, if exactly one claims it.
 *
 * Returns undefined when nothing matches and when more than one does. The
 * second case is the important one: naming a file that merely happens to
 * contain the same path sends somebody to edit the wrong component.
 *
 * The position comes free. The search already has to find the literal to know
 * the file contains it, so recording where it found it costs one more scan of
 * one string — and a report that says `Header.astro:12` opens an editor where a
 * report that says `Header.astro` starts a search.
 */
export function componentFor(index: ComponentIndex, html: string): ComponentLocation | undefined {
  for (const term of searchTermsFor(html)) {
    const matches: Array<{ file: string; offset: number }> = []
    for (const [file, source] of index.files) {
      const offset = source.indexOf(term)
      if (offset !== -1) {
        matches.push({ file, offset })
        // Two is already ambiguous; counting the rest buys nothing.
        if (matches.length > 1) break
      }
    }
    const only = matches.length === 1 ? matches[0] : undefined
    if (only !== undefined) {
      const source = index.files.get(only.file) as string
      return { file: only.file, ...positionOf(source, only.offset) }
    }
  }
  return undefined
}

/** 1-based line and column of a byte offset in a source file. */
function positionOf(source: string, offset: number): { line: number; column: number } {
  let line = 1
  let lineStart = 0
  for (let i = 0; i < offset; i += 1) {
    if (source[i] === '\n') {
      line += 1
      lineStart = i + 1
    }
  }
  return { line, column: offset - lineStart + 1 }
}

/** `components/Header.astro:12`, as both reports name a component. */
export function componentPath(location: ComponentLocation): string {
  return `${location.file}:${location.line}`
}
