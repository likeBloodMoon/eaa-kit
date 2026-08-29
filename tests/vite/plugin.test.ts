import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import eaaKit, { BuildAuditError, type ResolvedConfigLike } from '../../src/vite/index.ts'

/**
 * The plugin driven the way Vite drives it: configResolved, then closeBundle.
 *
 * One plugin covers Vite, SvelteKit, Nuxt, Remix and Astro, since they all
 * build on Vite — so what it does with the resolved config is worth holding to
 * more than one example.
 */

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const CLEAN = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Clean</title></head>
<body><main><h1>Clean</h1><p>Nothing to report.</p></main></body></html>`

const BROKEN = `<!doctype html><html><head><title>Broken</title></head>
<body><img src="/logo.png"><a href="/x"></a></body></html>`

/** A finished build: a root, an outDir under it, and a page in it. */
async function build(page: string, outDir = 'dist'): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'eaa-kit-vite-'))
  dirs.push(root)
  await mkdir(path.join(root, outDir), { recursive: true })
  await writeFile(path.join(root, outDir, 'index.html'), page)
  return root
}

function recorder(): { logger: NonNullable<ResolvedConfigLike['logger']>; lines: string[] } {
  const lines: string[] = []
  return {
    lines,
    logger: {
      info: (message) => lines.push(`info: ${message}`),
      warn: (message) => lines.push(`warn: ${message}`),
      error: (message) => lines.push(`error: ${message}`),
    },
  }
}

async function run(
  plugin: ReturnType<typeof eaaKit>,
  root: string,
  outDir = 'dist',
  logger?: ResolvedConfigLike['logger'],
): Promise<void> {
  plugin.configResolved({ root, build: { outDir }, ...(logger ? { logger } : {}) })
  await plugin.closeBundle()
}

describe('the plugin shape Vite expects', () => {
  it('is named, build-only and enforced late', () => {
    const plugin = eaaKit()

    expect(plugin.name).toBe('eaa-kit')
    // A dev server writes nothing to audit, and a plugin emitting pages after
    // this one would otherwise be audited by its absence.
    expect(plugin.apply).toBe('build')
    expect(plugin.enforce).toBe('post')
  })
})

describe('auditing the build', () => {
  it('fails the build on violations at or above the threshold', async () => {
    const log = recorder()

    await expect(run(eaaKit(), await build(BROKEN), 'dist', log.logger)).rejects.toThrow(
      BuildAuditError,
    )
    expect(log.lines.join('\n')).toContain('error: eaa-kit: accessibility violations')
  })

  it('lets a clean build through', async () => {
    const log = recorder()

    await run(eaaKit(), await build(CLEAN), 'dist', log.logger)

    expect(log.lines.join('\n')).toContain('no violations at or above the threshold')
  })

  it('warns instead of failing when told only to warn', async () => {
    // For the week it takes to adopt this on a site that already exists.
    const log = recorder()

    await run(eaaKit({ failBuild: false }), await build(BROKEN), 'dist', log.logger)

    expect(log.lines.join('\n')).toMatch(/warn: .*failBuild: false/)
  })

  it('does nothing at all when disabled', async () => {
    const log = recorder()

    await run(eaaKit({ enabled: false }), await build(BROKEN), 'dist', log.logger)

    expect(log.lines.join('\n')).toContain('skipped (enabled: false)')
  })

  it('respects a raised threshold', async () => {
    // The broken page's worst violation is critical; nothing is above it.
    await run(eaaKit({ failOn: 'critical' }), await build(CLEAN))
  })
})

describe('finding the build output', () => {
  it("audits the build's own outDir", async () => {
    const log = recorder()
    const root = await build(BROKEN, 'www')

    await expect(run(eaaKit(), root, 'www', log.logger)).rejects.toThrow(BuildAuditError)
  })

  it('resolves outDir against the Vite root, as Vite does', async () => {
    const log = recorder()
    const root = await build(CLEAN, 'build/client')

    await run(eaaKit(), root, 'build/client', log.logger)

    expect(log.lines.join('\n')).toContain('no violations')
  })

  it('takes an explicit directory over the build one', async () => {
    const root = await build(BROKEN, 'elsewhere')

    await expect(run(eaaKit({ directory: 'elsewhere' }), root, 'dist')).rejects.toThrow(
      BuildAuditError,
    )
  })

  it('refuses to guess when it never saw a config', async () => {
    // configResolved always runs first in a real build. Reaching closeBundle
    // without it means the plugin was called directly, and guessing would audit
    // whatever happened to be in the working directory.
    await expect(eaaKit().closeBundle()).rejects.toThrow(/not given a resolved Vite config/)
  })
})

describe('logging', () => {
  it("uses Vite's logger when there is one", async () => {
    const log = recorder()

    await run(eaaKit(), await build(CLEAN), 'dist', log.logger)

    expect(log.lines).not.toHaveLength(0)
  })

  it('prefixes every line, since a build log has many authors', async () => {
    const log = recorder()

    await run(eaaKit(), await build(CLEAN), 'dist', log.logger)

    for (const line of log.lines) expect(line).toMatch(/^(info|warn|error): eaa-kit: /)
  })
})
