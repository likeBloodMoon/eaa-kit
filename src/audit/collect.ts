import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { glob } from 'tinyglobby'
import { exists, toPosix } from '../fs.ts'

/** Every HTML document a static build is expected to emit. */
export const DEFAULT_INCLUDE = ['**/*.html', '**/*.htm'] as const

/** Vendored and tooling directories are never part of the shipped site. */
export const DEFAULT_EXCLUDE = ['**/node_modules/**', '**/.git/**'] as const

/** Number of files read in parallel; keeps large builds under the fd limit. */
const READ_CONCURRENCY = 24

/** A UTF-8 byte-order mark is not markup, and jsdom treats it as text. */
export function stripBom(html: string): string {
  return html.charCodeAt(0) === 0xfeff ? html.slice(1) : html
}

export interface CollectedPage {
  /** Absolute path on disk, in platform-native separators. */
  absolutePath: string
  /** Path relative to the build directory, always POSIX-separated. */
  relativePath: string
  /** Raw file contents, UTF-8, byte-order mark stripped. */
  html: string
}

export interface CollectOptions {
  /** Glob patterns to match, relative to the build directory. */
  include?: readonly string[]
  /** Glob patterns to skip. */
  exclude?: readonly string[]
  /**
   * Called for a file that matched but could not be read.
   *
   * One unreadable file used to reject the whole collection, so a single bad
   * permission bit in a build directory reported as a crash rather than as the
   * one page nobody could look at. The rest of the build is still worth
   * auditing; what must not happen is the file going unmentioned.
   */
  onUnreadable?: (relativePath: string, reason: string) => void
}

/**
 * Thrown when the build directory itself is unusable. A missing or wrong
 * `dist/` is a user mistake worth reporting loudly, unlike a directory that
 * simply holds no HTML.
 */
export class BuildDirectoryError extends Error {
  override readonly name = 'BuildDirectoryError'

  constructor(
    message: string,
    readonly dir: string,
  ) {
    super(message)
  }
}

/**
 * Glob HTML files out of a build directory and read them.
 *
 * Returns pages sorted by relative path so reports and snapshots are stable
 * across platforms. An empty array means "no HTML found" — the caller decides
 * whether that is an error.
 */
export async function collectPages(
  dir: string,
  options: CollectOptions = {},
): Promise<CollectedPage[]> {
  const root = path.resolve(dir)
  await assertDirectory(root, dir)

  const matches = await glob(options.include ?? DEFAULT_INCLUDE, {
    cwd: root,
    ignore: options.exclude ?? DEFAULT_EXCLUDE,
    onlyFiles: true,
    dot: false,
    absolute: false,
  })

  const relativePaths = matches.map(toPosix).sort()

  const pages: CollectedPage[] = []
  for (let i = 0; i < relativePaths.length; i += READ_CONCURRENCY) {
    const batch = relativePaths.slice(i, i + READ_CONCURRENCY)
    const read = await Promise.all(
      batch.map((relativePath) => readPage(root, relativePath, options.onUnreadable)),
    )
    for (const page of read) {
      if (page !== undefined) pages.push(page)
    }
  }
  return pages
}

/**
 * Whether the directory holds any HTML at all, ignoring include and exclude.
 *
 * Asked when a run collected nothing, to tell two different mistakes apart: a
 * build directory with no pages in it, and a directory full of pages that the
 * caller's own filters excluded. The advice for the first is wrong for the
 * second — it names another directory to audit — so the question has to be
 * answered before it is given.
 *
 * Globs rather than collecting: this only needs to know whether one file
 * exists, and reading every page of a large build to answer that on a path that
 * is about to print a warning and stop would be work for nothing.
 */
export async function holdsHtml(dir: string): Promise<boolean> {
  const found = await glob([...DEFAULT_INCLUDE], {
    cwd: path.resolve(dir),
    ignore: [...DEFAULT_EXCLUDE],
    onlyFiles: true,
    dot: false,
  })
  return found.length > 0
}

async function assertDirectory(root: string, original: string): Promise<void> {
  let stats: Awaited<ReturnType<typeof stat>>
  try {
    stats = await stat(root)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new BuildDirectoryError(`Build directory not found: ${original}`, root)
    }
    throw new BuildDirectoryError(
      `Build directory is not readable: ${original} (${(cause as Error).message})`,
      root,
    )
  }
  if (!stats.isDirectory()) {
    throw new BuildDirectoryError(`Build path is not a directory: ${original}`, root)
  }
}

async function readPage(
  root: string,
  relativePath: string,
  onUnreadable: CollectOptions['onUnreadable'],
): Promise<CollectedPage | undefined> {
  const absolutePath = path.join(root, relativePath)
  try {
    const html = await readFile(absolutePath, 'utf8')
    return { absolutePath, relativePath, html: stripBom(html) }
  } catch (cause) {
    // Without a handler this stays what it was: a file the caller never hears
    // about is worse than one it cannot open, so the failure is only swallowed
    // where somebody has said they will report it.
    if (onUnreadable === undefined) throw cause
    onUnreadable(relativePath, (cause as Error).message)
    return undefined
  }
}

/**
 * What to suggest when a directory holds no HTML, or is not there at all.
 *
 * Nearly always the wrong directory rather than a site with no pages, and the
 * commonest way to arrive is a framework whose build emits no browsable HTML —
 * so rather than repeating "check the path", this works out what the project is
 * and names the next step for it. Where static output is not possible at all,
 * that step is `--url` rather than advice that cannot apply.
 */
export async function emptyDirectoryHint(dir: string, cwd = process.cwd()): Promise<string> {
  // Both a missing directory and an empty one reach here, and telling somebody
  // a directory that is not there "holds no HTML files" reads as though the
  // tool never looked.
  const head = (await exists(dir, cwd)) ? `${dir} holds no HTML files.` : `${dir} does not exist.`

  const { detectFramework } = await import('./frameworks.ts')
  const { readPackageJson } = await import('./project.ts')
  const detected = await detectFramework(cwd, await readPackageJson(cwd))

  if (detected !== undefined) return frameworkAdvice(head, detected, cwd, dir)
  return (await siblingAdvice(head, cwd, dir)) ?? generic(head)
}

/** Advice built from what the registry knows about this framework. */
async function frameworkAdvice(
  head: string,
  detected: Awaited<ReturnType<typeof import('./frameworks.ts').detectFramework>> & object,
  cwd: string,
  dir: string,
): Promise<string> {
  const { framework, outputs } = detected
  const given = dir.replace(/^\.\//, '')

  // An output that already exists is a one-line answer rather than an
  // explanation, so it is checked before anything else is said.
  for (const output of outputs) {
    if (output !== given && (await exists(output, cwd))) {
      return `${head} ${framework.name} writes to ${output}/, not ${dir}.\n  Try: eaa-kit audit ./${output}`
    }
  }

  const lines = [`${head} This is ${article(framework.name)} ${framework.name} project.`]

  // A CMS has no build directory, so there is no path to correct and nothing to
  // build: "no HTML found in ./dist" describes a directory that was never going
  // to hold any. The only honest next step is to get the site serving, so that
  // is the whole of the advice rather than a footnote under advice that cannot
  // apply.
  if (outputs.length === 0) {
    lines.push(
      `  It renders every page on a server and writes no HTML to disk, so there is`,
      `  no build directory to audit. Start it, then audit what it serves:`,
      ...(framework.serveCommand === undefined ? [] : [`    ${framework.serveCommand}`]),
      '    eaa-kit audit --url http://localhost:8000',
    )
    return lines.join('\n')
  }

  if (framework.staticOutput !== undefined) {
    lines.push(
      `  Static output takes ${framework.staticOutput.needs} — ${framework.staticOutput.how},`,
      `  then: eaa-kit audit ./${outputs[0]}`,
    )
  } else if (outputs.length === 1 && outputs[0] === given) {
    // The directory they already named. Telling them to try it again would be
    // the tool talking in a circle; what is missing is the build.
    lines.push(`  That is where it writes, so the build has not run yet — or it failed.`)
  } else {
    lines.push(
      `  It writes to ${outputs.map((output) => `${output}/`).join(' or ')}. Run your build, then:`,
      `    eaa-kit audit ./${outputs[0]}`,
    )
  }

  if (framework.serves) {
    lines.push(
      '  A site that renders on a server cannot be written to disk at all. Audit it',
      '  running instead:',
      '    eaa-kit audit --url http://localhost:3000',
    )
  }

  return lines.join('\n')
}

/** Naming a build directory that is actually there beats listing the usual ones. */
async function siblingAdvice(head: string, cwd: string, dir: string): Promise<string | undefined> {
  const { FALLBACK_OUTPUTS } = await import('./frameworks.ts')
  const given = dir.replace(/^\.\//, '')
  const found = await Promise.all(
    FALLBACK_OUTPUTS.map(async (name) =>
      name !== given && (await exists(name, cwd)) ? name : undefined,
    ),
  )
  const others = found.filter((name) => name !== undefined)
  if (others.length === 0) return undefined
  return `${head} This project also has ${others.map((name) => `${name}/`).join(', ')} — try one of those.`
}

function generic(head: string): string {
  return (
    `${head} Point eaa-kit at the directory your build fills with .html files —\n` +
    '  commonly dist/, build/, out/ or _site/, depending on the builder.\n' +
    '  If your site renders on a server and never writes HTML, audit it running:\n' +
    '    eaa-kit audit --url http://localhost:3000'
  )
}

/**
 * "a Next.js project", "an Eleventy project".
 *
 * By letter rather than by sound, which is wrong for words like "hour" and
 * right for every framework name in the registry.
 */
function article(name: string): string {
  return /^[aeiou]/i.test(name) ? 'an' : 'a'
}
