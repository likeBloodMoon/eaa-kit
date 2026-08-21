import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runStatementCommand } from '../../src/cli/statement.ts'

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
