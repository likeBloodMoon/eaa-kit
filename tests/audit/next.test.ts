import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { nextRoutes, readNextConfig } from '../../src/audit/next.ts'

const STACKS = fileURLToPath(new URL('../fixtures/stacks/', import.meta.url))

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function project(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-next-'))
  dirs.push(dir)
  for (const [name, body] of Object.entries(files)) {
    await mkdir(path.join(dir, path.dirname(name)), { recursive: true })
    await writeFile(path.join(dir, name), body)
  }
  return dir
}

describe('readNextConfig', () => {
  it('reads output, distDir, basePath and trailingSlash without running the file', async () => {
    const dir = await project({
      'next.config.ts': `
        import type { NextConfig } from 'next'
        const config: NextConfig = {
          output: 'standalone',
          distDir: 'build',
          basePath: '/docs',
          trailingSlash: true,
        }
        export default config
      `,
    })

    expect(await readNextConfig(dir)).toEqual({
      file: 'next.config.ts',
      output: 'standalone',
      distDir: 'build',
      basePath: '/docs',
      trailingSlash: true,
    })
  })

  it('reads a static export', async () => {
    const dir = await project({ 'next.config.mjs': "export default { output: 'export' }" })

    expect((await readNextConfig(dir)).output).toBe('export')
  })

  it('reads nothing it cannot see written down', async () => {
    const dir = await project({ 'next.config.js': 'module.exports = require("./shared")' })

    expect(await readNextConfig(dir)).toEqual({ file: 'next.config.js' })
  })

  it('has nothing to read without a config', async () => {
    expect(await readNextConfig(await project({}))).toEqual({})
  })
})

describe('nextRoutes, from a real Next.js 16 build', () => {
  it('lists every page, prerendered or not, under the basePath', async () => {
    const routes = await nextRoutes(path.join(STACKS, 'next-server'))

    expect(routes?.basePath).toBe('/docs')
    expect(routes?.pages).toEqual(['/', '/about', '/blog/first', '/blog/second', '/legacy'])
  })

  it('names a dynamic route with no page built ahead of time', async () => {
    // /user/[id] renders on request, so no list of its pages exists anywhere.
    // /blog/[slug] is dynamic too, but its pages were prerendered and listed.
    const routes = await nextRoutes(path.join(STACKS, 'next-server'))

    expect(routes?.dynamic).toEqual(['/user/[id]'])
  })

  it('lists each locale once, with the default locale unprefixed as Next serves it', async () => {
    const routes = await nextRoutes(path.join(STACKS, 'next-i18n'))

    expect(routes?.pages).toEqual(['/', '/about', '/de', '/de/about', '/posts/one'])
  })

  it('leaves out API routes and the error pages', async () => {
    const routes = await nextRoutes(path.join(STACKS, 'next-i18n'))

    expect(routes?.pages.some((page) => page.startsWith('/api'))).toBe(false)
    expect(routes?.pages.some((page) => /\/(404|500)$/.test(page))).toBe(false)
  })

  it('returns nothing when there is no build to read', async () => {
    expect(await nextRoutes(await project({ 'next.config.mjs': '' }))).toBeUndefined()
  })

  it('reads the build from distDir', async () => {
    const dir = await project({
      'next.config.mjs': "export default { distDir: 'build' }",
      'build/routes-manifest.json': JSON.stringify({ basePath: '' }),
      'build/prerender-manifest.json': JSON.stringify({ routes: {}, dynamicRoutes: {} }),
      'build/server/pages-manifest.json': JSON.stringify({ '/': 'pages/index.html' }),
    })

    expect((await nextRoutes(dir))?.pages).toEqual(['/'])
  })
})
