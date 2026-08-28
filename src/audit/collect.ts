import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { glob } from 'tinyglobby'

/** Every HTML document a static build is expected to emit. */
export const DEFAULT_INCLUDE = ['**/*.html', '**/*.htm'] as const

/** Vendored and tooling directories are never part of the shipped site. */
export const DEFAULT_EXCLUDE = ['**/node_modules/**', '**/.git/**'] as const

/** Number of files read in parallel; keeps large builds under the fd limit. */
const READ_CONCURRENCY = 24

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
    pages.push(...(await Promise.all(batch.map((relativePath) => readPage(root, relativePath)))))
  }
  return pages
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

async function readPage(root: string, relativePath: string): Promise<CollectedPage> {
  const absolutePath = path.join(root, relativePath)
  const html = await readFile(absolutePath, 'utf8')
  return {
    absolutePath,
    relativePath,
    html: html.charCodeAt(0) === 0xfeff ? html.slice(1) : html,
  }
}

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join('/')
}

/**
 * What to suggest when a directory exists but holds no HTML.
 *
 * Nearly always the wrong directory rather than a site with no pages, and the
 * commonest way to arrive here is a framework whose build does not emit
 * browsable HTML at all — `./dist` is every tutorial's answer and is wrong for
 * all of them. So rather than repeating "check the path", this looks at what
 * the project actually has and names the next step: an `out/` that already
 * exists, a `.next/` that was built without an export, a config with no
 * `output: 'export'` in it, or a site that cannot be exported at all, which is
 * what `--url` is for.
 */
export async function emptyDirectoryHint(dir: string, cwd = process.cwd()): Promise<string> {
  const exists = async (name: string): Promise<boolean> => {
    try {
      await stat(path.resolve(cwd, name))
      return true
    } catch {
      return false
    }
  }

  const read = async (name: string): Promise<string | undefined> => {
    try {
      return await readFile(path.resolve(cwd, name), 'utf8')
    } catch {
      return undefined
    }
  }

  // The caller reaches this both for a directory that holds no HTML and for one
  // that is not there at all, and telling somebody a missing directory "holds
  // no HTML files" reads as though the tool did not look.
  const head = (await exists(dir)) ? `${dir} holds no HTML files.` : `${dir} does not exist.`

  const configs = await Promise.all(
    ['next.config.js', 'next.config.mjs', 'next.config.ts'].map(async (name) =>
      (await exists(name)) ? name : undefined,
    ),
  )
  const config = configs.find((name) => name !== undefined)

  if (config !== undefined) {
    // An export that already ran is the likeliest thing, and pointing at it is
    // a one-line fix rather than an explanation.
    if (await exists('out')) {
      return `${head} A Next.js static export writes to out/, not ${dir}.\n  Try: eaa-kit audit ./out`
    }

    const source = (await read(config)) ?? ''
    const exports = /output\s*:\s*['"`]export['"`]/.test(source)

    if (!exports) {
      return (
        `${head} A Next.js build writes a server bundle, not browsable HTML.\n` +
        `  To audit it, add output: 'export' to ${config}, run your build, then:\n` +
        '    eaa-kit audit ./out\n' +
        '  A site with SSR, API routes, middleware or ISR cannot be exported. Audit it\n' +
        '  running instead:\n' +
        '    eaa-kit audit --url http://localhost:3000'
      )
    }

    // Configured to export but nothing came out: the build has not run, or it
    // failed. Saying which is beyond what can be told from here.
    return (
      `${head} ${config} sets output: 'export', but there is no out/ directory.\n` +
      '  Run your build first, then: eaa-kit audit ./out\n' +
      '  If the build failed, it names what blocks the export — an API route,\n' +
      '  middleware, getServerSideProps or a revalidate.'
    )
  }

  if (await exists('nuxt.config.ts')) {
    return (
      `${head} Nuxt writes a static build to .output/public.\n` +
      '  Try: eaa-kit audit ./.output/public\n' +
      '  Or audit it running: eaa-kit audit --url http://localhost:3000'
    )
  }

  // Nothing recognised. Naming a directory that is actually there beats listing
  // the ones that usually are.
  const candidates = ['dist', 'build', 'out', '_site', 'public', '.output/public']
  const present: string[] = []
  for (const name of candidates) {
    if (name !== dir.replace(/^\.\//, '') && (await exists(name))) present.push(name)
  }
  if (present.length > 0) {
    return `${head} This project also has ${present.map((name) => `${name}/`).join(', ')} — try one of those.`
  }

  return (
    `${head} Point eaa-kit at the directory your build fills with .html files —\n` +
    '  commonly dist/, build/, out/ or _site/, depending on the builder.\n' +
    '  If your site renders on a server and never writes HTML, audit it running:\n' +
    '    eaa-kit audit --url http://localhost:3000'
  )
}
