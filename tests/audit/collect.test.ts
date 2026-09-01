import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { BuildDirectoryError, collectPages, emptyDirectoryHint } from '../../src/audit/collect.ts'

const SITE = fileURLToPath(new URL('../fixtures/site', import.meta.url))

const tempDirs: string[] = []

async function makeTempSite(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-collect-'))
  tempDirs.push(dir)
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = path.join(dir, relativePath)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, contents, 'utf8')
  }
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('collectPages', () => {
  it('collects .html and .htm files recursively, sorted by relative path', async () => {
    const pages = await collectPages(SITE)

    expect(pages.map((page) => page.relativePath)).toEqual([
      'about/index.html',
      'blog/post-1.html',
      'drafts/draft.html',
      'index.html',
      'legacy.htm',
    ])
  })

  it('always reports POSIX-separated relative paths', async () => {
    const pages = await collectPages(SITE)

    for (const page of pages) {
      expect(page.relativePath).not.toContain('\\')
    }
  })

  it('resolves absolute paths against the build directory', async () => {
    const pages = await collectPages(SITE)
    const index = pages.find((page) => page.relativePath === 'index.html')

    expect(index?.absolutePath).toBe(path.join(SITE, 'index.html'))
  })

  it('returns raw file contents', async () => {
    const pages = await collectPages(SITE)
    const index = pages.find((page) => page.relativePath === 'index.html')

    expect(index?.html).toContain('<img src="/assets/logo.svg" />')
    expect(index?.html).toContain('<title>Startseite</title>')
  })

  it('strips a UTF-8 byte-order mark so parsers see the doctype first', async () => {
    const pages = await collectPages(SITE)
    const legacy = pages.find((page) => page.relativePath === 'legacy.htm')

    expect(legacy?.html.startsWith('<!doctype html>')).toBe(true)
    expect(legacy?.html).not.toContain('\uFEFF')
  })

  it('ignores non-HTML assets', async () => {
    const pages = await collectPages(SITE)

    expect(pages.map((page) => page.relativePath)).not.toContain('assets/styles.css')
    expect(pages.map((page) => page.relativePath)).not.toContain('assets/logo.svg')
  })

  it('ignores dot directories such as build caches', async () => {
    const pages = await collectPages(SITE)

    expect(pages.some((page) => page.relativePath.startsWith('.cache/'))).toBe(false)
  })

  it('ignores vendored HTML under node_modules by default', async () => {
    const dir = await makeTempSite({
      'index.html': '<!doctype html><title>Seite</title>',
      'node_modules/some-pkg/demo.html': '<!doctype html><title>Vendor</title>',
    })

    const pages = await collectPages(dir)

    expect(pages.map((page) => page.relativePath)).toEqual(['index.html'])
  })

  it('honours a custom exclude list', async () => {
    const pages = await collectPages(SITE, { exclude: ['drafts/**'] })

    expect(pages.map((page) => page.relativePath)).not.toContain('drafts/draft.html')
    expect(pages.map((page) => page.relativePath)).toContain('index.html')
  })

  it('honours a custom include list', async () => {
    const pages = await collectPages(SITE, { include: ['blog/**/*.html'] })

    expect(pages.map((page) => page.relativePath)).toEqual(['blog/post-1.html'])
  })

  it('accepts a relative directory argument', async () => {
    const relative = path.relative(process.cwd(), SITE)

    const pages = await collectPages(relative)

    expect(pages.length).toBeGreaterThan(0)
  })

  it('returns an empty array for a directory without HTML', async () => {
    const dir = await makeTempSite({ 'assets/app.js': 'export {}' })

    await expect(collectPages(dir)).resolves.toEqual([])
  })

  it('throws BuildDirectoryError when the directory does not exist', async () => {
    const missing = path.join(SITE, 'does-not-exist')

    await expect(collectPages(missing)).rejects.toThrow(BuildDirectoryError)
    await expect(collectPages(missing)).rejects.toThrow(/Build directory not found/)
  })

  it('throws BuildDirectoryError when the path is a file', async () => {
    const file = path.join(SITE, 'index.html')

    await expect(collectPages(file)).rejects.toThrow(/not a directory/)
  })
})

describe('emptyDirectoryHint', () => {
  async function project(files: Record<string, string> = {}): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-hint-'))
    tempDirs.push(dir)
    for (const [name, body] of Object.entries(files)) {
      await mkdir(path.join(dir, path.dirname(name)), { recursive: true })
      await writeFile(path.join(dir, name), body)
    }
    return dir
  }

  const deps = (name: string): string => JSON.stringify({ devDependencies: { [name]: '1.0.0' } })

  it('points at an output that already exists', async () => {
    const dir = await project({ 'package.json': deps('next'), 'out/index.html': '<html>' })

    const hint = await emptyDirectoryHint('./dist', dir)

    expect(hint).toMatch(/Next\.js writes to out\/, not \.\/dist/)
    expect(hint).toMatch(/eaa-kit audit \.\/out/)
  })

  it.each([
    ['next', /output: 'export'/],
    ['nuxt', /nuxt generate/],
    ['@sveltejs/kit', /adapter-static/],
  ])('names what static output takes for %s', async (dependency, expected) => {
    const hint = await emptyDirectoryHint(
      './dist',
      await project({ 'package.json': deps(dependency) }),
    )

    expect(hint).toMatch(expected)
  })

  it.each([
    ['@11ty/eleventy', 'Eleventy', /_site/],
    ['gatsby', 'Gatsby', /public/],
    ['@docusaurus/core', 'Docusaurus', /build/],
  ])('names where %s writes, since it needs no extra configuration', async (dep, name, dir) => {
    const hint = await emptyDirectoryHint('./dist', await project({ 'package.json': deps(dep) }))

    expect(hint).toContain(name)
    expect(hint).toMatch(dir)
  })

  it.each(['next', 'nuxt', 'astro'])(
    'points %s at --url, which static output cannot cover',
    async (dependency) => {
      // A site with server-rendered routes cannot be written to disk at all, so
      // advice that stops at "run your build" is a dead end for it.
      const hint = await emptyDirectoryHint(
        './dist',
        await project({ 'package.json': deps(dependency) }),
      )

      expect(hint).toMatch(/--url http:\/\/localhost:3000/)
    },
  )

  it.each(['gatsby', '@11ty/eleventy'])(
    'does not offer --url for %s, which always writes files',
    async (dependency) => {
      const hint = await emptyDirectoryHint(
        './dist',
        await project({ 'package.json': deps(dependency) }),
      )

      expect(hint).not.toMatch(/--url/)
    },
  )

  it('recognises the framework from its config file alone', async () => {
    // package.json may be missing, unreadable, or belong to a workspace root
    // rather than the project in front of us.
    const hint = await emptyDirectoryHint('./dist', await project({ 'next.config.mjs': '' }))

    expect(hint).toContain('Next.js')
  })

  it('reads a custom output directory out of the config', async () => {
    const dir = await project({
      'package.json': deps('vite'),
      'vite.config.ts': "export default { build: { outDir: 'www' } }",
    })

    expect(await emptyDirectoryHint('./dist', dir)).toMatch(/www/)
  })

  it('does not tell somebody to try the directory they just tried', async () => {
    const hint = await emptyDirectoryHint(
      './dist',
      await project({ 'package.json': deps('gatsby'), x: '' }),
    )

    expect(hint).not.toMatch(/eaa-kit audit \.\/dist\b/)
  })

  it('names a build directory the project actually has', async () => {
    const hint = await emptyDirectoryHint('./dist', await project({ '_site/index.html': '<html>' }))

    expect(hint).toMatch(/This project also has _site\//)
  })

  it('falls back to the usual directories and to --url', async () => {
    const hint = await emptyDirectoryHint('./dist', await project({ 'package.json': '{}' }))

    expect(hint).toMatch(/commonly dist\/, build\/, out\/ or _site\//)
    expect(hint).toMatch(/--url http:\/\/localhost:3000/)
  })

  it('says a missing directory is missing rather than empty', async () => {
    const hint = await emptyDirectoryHint('./nope', await project())

    expect(hint).toMatch(/^\.\/nope does not exist\./)
  })

  it('repeats back the directory it was given', async () => {
    const hint = await emptyDirectoryHint('./build', await project({ 'build/x.txt': '' }))

    expect(hint).toMatch(/^\.\/build holds no HTML files\./)
  })
})

/**
 * Whether this platform and user can make a file unreadable at all.
 *
 * Two environments cannot, for unrelated reasons: root bypasses the mode bits,
 * and Windows' chmod only toggles a read-only flag that does not stop a read.
 * Both would make these cases assert against a file the process can happily
 * open, so both have to be skipped — and enumerating them by name is how the
 * first attempt got it wrong, since `process.getuid` does not exist on Windows
 * and a root check silently passed there.
 *
 * So it is measured rather than guessed: write a file, deny it, try to read it.
 * That is exactly the precondition, and it stays right on a platform nobody
 * thought about.
 */
const canDenyReads = await (async (): Promise<boolean> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'eaa-collect-probe-'))
  try {
    const file = path.join(dir, 'denied')
    await writeFile(file, 'x')
    await chmod(file, 0o000)
    try {
      await readFile(file, 'utf8')
      return false
    } catch {
      return true
    }
  } finally {
    await chmod(path.join(dir, 'denied'), 0o644).catch(() => {})
    await rm(dir, { recursive: true, force: true })
  }
})()

describe.skipIf(!canDenyReads)('a file that cannot be read', () => {
  async function siteWithUnreadableFile(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'eaa-collect-'))
    tempDirs.push(dir)
    await writeFile(path.join(dir, 'good.html'), '<!doctype html><title>ok</title>')
    await writeFile(path.join(dir, 'bad.html'), '<!doctype html><title>no</title>')
    await chmod(path.join(dir, 'bad.html'), 0o000)
    return dir
  }

  it('is reported and skipped rather than failing the whole collection', async () => {
    // One bad permission bit in a build directory used to reject everything, so
    // the run reported as a crash rather than as the one page nobody could
    // look at.
    const dir = await siteWithUnreadableFile()

    const unreadable: Array<{ file: string; reason: string }> = []
    const pages = await collectPages(dir, {
      onUnreadable: (file, reason) => unreadable.push({ file, reason }),
    })

    expect(pages.map((page) => page.relativePath)).toEqual(['good.html'])
    expect(unreadable).toHaveLength(1)
    expect(unreadable[0]?.file).toBe('bad.html')
  })

  it('still throws when nobody said they would report it', async () => {
    // The failure is only swallowed where a caller has undertaken to name it.
    const dir = await siteWithUnreadableFile()

    await expect(collectPages(dir)).rejects.toThrow()
  })
})

describe('a page too large to read', () => {
  /**
   * Nothing about a build guarantees its .html files are pages. A generated
   * catalogue, a database export, a log redirected into the build directory —
   * all glob as HTML, and reading one into a string to hand to jsdom is an
   * out-of-memory crash that takes the whole run with it, findings and all.
   */
  async function siteWithOversizePage(): Promise<string> {
    return makeTempSite({
      'good.html': '<!doctype html><html lang="en"></html>',
      'huge.html': 'x'.repeat(4096),
    })
  }

  it('is declined and reported, leaving the rest of the build audited', async () => {
    const dir = await siteWithOversizePage()

    const unreadable: Array<{ file: string; reason: string }> = []
    const pages = await collectPages(dir, {
      maxBytes: 1024,
      onUnreadable: (file, reason) => unreadable.push({ file, reason }),
    })

    expect(pages.map((page) => page.relativePath)).toEqual(['good.html'])
    expect(unreadable).toHaveLength(1)
    expect(unreadable[0]?.file).toBe('huge.html')
    expect(unreadable[0]?.reason).toMatch(/over the/)
  })

  it('says how big it was and what the limit is', async () => {
    // The reader has to be able to tell a file that is genuinely too big from
    // one the tool declined for a reason it cannot see.
    const dir = await siteWithOversizePage()

    const unreadable: string[] = []
    await collectPages(dir, {
      maxBytes: 1024,
      onUnreadable: (_file, reason) => unreadable.push(reason),
    })

    expect(unreadable[0]).toMatch(/MB/)
  })

  it('still throws when nobody said they would report it', async () => {
    const dir = await siteWithOversizePage()

    await expect(collectPages(dir, { maxBytes: 1024 })).rejects.toThrow(/limit/)
  })
})

describe('advice for a project that writes no HTML at all', () => {
  it('names the serve command instead of a build directory', async () => {
    // "No HTML found in ./dist" describes a directory that was never going to
    // hold any, so there is no path to correct and nothing to build.
    const dir = await makeTempSite({ artisan: '' })

    const hint = await emptyDirectoryHint('./dist', dir)

    expect(hint).toContain('Laravel')
    expect(hint).toContain('writes no HTML to disk')
    expect(hint).toContain('php artisan serve')
    expect(hint).toContain('eaa-kit audit --url')
    // The thing it must never say: a directory to try that cannot exist.
    expect(hint).not.toContain('./undefined')
    expect(hint).not.toContain('Run your build')
  })

  it('says the same for a WordPress site whose theme is built with Vite', async () => {
    const dir = await makeTempSite({
      'wp-config.php': '',
      'package.json': JSON.stringify({ devDependencies: { vite: '5.0.0' } }),
    })

    const hint = await emptyDirectoryHint('./dist', dir)

    expect(hint).toContain('WordPress')
    expect(hint).toContain('eaa-kit audit --url')
  })
})
