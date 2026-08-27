import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runStatementCommand } from '../../src/cli/statement.ts'

const AUDIT_FIXTURE = path.join(import.meta.dirname, '../fixtures/statement/audit.json')

const CONFIG = {
  site: { name: 'Musterbetrieb', url: 'https://example.at', locale: 'de-AT' },
  provider: { legalName: 'Musterbetrieb GmbH', email: 'office@example.at' },
  compliance: { status: 'partially-compliant', assessedOn: '2026-08-21' },
  enforcement: { country: 'AT' },
}

const dirs: string[] = []
let stdout: string[]
let stderr: string[]

async function project(config: unknown = CONFIG, name = 'eaa.config.json'): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-statement-'))
  dirs.push(dir)
  await writeFile(path.join(dir, name), JSON.stringify(config), 'utf8')
  return dir
}

/** A project with a report from `eaa-kit audit --format json` next to it. */
async function projectWithAudit(name = 'a11y.json'): Promise<string> {
  const dir = await project()
  await copyFile(AUDIT_FIXTURE, path.join(dir, name))
  return dir
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

describe('runStatementCommand', () => {
  it('writes the statement to stdout and the chatter to stderr', async () => {
    const dir = await project()

    const { exitCode } = await runStatementCommand({ cwd: dir })

    expect(exitCode).toBe(0)
    expect(stdout.join('')).toContain('# Erklärung zur Barrierefreiheit')
    expect(stderr.join('')).toContain('eaa.config.json')
    expect(stderr.join('')).not.toContain('Erklärung zur Barrierefreiheit')
  })

  it('warns on stderr that the result is a draft', async () => {
    await runStatementCommand({ cwd: await project() })

    expect(stderr.join('')).toContain('not legal advice')
  })

  it('renders the language asked for', async () => {
    const dir = await project()

    await runStatementCommand({ cwd: dir, locale: 'en' })

    expect(stdout.join('')).toContain('# Accessibility Statement')
  })

  it('renders the country asked for', async () => {
    const dir = await project()

    await runStatementCommand({ cwd: dir, country: 'DE' })

    expect(stdout.join('')).toContain('Barrierefreiheitsstärkungsgesetz')
  })

  it('writes to a file when asked, leaving stdout empty', async () => {
    const dir = await project()

    const { exitCode } = await runStatementCommand({
      cwd: dir,
      output: 'src/content/barrierefreiheit.md',
    })

    const written = await readFile(path.join(dir, 'src/content/barrierefreiheit.md'), 'utf8')
    expect(exitCode).toBe(0)
    expect(written).toContain('# Erklärung zur Barrierefreiheit')
    expect(stdout.join('')).toBe('')
    expect(stderr.join('')).toContain('Written to')
  })

  it('accepts an explicit config path', async () => {
    const dir = await project(CONFIG, 'custom.json')

    const { exitCode } = await runStatementCommand({ cwd: dir, config: 'custom.json' })

    expect(exitCode).toBe(0)
  })

  it('exits 2 and lists what is wrong when the config is invalid', async () => {
    const dir = await project({ ...CONFIG, provider: { legalName: 'X' } })

    const { exitCode } = await runStatementCommand({ cwd: dir })

    expect(exitCode).toBe(2)
    expect(stderr.join('')).toContain('is not valid')
    expect(stderr.join('')).toContain('provider.email')
    expect(stdout.join('')).toBe('')
  })

  it('exits 2 when there is no config at all', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-statement-'))
    dirs.push(dir)

    const { exitCode } = await runStatementCommand({ cwd: dir })

    expect(exitCode).toBe(2)
    expect(stderr.join('')).toContain('No config file found')
  })

  it('exits 2 rather than emitting a placeholder for a country without a template', async () => {
    const dir = await project({ ...CONFIG, enforcement: { country: 'CH' } })

    const { exitCode } = await runStatementCommand({ cwd: dir })

    expect(exitCode).toBe(2)
    expect(stderr.join('')).toContain('No statement template for ch.de')
    expect(stdout.join('')).toBe('')
  })
})

describe('runStatementCommand --audit', () => {
  it('lists the barriers the audit found', async () => {
    const dir = await projectWithAudit()

    const { exitCode } = await runStatementCommand({ cwd: dir, audit: 'a11y.json' })

    expect(exitCode).toBe(0)
    expect(stdout.join('')).toContain('Images must have alternative text')
    expect(stdout.join('')).toContain('Automatisiert erkannt (axe-core, Regel image-alt)')
  })

  it('says on stderr how many it took, and whose words they are', async () => {
    const dir = await projectWithAudit()

    await runStatementCommand({ cwd: dir, audit: 'a11y.json' })

    expect(stderr.join('')).toContain('4 barriers taken from a11y.json')
    expect(stderr.join('')).toContain('Rewrite those descriptions in your own words')
  })

  it('does not ask for a rewrite when the run was clean', async () => {
    const dir = await projectWithAudit()
    await writeFile(
      path.join(dir, 'clean.json'),
      JSON.stringify({
        schemaVersion: 1,
        generatedAt: '2026-08-21T09:30:00.000Z',
        summary: { pages: 1, needsReview: 0, notEvaluated: 0 },
        rules: {},
        pages: [{ path: 'index.html', violations: [] }],
      }),
      'utf8',
    )

    await runStatementCommand({ cwd: dir, audit: 'clean.json' })

    expect(stderr.join('')).toContain('0 barriers taken from clean.json')
    expect(stderr.join('')).not.toContain('Rewrite those')
  })

  it('leaves the barrier list to the config when no report is given', async () => {
    const dir = await projectWithAudit()

    await runStatementCommand({ cwd: dir })

    expect(stdout.join('')).not.toContain('Images must have alternative text')
  })

  it('exits 2 when the report is not there', async () => {
    const dir = await project()

    const { exitCode } = await runStatementCommand({ cwd: dir, audit: 'missing.json' })

    expect(exitCode).toBe(2)
    expect(stderr.join('')).toContain('Could not read the audit report at missing.json')
    expect(stdout.join('')).toBe('')
  })

  it('exits 2 when the report is not one of ours', async () => {
    const dir = await project()
    await writeFile(path.join(dir, 'other.json'), JSON.stringify({ results: [] }), 'utf8')

    const { exitCode } = await runStatementCommand({ cwd: dir, audit: 'other.json' })

    expect(exitCode).toBe(2)
    expect(stderr.join('')).toContain('is not an eaa-kit JSON report')
  })
})

describe('runStatementCommand --format', () => {
  it('writes markdown by default', async () => {
    const { document, format } = await runStatementCommand({ cwd: await project() })

    expect(format).toBe('markdown')
    expect(document.startsWith('# Erklärung zur Barrierefreiheit')).toBe(true)
  })

  it('writes a standalone HTML page when asked for one', async () => {
    const { document, format } = await runStatementCommand({
      cwd: await project(),
      format: 'html',
    })

    expect(format).toBe('html')
    expect(document.startsWith('<!doctype html>')).toBe(true)
    expect(stdout.join('')).toContain('<h1>Erklärung zur Barrierefreiheit</h1>')
  })

  it('takes the format from the output extension', async () => {
    const dir = await project()

    const { format } = await runStatementCommand({ cwd: dir, output: 'public/a11y.html' })

    const written = await readFile(path.join(dir, 'public/a11y.html'), 'utf8')
    expect(format).toBe('html')
    expect(written.startsWith('<!doctype html>')).toBe(true)
  })

  it('accepts .htm as well', async () => {
    const dir = await project()

    const { format } = await runStatementCommand({ cwd: dir, output: 'a11y.HTM' })

    expect(format).toBe('html')
  })

  it('stays with markdown for any other extension', async () => {
    const dir = await project()

    const { format } = await runStatementCommand({ cwd: dir, output: 'content/a11y.md' })

    expect(format).toBe('markdown')
  })

  it('lets an explicit format override the extension', async () => {
    const dir = await project()

    const { format } = await runStatementCommand({
      cwd: dir,
      format: 'markdown',
      output: 'a11y.html',
    })

    const written = await readFile(path.join(dir, 'a11y.html'), 'utf8')
    expect(format).toBe('markdown')
    expect(written.startsWith('# Erklärung')).toBe(true)
  })

  it('names the format in the line it writes to stderr', async () => {
    await runStatementCommand({ cwd: await project(), format: 'html' })

    expect(stderr.join('')).toContain('(at.de, html)')
  })

  it('reports the format even when it could not produce anything', async () => {
    const dir = await project({ ...CONFIG, enforcement: { country: 'CH' } })

    const result = await runStatementCommand({ cwd: dir, format: 'html' })

    expect(result).toMatchObject({ document: '', format: 'html', exitCode: 2 })
  })
})
