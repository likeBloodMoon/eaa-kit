import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { detectDefaults, existingConfig, runInitCommand } from '../../src/cli/init.ts'
import { parseConfig } from '../../src/config/define.ts'

const dirs: string[] = []
let stderr: string[] = []

beforeEach(() => {
  stderr = []
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk))
    return true
  })
})

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function project(files: Record<string, string> = {}): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-init-'))
  dirs.push(dir)
  for (const [name, body] of Object.entries(files)) await writeFile(path.join(dir, name), body)
  return dir
}

/** Answers in the order the command asks for them. */
function answers(...given: string[]): (question: string, fallback: string) => Promise<string> {
  let next = 0
  return async (_question, fallback) => {
    const answer = given[next++]
    return answer === undefined || answer === '' ? fallback : answer
  }
}

async function written(dir: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(dir, 'eaa.config.json'), 'utf8'))
}

describe('detectDefaults', () => {
  it('takes the name and homepage a project states outright', async () => {
    const cwd = await project({
      'package.json': JSON.stringify({ name: 'gradska-web', homepage: 'https://gradska.at' }),
    })

    expect(await detectDefaults(cwd)).toEqual({ name: 'gradska-web', url: 'https://gradska.at' })
  })

  it('strips the npm scope, which is not part of anybody name', async () => {
    const cwd = await project({ 'package.json': JSON.stringify({ name: '@acme/site' }) })

    expect((await detectDefaults(cwd)).name).toBe('site')
  })

  it.each([
    ['a homepage that is not a URL', { name: 'x', homepage: 'see our site' }],
    ['no homepage', { name: 'x' }],
  ])('offers no URL for %s', async (_name, pkg) => {
    // A guess that is wrong is worse than a field somebody has to fill.
    const cwd = await project({ 'package.json': JSON.stringify(pkg) })

    expect((await detectDefaults(cwd)).url).toBeUndefined()
  })

  it.each([
    ['no package.json', {}],
    ['a package.json that is not JSON', { 'package.json': 'nope' }],
  ])('detects nothing from %s', async (_name, files) => {
    expect(await detectDefaults(await project(files))).toEqual({})
  })
})

describe('runInitCommand', () => {
  it('writes a config the loader accepts', async () => {
    const cwd = await project()

    const result = await runInitCommand({
      cwd,
      ask: answers(
        'Gradska GmbH',
        'https://gradska.at',
        'DE',
        'de-DE',
        'Gradska Betriebs GmbH',
        'office@gradska.at',
        'https://gradska.at/kontakt',
      ),
    })

    expect(result.exitCode).toBe(0)
    // The point of the command: what it writes has to be valid, or it has
    // replaced reading the docs with debugging a generated file.
    const config = parseConfig(await written(cwd), 'eaa.config.json')
    expect(config.site.name).toBe('Gradska GmbH')
    expect(config.provider.email).toBe('office@gradska.at')
    expect(config.provider.feedbackUrl).toBe('https://gradska.at/kontakt')
    expect(config.enforcement.country).toBe('DE')
  })

  it('never claims compliance it has no basis for', async () => {
    // Written before any audit has run. A statement claiming full conformance
    // for a site nobody assessed is worse than no statement at all.
    const cwd = await project()
    await runInitCommand({ cwd, ask: answers('S', 'https://s.at', 'AT', 'de-AT', 'S', 'a@s.at') })

    expect((await written(cwd)).compliance).toMatchObject({ status: 'partially-compliant' })
  })

  it('defaults the locale from the country', async () => {
    const cwd = await project()
    await runInitCommand({ cwd, ask: answers('S', 'https://s.ch', 'CH', '', 'S', 'a@s.ch') })

    expect((await written(cwd)).site).toMatchObject({ locale: 'de-CH' })
  })

  it('falls back rather than throwing away the answers on a bad country', async () => {
    const cwd = await project()
    await runInitCommand({ cwd, ask: answers('S', 'https://s.at', 'Austria', '', 'S', 'a@s.at') })

    expect((await written(cwd)).enforcement).toMatchObject({ country: 'AT' })
  })

  it('leaves the optional feedback URL out rather than writing an empty one', async () => {
    const cwd = await project()
    await runInitCommand({ cwd, ask: answers('S', 'https://s.at', 'AT', '', 'S', 'a@s.at', '') })

    expect((await written(cwd)).provider).not.toHaveProperty('feedbackUrl')
  })

  it('refuses to overwrite a config that is already there', async () => {
    const cwd = await project({ 'eaa.config.json': '{"keep":"me"}' })

    const result = await runInitCommand({ cwd, yes: true })

    expect(result.exitCode).toBe(1)
    expect(await readFile(path.join(cwd, 'eaa.config.json'), 'utf8')).toBe('{"keep":"me"}')
    expect(stderr.join('')).toContain('--force')
  })

  it('overwrites when told to', async () => {
    const cwd = await project({ 'eaa.config.json': '{"keep":"me"}' })

    const result = await runInitCommand({ cwd, force: true, yes: true })

    expect(result.exitCode).toBe(0)
    expect(await written(cwd)).toHaveProperty('site')
  })

  it('names the required fields it could not fill', async () => {
    const cwd = await project()

    await runInitCommand({ cwd, yes: true })

    expect(stderr.join('')).toMatch(/provider\.email .* required/)
  })

  it('uses the site name as the legal entity unless told otherwise', async () => {
    const cwd = await project()
    await runInitCommand({ cwd, ask: answers('Gradska', 'https://g.at', 'AT', '', '', 'a@g.at') })

    expect((await written(cwd)).provider).toMatchObject({ legalName: 'Gradska' })
  })
})

describe('existingConfig', () => {
  it.each(['eaa.config.json', 'eaa.config.ts', 'eaa.config.mjs'])('finds %s', async (name) => {
    expect(await existingConfig(await project({ [name]: '' }))).toBe(name)
  })

  it('finds none in an empty project', async () => {
    expect(await existingConfig(await project())).toBeUndefined()
  })
})
