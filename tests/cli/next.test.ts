import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runAuditCommand } from '../../src/cli/audit.ts'
import { runDiffCommand } from '../../src/cli/diff.ts'
import { runInitCommand } from '../../src/cli/init.ts'
import { runStatementCommand } from '../../src/cli/statement.ts'
import { nextStepOf } from '../../src/next.ts'

/**
 * Every exit-2 path a new user is likely to meet ends with the command that
 * fixes it. These run each one and read the line under the error, with the
 * colour codes taken out so the assertion holds on a terminal that has them.
 */

const dirs: string[] = []
let stderr: string[] = []

beforeEach(() => {
  stderr = []
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk))
    return true
  })
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
})

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function folder(files: Record<string, string> = {}): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-next-'))
  dirs.push(dir)
  for (const [name, body] of Object.entries(files)) await writeFile(path.join(dir, name), body)
  return dir
}

const said = (): string => stripVTControlCharacters(stderr.join(''))

const CONFIG = JSON.stringify({
  site: { name: 'S', url: 'https://s.example', locale: 'de-AT' },
  provider: { legalName: 'S GmbH', email: 'a@s.example' },
  compliance: { status: 'partially-compliant', assessedOn: '2026-09-01' },
  enforcement: { country: 'FR' },
})

describe('what to type next', () => {
  it('points a statement with no config at init', async () => {
    const cwd = await folder()

    expect((await runStatementCommand({ cwd })).exitCode).toBe(2)
    expect(said()).toContain('→ eaa-kit init')
  })

  it('points a missing language at one the country has', async () => {
    const cwd = await folder({ 'eaa.config.json': CONFIG })

    expect((await runStatementCommand({ cwd, locale: 'de' })).exitCode).toBe(2)
    expect(said()).toContain('→ eaa-kit statement --lang en')
  })

  it('points a missing audit report at the command that writes one', async () => {
    const cwd = await folder({ 'eaa.config.json': CONFIG })

    await runStatementCommand({ cwd, audit: 'a11y.json' })

    expect(said()).toContain('→ eaa-kit audit --format json --output a11y.json')
  })

  it('points a missing baseline at the command that records one', async () => {
    const cwd = await folder({ 'index.html': '<html lang="en"><title>x</title></html>' })

    const { exitCode } = await runAuditCommand(cwd, { cwd, baseline: 'base.json' })

    expect(exitCode).toBe(2)
    expect(said()).toContain('→ eaa-kit baseline --output base.json')
  })

  it('points a missing review record at checklist', async () => {
    const cwd = await folder({ 'index.html': '<html lang="en"><title>x</title></html>' })

    const { exitCode } = await runAuditCommand(cwd, { cwd, review: 'review.json' })

    expect(exitCode).toBe(2)
    expect(said()).toContain('→ eaa-kit checklist --record review.json')
  })

  it('points a missing report in a diff at the audit that writes it', async () => {
    const cwd = await folder()

    const { exitCode } = await runDiffCommand('before.json', 'after.json', { cwd })

    expect(exitCode).toBe(2)
    expect(said()).toContain('→ eaa-kit audit --format json --output before.json')
  })

  it('points a config that is already there at --force', async () => {
    const cwd = await folder({ 'eaa.config.json': CONFIG })

    await runInitCommand({ cwd, yes: true })

    expect(said()).toContain('→ eaa-kit init --force')
  })
})

describe('nextStepOf', () => {
  it('reads a next step off anything that carries one, and nothing else', () => {
    expect(nextStepOf({ next: { command: 'eaa-kit init', why: 'w' } })).toEqual({
      command: 'eaa-kit init',
      why: 'w',
    })
    expect(nextStepOf(new Error('plain'))).toBeUndefined()
    expect(nextStepOf({ next: { command: 3 } })).toBeUndefined()
    expect(nextStepOf(undefined)).toBeUndefined()
  })
})
