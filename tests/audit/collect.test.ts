import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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
