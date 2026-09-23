import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FIRST_RUN_REPORT, runFirstRun } from '../../src/cli/start.ts'

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

async function folder(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-start-'))
  dirs.push(dir)
  for (const [name, body] of Object.entries(files)) await writeFile(path.join(dir, name), body)
  return dir
}

const PAGE =
  '<!doctype html><html lang="pl-PL"><head><title>Sklep</title></head>' +
  '<body><main><h1>Sklep</h1><img src="logo.png"></main></body></html>'

describe('eaa-kit with no command', () => {
  it('finds the site, audits it and leaves an HTML report, with nothing set up', async () => {
    const cwd = await folder({ 'index.html': PAGE })

    const { exitCode } = await runFirstRun({ cwd })

    // The image has no alt text, which is critical: the first run keeps the
    // audit's exit codes rather than softening them.
    expect(exitCode).toBe(1)
    const report = await readFile(path.join(cwd, FIRST_RUN_REPORT), 'utf8')
    expect(report).toContain('<!doctype html>')
    expect(report).toContain('image-alt')
  })

  it('says what it detected, and which command comes next', async () => {
    const cwd = await folder({ 'index.html': PAGE })

    await runFirstRun({ cwd })
    const said = stderr.join('')

    expect(said).toContain('this folder, 1 page')
    expect(said).toContain("pl-PL → a statement under Poland's law")
    expect(said).toContain('eaa-kit init')
    expect(said).toContain('with Poland filled in')
    expect(said).toContain('eaa-kit baseline')
  })

  it('points at the statement once a config exists', async () => {
    const cwd = await folder({ 'index.html': PAGE, 'eaa.config.json': '{}' })

    await runFirstRun({ cwd })

    expect(stderr.join('')).toContain('eaa-kit statement')
    expect(stderr.join('')).not.toContain('eaa-kit init')
  })

  it('keeps what it writes out of version control', async () => {
    const cwd = await folder({ 'index.html': PAGE })

    await runFirstRun({ cwd })

    expect(await readFile(path.join(cwd, '.eaa-kit', '.gitignore'), 'utf8')).toMatch(/^\*$/m)
  })

  it('exits 2 and writes no report when there is no site to find', async () => {
    const cwd = await folder({})

    const { exitCode } = await runFirstRun({ cwd })

    expect(exitCode).toBe(2)
    expect(stderr.join('')).toContain('No site found to audit')
    // Left exactly as it was found: not even the tool's own directory.
    await expect(readFile(path.join(cwd, FIRST_RUN_REPORT), 'utf8')).rejects.toThrow()
    await expect(readFile(path.join(cwd, '.eaa-kit', '.gitignore'), 'utf8')).rejects.toThrow()
  })
})
