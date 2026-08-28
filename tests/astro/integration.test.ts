import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { AstroIntegration } from 'astro'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import eaaKit, {
  AstroAuditError,
  type AstroIntegrationLike,
  type AstroLoggerLike,
} from '../../src/astro/index.ts'

/**
 * The structural types in src/astro are a stand-in for Astro's own, so that the
 * published .d.ts does not depend on an optional peer. This assignment is the
 * check that the stand-in still matches: if Astro renames the hook or changes
 * its options, this file stops compiling.
 */
const _shapeMatchesAstro: AstroIntegration = eaaKit() as AstroIntegration

const dirs: string[] = []
let stdout: string[]
let stderr: string[]

interface Recorded {
  logger: AstroLoggerLike
  info: string[]
  warn: string[]
  error: string[]
}

function recorder(): Recorded {
  const info: string[] = []
  const warn: string[] = []
  const error: string[] = []
  return {
    info,
    warn,
    error,
    logger: {
      info: (message) => info.push(message),
      warn: (message) => warn.push(message),
      error: (message) => error.push(message),
    },
  }
}

/** A built site on disk, as Astro would have left it. */
async function built(pages: Record<string, string>): Promise<URL> {
  const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-astro-'))
  dirs.push(dir)
  for (const [name, html] of Object.entries(pages)) {
    const target = path.join(dir, name)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, html, 'utf8')
  }
  return pathToFileURL(`${dir}/`)
}

const CLEAN = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Sauber</title></head>
<body><main><h1>Sauber</h1><p>Nichts zu melden.</p></main></body></html>`

const BROKEN = `<!doctype html><html><head><title>Kaputt</title></head>
<body><img src="/logo.svg"><a href="/x/"></a></body></html>`

/** Worst violation is serious: no lang and an empty link, but no missing alt. */
const SERIOUS_ONLY = `<!doctype html><html><head><meta charset="utf-8"><title>Mittel</title></head>
<body><main><h1>Mittel</h1><a href="/x/"></a></main></body></html>`

async function run(
  integration: AstroIntegrationLike,
  dir: URL,
  logger: AstroLoggerLike,
): Promise<void> {
  const hook = integration.hooks['astro:build:done']
  if (!hook) throw new Error('the integration registered no astro:build:done hook')
  await hook({ dir, logger })
}

beforeEach(() => {
  stdout = []
  stderr = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk))
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk))
    return true
  })
})

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('the integration object', () => {
  it('is named, so Astro can attribute its output', () => {
    expect(eaaKit().name).toBe('eaa-kit')
  })

  it('hooks the moment the build output exists', () => {
    expect(eaaKit().hooks['astro:build:done']).toBeTypeOf('function')
  })
})

describe('auditing the build', () => {
  it('passes a clean build without complaint', async () => {
    const log = recorder()

    await run(eaaKit(), await built({ 'index.html': CLEAN }), log.logger)

    expect(log.info).toContain('no violations at or above the threshold')
    expect(log.error).toEqual([])
  })

  it('fails the build when the output has violations', async () => {
    // An auditor that only ever prints is one nobody reads.
    const log = recorder()

    await expect(run(eaaKit(), await built({ 'index.html': BROKEN }), log.logger)).rejects.toThrow(
      AstroAuditError,
    )
  })

  it('prints the report, so the failure says what is wrong', async () => {
    const log = recorder()

    await run(eaaKit(), await built({ 'index.html': BROKEN }), log.logger).catch(() => undefined)

    expect(stdout.join('')).toContain('image-alt')
    expect(stdout.join('')).toContain('Images must have alternative text')
  })

  it('honours the threshold', async () => {
    // This page's worst violation is serious, so a critical threshold passes it
    // and a serious one does not. The report still lists it either way.
    const passing = recorder()
    await run(
      eaaKit({ failOn: 'critical' }),
      await built({ 'index.html': SERIOUS_ONLY }),
      passing.logger,
    )

    expect(passing.info).toContain('no violations at or above the threshold')
    expect(stdout.join('')).toContain('link-name')

    await expect(
      run(
        eaaKit({ failOn: 'serious' }),
        await built({ 'index.html': SERIOUS_ONLY }),
        recorder().logger,
      ),
    ).rejects.toThrow(AstroAuditError)
  })

  it('warns instead of failing when told to', async () => {
    const log = recorder()

    await run(eaaKit({ failBuild: false }), await built({ 'index.html': BROKEN }), log.logger)

    expect(log.warn.join('')).toContain('failBuild: false')
    expect(log.error).toEqual([])
  })

  it('does nothing at all when disabled', async () => {
    const log = recorder()

    await run(eaaKit({ enabled: false }), await built({ 'index.html': BROKEN }), log.logger)

    expect(log.info).toContain('skipped (enabled: false)')
    expect(stdout.join('')).toBe('')
  })

  it('narrows what it audits', async () => {
    const log = recorder()

    await run(
      eaaKit({ include: ['ok/**'] }),
      await built({ 'ok/index.html': CLEAN, 'bad/index.html': BROKEN }),
      log.logger,
    )

    expect(log.info).toContain('no violations at or above the threshold')
  })

  it('writes a report where it is told', async () => {
    const dir = await built({ 'index.html': BROKEN })
    const output = path.join(path.dirname(dir.pathname), 'a11y.json')

    await run(eaaKit({ format: 'json', output }), dir, recorder().logger).catch(() => undefined)

    const doc = JSON.parse(await readFile(output, 'utf8'))
    expect(doc.schemaVersion).toBe(1)
    expect(doc.summary.violations).toBeGreaterThan(0)
  })

  it('accepts the violations a baseline records', async () => {
    const dir = await built({ 'index.html': BROKEN })
    const projectDir = path.dirname(dir.pathname)
    const { runBaselineCommand } = await import('../../src/cli/baseline.ts')
    await runBaselineCommand(dir.pathname, {
      cwd: projectDir,
      output: path.join(projectDir, 'base.json'),
    })
    const log = recorder()

    await run(eaaKit({ baseline: path.join(projectDir, 'base.json') }), dir, log.logger)

    expect(log.info).toContain('no violations at or above the threshold')
  })
})

describe('a run that reached no verdict', () => {
  it('does not report it as violations found', async () => {
    // Exit 2 is not a failing audit. Calling it one sends somebody looking for
    // defects that were never measured.
    const log = recorder()
    const empty = await built({ 'notes.txt': 'no html here' })

    await expect(run(eaaKit(), empty, log.logger)).rejects.toThrow(/could not be completed/)
    expect(log.error.join('')).not.toContain('violations')
  })

  it('fails the build too, since nothing was checked', async () => {
    const empty = await built({ 'notes.txt': 'no html here' })

    await expect(run(eaaKit(), empty, recorder().logger)).rejects.toThrow(AstroAuditError)
  })

  it('still respects failBuild: false', async () => {
    const log = recorder()
    const empty = await built({ 'notes.txt': 'no html here' })

    await run(eaaKit({ failBuild: false }), empty, log.logger)

    expect(log.warn.join('')).toContain('could not be completed')
  })
})
