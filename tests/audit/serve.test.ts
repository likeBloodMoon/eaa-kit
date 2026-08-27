import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { serveDirectory } from '../../src/audit/serve.ts'

const servers: Array<{ close(): Promise<void> }> = []
const dirs: string[] = []

async function site(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-serve-'))
  dirs.push(dir)
  for (const [name, contents] of Object.entries(files)) {
    const target = path.join(dir, name)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, contents, 'utf8')
  }
  return dir
}

async function serve(files: Record<string, string>) {
  const server = await serveDirectory(await site(files))
  servers.push(server)
  return server
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('serveDirectory', () => {
  it('serves a file with its content type', async () => {
    const server = await serve({ 'index.html': '<!doctype html><title>T</title>' })

    const response = await fetch(`${server.origin}/index.html`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(await response.text()).toContain('<title>T</title>')
  })

  it('serves CSS as CSS, or the browser ignores the stylesheet', async () => {
    const server = await serve({ 'assets/site.css': 'body{color:#333}' })

    const response = await fetch(`${server.origin}/assets/site.css`)

    expect(response.headers.get('content-type')).toContain('text/css')
  })

  it('resolves a root-absolute path, which is why this server exists', async () => {
    const server = await serve({
      'index.html': '<link rel="stylesheet" href="/assets/site.css">',
      'assets/site.css': 'body{color:#333}',
    })

    // Under file:// this path resolves to the filesystem root and 404s.
    const response = await fetch(`${server.origin}/assets/site.css`)

    expect(response.status).toBe(200)
  })

  it('serves index.html for a directory', async () => {
    const server = await serve({ 'about/index.html': '<h1>Über uns</h1>' })

    expect(await (await fetch(`${server.origin}/about/`)).text()).toContain('Über uns')
  })

  it('404s for something that is not there', async () => {
    const server = await serve({ 'index.html': 'x' })

    expect((await fetch(`${server.origin}/nope.html`)).status).toBe(404)
  })

  it('refuses to walk out of the root', async () => {
    const server = await serve({ 'index.html': 'x' })

    const response = await fetch(`${server.origin}/../../../../etc/passwd`)

    expect(response.status).toBe(404)
  })

  it('refuses an encoded traversal too', async () => {
    const server = await serve({ 'index.html': 'x' })

    const response = await fetch(`${server.origin}/%2e%2e%2f%2e%2e%2fpackage.json`)

    expect(response.status).toBe(404)
  })

  it('binds to loopback only', async () => {
    const server = await serve({ 'index.html': 'x' })

    expect(server.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  })

  it('decodes percent-encoded filenames', async () => {
    const server = await serve({ 'über uns.html': '<h1>ok</h1>' })

    const response = await fetch(`${server.origin}/${encodeURIComponent('über uns.html')}`)

    expect(response.status).toBe(200)
  })

  it('stops listening once closed', async () => {
    const server = await serveDirectory(await site({ 'index.html': 'x' }))
    const { origin } = server
    await server.close()

    await expect(fetch(`${origin}/index.html`)).rejects.toThrow()
  })

  // Both of these took the whole process down before they were fixed: the first
  // as an unhandled rejection out of decodeURIComponent, the second as a
  // writeHead after the 200 had already gone out. A crashed server means every
  // remaining page of a --browser run comes back unaudited.
  it.each([
    ['a stray percent', '/%'],
    ['a truncated escape', '/a%2'],
    ['a percent mid-path', '/as%sets/a.css'],
  ])('404s on %s rather than dying', async (_label, url) => {
    const server = await serve({ 'index.html': '<!doctype html><title>T</title>' })

    const response = await fetch(`${server.origin}${url}`)

    expect(response.status).toBe(404)
  })

  it('404s for a directory with no index.html, and keeps serving', async () => {
    // `<a href="/assets/">` on any real site gets here.
    const server = await serve({
      'index.html': '<!doctype html><title>T</title>',
      'assets/site.css': 'body{}',
    })

    const missing = await fetch(`${server.origin}/assets`)
    const after = await fetch(`${server.origin}/`)

    expect(missing.status).toBe(404)
    expect(after.status).toBe(200)
  })

  it('stays up after a request it could not answer', async () => {
    const server = await serve({ 'index.html': '<!doctype html><title>T</title>' })

    await fetch(`${server.origin}/%`).catch(() => undefined)
    await fetch(`${server.origin}/nope`).catch(() => undefined)

    expect((await fetch(`${server.origin}/`)).status).toBe(200)
  })
})
