import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  autoDetectSource,
  detectPackageManager,
  findBuildOutput,
  readPackageJson,
} from '../../src/audit/project.ts'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function project(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-project-'))
  dirs.push(dir)
  for (const [name, body] of Object.entries(files)) {
    await mkdir(path.join(dir, path.dirname(name)), { recursive: true })
    await writeFile(path.join(dir, name), body)
  }
  return dir
}

describe('findBuildOutput', () => {
  it.each(['dist', 'out', 'build', '_site', '.output/public'])(
    'finds %s when it holds HTML',
    async (name) => {
      const dir = await project({ [`${name}/index.html`]: '<html></html>' })

      expect(await findBuildOutput(dir)).toBe(path.join(dir, name))
    },
  )

  it('ignores a directory that exists but holds no HTML', async () => {
    // .next exists after any Next.js build and holds no browsable page; public/
    // exists in most projects and holds assets. Existing is not the test.
    const dir = await project({ '.next/build-manifest.json': '{}', 'public/logo.svg': '<svg/>' })

    expect(await findBuildOutput(dir)).toBeUndefined()
  })

  it('does not take a Storybook build for the site', async () => {
    const dir = await project({ 'build/storybook-static/index.html': '<html></html>' })

    expect(await findBuildOutput(dir)).toBeUndefined()
  })

  it('finds HTML nested inside the directory', async () => {
    const dir = await project({ 'dist/blog/post/index.html': '<html></html>' })

    expect(await findBuildOutput(dir)).toBe(path.join(dir, 'dist'))
  })

  it('prefers the earlier candidate when two would match', async () => {
    // Deterministic, so two runs of the same project audit the same directory.
    const dir = await project({ 'dist/a.html': '<html>', 'out/b.html': '<html>' })

    expect(await findBuildOutput(dir)).toBe(path.join(dir, 'dist'))
  })

  it('returns nothing for a project with no build', async () => {
    expect(await findBuildOutput(await project({ 'package.json': '{}' }))).toBeUndefined()
  })
})

describe('detectPackageManager', () => {
  it.each([
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lockb', 'bun'],
    ['bun.lock', 'bun'],
    ['deno.lock', 'deno'],
    ['package-lock.json', 'npm'],
  ])('reads %s as %s', async (lockfile, expected) => {
    expect(await detectPackageManager(await project({ [lockfile]: '' }))).toBe(expected)
  })

  it('takes the packageManager field before any lockfile', async () => {
    // Corepack's field is the project stating it outright; a stray lockfile
    // from somebody running the wrong tool once is not.
    const dir = await project({
      'package.json': JSON.stringify({ packageManager: 'pnpm@10.4.1+sha512.abc' }),
      'package-lock.json': '',
    })

    expect(await detectPackageManager(dir)).toBe('pnpm')
  })

  it('ignores a packageManager field it does not know', async () => {
    const dir = await project({
      'package.json': JSON.stringify({ packageManager: 'cargo@1.0.0' }),
      'yarn.lock': '',
    })

    expect(await detectPackageManager(dir)).toBe('yarn')
  })

  it('finds the lockfile at the workspace root, above an app that has none', async () => {
    const dir = await project({
      'pnpm-lock.yaml': '',
      'pnpm-workspace.yaml': 'packages:\n  - apps/*\n',
      'apps/web/package.json': '{}',
    })

    expect(await detectPackageManager(path.join(dir, 'apps/web'))).toBe('pnpm')
  })

  it('stops looking at the repository root', async () => {
    // Above the repository is somebody else's directory, and a lockfile there
    // says nothing about this project.
    const outer = await project({
      'yarn.lock': '',
      'repo/.git/HEAD': '',
      'repo/package.json': '{}',
    })

    expect(await detectPackageManager(path.join(outer, 'repo'))).toBe('npm')
  })

  it('falls back to npm', async () => {
    // Running the wrong one either fails or silently installs a second
    // dependency tree, so this is decided by the lockfile, never guessed.
    expect(await detectPackageManager(await project({ 'package.json': '{}' }))).toBe('npm')
  })
})

describe('readPackageJson', () => {
  it('reads the scripts', async () => {
    const dir = await project({ 'package.json': JSON.stringify({ scripts: { build: 'vite' } }) })

    expect((await readPackageJson(dir))?.scripts?.['build']).toBe('vite')
  })

  it.each([
    ['no package.json', {}],
    ['a package.json that is not JSON', { 'package.json': 'not json' }],
  ])('returns nothing for %s', async (_name, files) => {
    expect(await readPackageJson(await project(files))).toBeUndefined()
  })
})

describe('a CMS is detected and then left alone', () => {
  it('never runs a build or starts a server for one', async () => {
    // Starting these means spawning a stateful, usually container-backed stack
    // that may touch a database — a great deal more than an accessibility audit
    // was asked to do, and not something to do to somebody's machine uninvited.
    const dir = await project({
      'manage.py': '',
      'package.json': JSON.stringify({ scripts: { build: 'exit 1', start: 'exit 1' } }),
    })

    const detected = await autoDetectSource(dir)

    expect(detected?.directory).toBeUndefined()
    expect(detected?.url).toBeUndefined()
    expect(detected?.steps.join(' ')).toContain('Django')
    expect(detected?.steps.join(' ')).toContain('writes no HTML to disk')
  })

  it('fires before anything else, so a CMS with no package.json is still caught', async () => {
    // Most Django and Rails projects have no package.json at all, and the
    // ordinary path gives up there. The guard has to come first, or the reader
    // gets the generic "point me at a build directory" advice for a project
    // that has none.
    const dir = await project({ 'manage.py': '' })

    const detected = await autoDetectSource(dir)

    expect(detected?.steps.join(' ')).toContain('writes no HTML to disk')
  })

  it('leaves an ordinary project to the usual path', async () => {
    // No CMS marker: this gives up in the normal way rather than through the
    // guard, which is the difference between "nothing to audit here" and "this
    // kind of project is audited differently".
    const dir = await project({ 'package.json': JSON.stringify({ scripts: {} }) })

    expect(await autoDetectSource(dir, { noBuild: true })).toBeUndefined()
  })
})

describe('a site written by hand', () => {
  it('is audited where it stands when there is no package.json', async () => {
    // No build, no framework: the folder somebody uploads is the site.
    const dir = await project({ 'index.html': '<html></html>', 'about/index.html': '' })

    const detected = await autoDetectSource(dir)

    expect(detected?.directory).toBe(dir)
    expect(detected?.steps.join(' ')).toContain('hand-written HTML')
  })

  it('is not assumed from HTML nested somewhere below', async () => {
    const dir = await project({ 'notes/saved/page.html': '' })

    expect(await autoDetectSource(dir)).toBeUndefined()
  })

  it('is not assumed in a project with a package.json', async () => {
    // A Vite project has an index.html at its root, and it is the source the
    // build reads, not a page anybody visits.
    const dir = await project({
      'index.html': '<html></html>',
      'package.json': JSON.stringify({ scripts: {} }),
    })

    expect(await autoDetectSource(dir, { noBuild: true })).toBeUndefined()
  })
})

describe('a Next.js project that renders on a server', () => {
  // `next start` stood in for by a server that answers everything, printing its
  // address the way Next does, on the PORT it is given.
  const server = `
    import { createServer } from 'node:http'
    const port = Number(process.env.PORT)
    createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html lang="en"><title>t</title><body>' + req.url + '</body></html>')
    }).listen(port, () => console.log('   \\u001b[1m- Local:\\u001b[22m        http://localhost:' + port))
  `
  const fixture = path.join(import.meta.dirname, '../fixtures/stacks/next-server/.next')

  async function nextProject(): Promise<string> {
    const { readdir, readFile } = await import('node:fs/promises')
    const files: Record<string, string> = {
      'package.json': JSON.stringify({
        dependencies: { next: '16.0.0' },
        scripts: { start: 'node server.mjs' },
      }),
      'next.config.mjs': "export default { basePath: '/docs' }",
      'server.mjs': server,
    }
    for (const name of await readdir(fixture, { recursive: true })) {
      if (!name.endsWith('.json')) continue
      files[`.next/${name}`] = await readFile(path.join(fixture, name), 'utf8')
    }
    return project(files)
  }

  it('starts it, under its basePath, and seeds the crawl from its manifests', async () => {
    const detected = await autoDetectSource(await nextProject())
    try {
      expect(detected?.url).toMatch(/^http:\/\/localhost:\d+\/docs$/)
      const paths = (detected?.seeds ?? []).map((seed) => new URL(seed).pathname)
      expect(paths).toEqual([
        '/docs',
        '/docs/about',
        '/docs/blog/first',
        '/docs/blog/second',
        '/docs/legacy',
      ])
      expect(detected?.steps.join('\n')).toContain('5 pages from the Next.js build')
    } finally {
      await detected?.cleanup?.()
    }
  }, 60_000)

  it('names a dynamic route it has no list of pages for', async () => {
    const detected = await autoDetectSource(await nextProject())
    try {
      expect(detected?.unreachable).toEqual([
        {
          location: '/docs/user/[id]',
          reason:
            'a dynamic route rendered on request, with no list of its pages: only pages that links reached were audited',
        },
      ])
    } finally {
      await detected?.cleanup?.()
    }
  }, 60_000)
})
