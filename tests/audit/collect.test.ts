import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { BuildDirectoryError, collectPages } from '../../src/audit/collect.ts'

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
