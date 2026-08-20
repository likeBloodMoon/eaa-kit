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
