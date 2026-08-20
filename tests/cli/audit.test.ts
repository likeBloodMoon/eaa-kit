import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runAuditCommand } from '../../src/cli/audit.ts'

const SITE = fileURLToPath(new URL('../fixtures/site', import.meta.url))

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
    expect(stderr.join('')).toContain('eaa-kit audit ./dist')
  })

  it('exits 2 when the directory holds no HTML', async () => {
    const empty = await mkdtemp(path.join(tmpdir(), 'eaa-kit-cli-'))
    await writeFile(path.join(empty, 'app.js'), 'export {}', 'utf8')
    try {
      const { exitCode } = await runAuditCommand(empty)

      expect(exitCode).toBe(2)
      expect(stderr.join('')).toContain('No HTML files found')
    } finally {
      await rm(empty, { recursive: true, force: true })
    }
  })
})
