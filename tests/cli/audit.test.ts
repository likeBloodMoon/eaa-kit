import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IMPACT_LEVELS, type ImpactLevel } from '../../src/audit/impact.ts'
import { runAuditCommand } from '../../src/cli/audit.ts'

const SITE = fileURLToPath(new URL('../fixtures/site', import.meta.url))
const IMPACTS = fileURLToPath(new URL('../fixtures/impacts', import.meta.url))

let stdout: string[]
let stderr: string[]

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

afterEach(() => {
  vi.restoreAllMocks()
})

describe('--fail-on', () => {
  // One page per impact level, each carrying exactly one violation at that
  // level, so the threshold boundary is what decides the exit code.
  const cases: Array<{ page: string; impact: ImpactLevel; failing: ImpactLevel[] }> = [
    { page: 'minor.html', impact: 'minor', failing: ['minor'] },
    { page: 'moderate.html', impact: 'moderate', failing: ['minor', 'moderate'] },
    { page: 'serious.html', impact: 'serious', failing: ['minor', 'moderate', 'serious'] },
    {
      page: 'critical.html',
      impact: 'critical',
      failing: ['minor', 'moderate', 'serious', 'critical'],
    },
  ]

  for (const { page, impact, failing } of cases) {
    for (const failOn of IMPACT_LEVELS) {
      const want = failing.includes(failOn) ? 1 : 0
      it(`exits ${want} for a ${impact} violation with --fail-on ${failOn}`, async () => {
        const { exitCode, audits } = await runAuditCommand(IMPACTS, {
          include: [page],
          failOn,
        })

        expect(audits[0]?.violations.map((finding) => finding.impact)).toEqual([impact])
        expect(exitCode).toBe(want)
      }, 60_000)
    }
  }

  it('defaults to serious, letting a moderate violation through', async () => {
    const { exitCode } = await runAuditCommand(IMPACTS, { include: ['moderate.html'] })

    expect(exitCode).toBe(0)
  }, 60_000)

  it('defaults to serious, failing on a serious violation', async () => {
    const { exitCode } = await runAuditCommand(IMPACTS, { include: ['serious.html'] })

    expect(exitCode).toBe(1)
  }, 60_000)

  it('still reports violations below the threshold, it just does not fail', async () => {
    const { exitCode, audits } = await runAuditCommand(IMPACTS, {
      include: ['minor.html'],
      failOn: 'critical',
    })

    expect(exitCode).toBe(0)
    expect(audits[0]?.violations).toHaveLength(1)
    expect(stdout.join('')).toContain('aria-deprecated-role')
    // and says why the run passed anyway
    expect(stdout.join('')).toContain('none at or above critical')
  }, 60_000)

  it('fails at every level on the fixture site, which has critical findings', async () => {
    for (const failOn of IMPACT_LEVELS) {
      const { exitCode } = await runAuditCommand(SITE, { failOn })

      expect(exitCode).toBe(1)
    }
  }, 120_000)
})

describe('--format and --output', () => {
  it('writes a JSON document to stdout with --format json', async () => {
    await runAuditCommand(IMPACTS, { include: ['critical.html'], format: 'json' })

    const document = JSON.parse(stdout.join(''))
    expect(document.schemaVersion).toBe(1)
    expect(document.pages[0].path).toBe('critical.html')
    expect(stdout.join('')).not.toContain('eaa-kit audit')
  }, 60_000)

  it('writes the report to a file with --output, leaving stdout empty', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-out-'))
    const target = path.join(dir, 'nested', 'report.json')
    try {
      const { exitCode } = await runAuditCommand(IMPACTS, {
        include: ['critical.html'],
        format: 'json',
        output: target,
      })

      const written = JSON.parse(await readFile(target, 'utf8'))
      expect(written.schemaVersion).toBe(1)
      expect(written.summary.violations).toBe(1)
      expect(stdout.join('')).toBe('')
      expect(stderr.join('')).toContain('Report written to')
      // The threshold still decides the exit code, whatever the format.
      expect(exitCode).toBe(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it('creates missing parent directories for --output', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-out-'))
    const target = path.join(dir, 'a', 'b', 'c', 'report.json')
    try {
      await runAuditCommand(IMPACTS, { include: ['minor.html'], format: 'json', output: target })

      await expect(readFile(target, 'utf8')).resolves.toContain('"schemaVersion"')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it('writes the console report to a file without colour codes', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-out-'))
    const target = path.join(dir, 'report.txt')
    try {
      await runAuditCommand(IMPACTS, { include: ['critical.html'], output: target })

      const written = await readFile(target, 'utf8')
      expect(written).toContain('image-alt')
      // biome-ignore lint/suspicious/noControlCharactersInRegex: checking for ANSI
      expect(written).not.toMatch(/\u001b\[/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it('writes a SARIF log with --format sarif', async () => {
    await runAuditCommand(IMPACTS, { include: ['critical.html'], format: 'sarif' })

    const log = JSON.parse(stdout.join(''))
    expect(log.version).toBe('2.1.0')
    expect(log.runs[0].tool.driver.name).toBe('eaa-kit')
    expect(log.runs[0].results[0].ruleId).toBe('image-alt')
    expect(log.runs[0].results[0].level).toBe('error')
  }, 60_000)

  it('defaults to the console report', async () => {
    await runAuditCommand(IMPACTS, { include: ['critical.html'] })

    expect(stdout.join('')).toContain('eaa-kit audit')
    expect(() => JSON.parse(stdout.join(''))).toThrow()
  }, 60_000)
})

describe('runAuditCommand', () => {
  it('exits 1 when a page has violations', async () => {
    const { exitCode, audits } = await runAuditCommand(SITE)

    expect(exitCode).toBe(1)
    expect(audits).toHaveLength(5)
    expect(stdout.join('')).toContain('image-alt')
  }, 60_000)

  it('exits 0 when every page is clean', async () => {
    const { exitCode } = await runAuditCommand(SITE, { include: ['about/**'] })

    expect(exitCode).toBe(0)
    expect(stdout.join('')).toContain('No violations across 1 page')
  }, 60_000)

  it('writes the report to stdout and progress to stderr', async () => {
    await runAuditCommand(SITE, { include: ['about/**'] })

    expect(stderr.join('')).toContain('Auditing 1 page')
    expect(stdout.join('')).toContain('Summary')
    expect(stderr.join('')).not.toContain('Summary')
  }, 60_000)

  it('honours exclude patterns', async () => {
    const { audits } = await runAuditCommand(SITE, { exclude: ['drafts/**', 'blog/**'] })

    expect(audits.map((audit) => audit.relativePath)).not.toContain('drafts/draft.html')
  }, 60_000)

  it('exits 2 with guidance when the directory does not exist', async () => {
    const { exitCode } = await runAuditCommand(path.join(SITE, 'nope'))

    expect(exitCode).toBe(2)
    expect(stderr.join('')).toContain('Build directory not found')
    // A directory that is not there and one holding no HTML are the same
    // mistake to whoever typed it, so both now get the same specific advice
    // instead of a generic pointer at ./dist.
    expect(stderr.join('')).toContain('does not exist')
    // Which branch fires depends on what the project around it has; all of
    // them name a directory or a command rather than shrugging.
    expect(stderr.join('')).toMatch(/try one of those|eaa-kit audit|--url/)
  })

  it('exits 2, not 0, when a page could not be audited', async () => {
    // An unauditable page is not a clean page. Exiting 0 because it happened to
    // produce no violations would hand back a pass for markup nothing read.
    const { exitCode, audits } = await runAuditCommand(SITE, {
      include: ['about/**'],
      timeoutMs: 1,
    })

    expect(audits.every((audit) => audit.error)).toBe(true)
    expect(audits.every((audit) => audit.violations.length === 0)).toBe(true)
    expect(exitCode).toBe(2)
    expect(stderr.join('')).toContain('could not be audited')
  }, 60_000)

  it('exits 2 when the directory holds no HTML', async () => {
    const empty = await mkdtemp(path.join(tmpdir(), 'eaa-kit-cli-'))
    await writeFile(path.join(empty, 'app.js'), 'export {}', 'utf8')
    try {
      const { exitCode } = await runAuditCommand(empty)

      expect(exitCode).toBe(2)
      expect(stderr.join('')).toContain('holds no HTML')
    } finally {
      await rm(empty, { recursive: true, force: true })
    }
  })
})

/** See the note in tests/audit/runners/pool.ts: threads need a longer ceiling. */
const THREAD_TIMEOUT_MS = 30_000

describe('--concurrency', { timeout: THREAD_TIMEOUT_MS }, () => {
  it('audits across threads and reports the same findings as one thread', async () => {
    const [threaded, single] = await Promise.all([
      runAuditCommand(SITE, { concurrency: 2 }),
      runAuditCommand(SITE, { concurrency: 1 }),
    ])

    expect(threaded.exitCode).toBe(single.exitCode)
    expect(threaded.audits.map((audit) => audit.relativePath)).toEqual(
      single.audits.map((audit) => audit.relativePath),
    )
    expect(threaded.audits.map((audit) => audit.violations.length)).toEqual(
      single.audits.map((audit) => audit.violations.length),
    )
  })

  it('says on stderr how many threads it is using', async () => {
    await runAuditCommand(SITE, { concurrency: 3 })

    expect(stderr.join('')).toContain('across 3 threads')
  })

  it('says nothing about threads when it is not using any', async () => {
    await runAuditCommand(SITE, { concurrency: 1 })

    expect(stderr.join('')).not.toContain('threads')
  })
})

describe('the completeness block', () => {
  it('reports a directory run as complete, and says how the pages were found', async () => {
    await runAuditCommand(SITE, { include: ['about/**'], format: 'json' })

    const document = JSON.parse(stdout.join(''))
    expect(document.completeness).toMatchObject({
      discovery: 'directory',
      complete: true,
      errored: 0,
      truncated: false,
    })
    expect(document.completeness.unreachable).toEqual([])
    expect(document.completeness.audited).toBe(document.summary.pages)
  }, 60_000)

  describe('over a crawl', () => {
    /** A tiny site on loopback: two real pages and one link that 404s. */
    function serve(pages: Record<string, string>): Promise<{ origin: string; close: () => void }> {
      const server: Server = createServer((request, response) => {
        const body = pages[(request.url ?? '/').split('?')[0] as string]
        if (body === undefined) {
          response.writeHead(404, { 'content-type': 'text/html' })
          response.end('gone')
          return
        }
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        response.end(body)
      })
      return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const { port } = server.address() as AddressInfo
          resolve({
            origin: `http://127.0.0.1:${port}`,
            close: () => server.close(),
          })
        })
      })
    }

    const html = (body: string): string =>
      `<!doctype html><html lang="en"><head><title>t</title></head><body>${body}</body></html>`

    it('names the pages a crawl could not fetch', async () => {
      const site = await serve({
        '/': html('<a href="/a">a</a><a href="/missing">missing</a>'),
        '/a': html('<p>a</p>'),
      })
      try {
        await runAuditCommand(undefined, { url: site.origin, format: 'json' })

        const document = JSON.parse(stdout.join(''))
        expect(document.completeness.complete).toBe(false)
        expect(document.completeness.discovery).toBe('links')
        expect(document.completeness.unreachable).toHaveLength(1)
        expect(document.completeness.unreachable[0].location).toContain('/missing')
      } finally {
        site.close()
      }
    }, 60_000)

    it('says the run was truncated when it stopped at --max-pages', async () => {
      // The case that used to be indistinguishable from a complete clean run:
      // three pages exist, one was audited, and the report said nothing.
      const site = await serve({
        '/': html('<a href="/a">a</a><a href="/b">b</a>'),
        '/a': html('<p>a</p>'),
        '/b': html('<p>b</p>'),
      })
      try {
        await runAuditCommand(undefined, { url: site.origin, maxPages: 1, format: 'json' })

        const document = JSON.parse(stdout.join(''))
        expect(document.completeness.truncated).toBe(true)
        expect(document.completeness.complete).toBe(false)
        expect(document.summary.pages).toBe(1)
      } finally {
        site.close()
      }
    }, 60_000)
  })
})
