import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolvePages } from '../../src/cli/pages.ts'

/**
 * Where the pages come from, and what the caller is told about it.
 *
 * The directory this stage settles on is not always the one the caller passed:
 * `eaa-kit audit` with no argument passes nothing and lets auto-detection work
 * it out. A caller that reached for its own argument instead got undefined, and
 * the browser runner reads exactly that to decide whether these pages live on
 * disk and need serving over loopback or came off a site of their own.
 */

let project: string

beforeEach(async () => {
  project = await mkdtemp(path.join(tmpdir(), 'eaa-kit-pages-'))
  await writeFile(path.join(project, 'package.json'), '{"name":"site","private":true}', 'utf8')
  await mkdir(path.join(project, 'dist'), { recursive: true })
  await writeFile(
    path.join(project, 'dist', 'index.html'),
    '<!doctype html><html lang="en"><head><title>Home</title></head><body><h1>Home</h1></body></html>',
    'utf8',
  )
  // Progress goes to stderr and is not what these cases are about.
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(project, { recursive: true, force: true })
})

describe('resolvePages', () => {
  it('reports the directory it worked out when nobody named one', async () => {
    // The regression: `audit --browser` with no directory argument navigated
    // Chromium to a bare filesystem path — which is not a URL — because this
    // was the only thing that knew where the build was, and it did not say.
    // Every page came back errored, under a summary reading "No violations".
    const resolved = await resolvePages(undefined, { cwd: project, noBuild: true })

    expect(resolved?.pages).toHaveLength(1)
    expect(resolved?.directory).toBe(path.join(project, 'dist'))
  })

  it('reports the directory it was given', async () => {
    const dir = path.join(project, 'dist')

    const resolved = await resolvePages(dir, { cwd: project })

    expect(resolved?.directory).toBe(dir)
  })

  it('reports no directory for a crawl, whose pages are not read off disk', async () => {
    // Serving a crawled page back out of a copy on disk would audit the markup
    // with the server that produced it cut out of the picture, so the browser
    // runner has to be able to tell the two apart.
    const { createServer } = await import('node:http')
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(
        '<!doctype html><html lang="en"><head><title>A</title></head><body>a</body></html>',
      )
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as { port: number }

    try {
      const resolved = await resolvePages(undefined, { url: `http://127.0.0.1:${port}/` })

      expect(resolved?.pages.length).toBeGreaterThan(0)
      expect(resolved?.directory).toBeUndefined()
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
