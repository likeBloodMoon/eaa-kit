import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ConfigError, defineConfig, parseConfig } from '../../src/config/define.ts'
import { findConfigFile, loadConfig } from '../../src/config/load.ts'

const VALID = {
  site: { name: 'Musterbetrieb', url: 'https://example.at', locale: 'de-AT' },
  provider: { legalName: 'Musterbetrieb GmbH', email: 'office@example.at' },
  compliance: { status: 'partially-compliant', assessedOn: '2026-08-20' },
  enforcement: { country: 'AT' },
}

const dirs: string[] = []

async function project(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-config-'))
  dirs.push(dir)
  for (const [name, contents] of Object.entries(files)) {
    const target = path.join(dir, name)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, contents, 'utf8')
  }
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('parseConfig', () => {
  it('accepts a minimal config and fills the defaults', () => {
    const config = parseConfig(VALID)

    expect(config.compliance.standard).toBe('EN 301 549 V3.2.1 (WCAG 2.2 AA)')
    expect(config.compliance.assessmentMethod).toBe('self-assessment')
    expect(config.compliance.knownIssues).toEqual([])
    // A barrier an automated run just found is one somebody means to fix; the
    // other two reasons are claims only a human can make.
    expect(config.compliance.auditReason).toBe('fix-planned')
  })

  it('accepts a feedback form alongside the address', () => {
    const config = parseConfig({
      ...VALID,
      provider: { ...VALID.provider, feedbackUrl: 'https://example.at/kontakt' },
    })

    expect(config.provider.feedbackUrl).toBe('https://example.at/kontakt')
  })

  it('takes the reason to give barriers found by an audit', () => {
    const config = parseConfig({
      ...VALID,
      compliance: { ...VALID.compliance, auditReason: 'disproportionate-burden' },
    })

    expect(config.compliance.auditReason).toBe('disproportionate-burden')
  })

  it('accepts a plain string as shorthand for a known issue', () => {
    const config = parseConfig({
      ...VALID,
      compliance: { ...VALID.compliance, knownIssues: ['Der Lichtkasten ist nicht bedienbar.'] },
    })

    expect(config.compliance.knownIssues[0]).toEqual({
      description: 'Der Lichtkasten ist nicht bedienbar.',
      successCriteria: [],
      en301549: [],
    })
  })

  it('keeps the detail on a fully described known issue', () => {
    const config = parseConfig({
      ...VALID,
      compliance: {
        ...VALID.compliance,
        knownIssues: [
          {
            description: 'Kontrast im Footer',
            successCriteria: ['1.4.3'],
            en301549: ['9.1.4.3'],
            reason: 'fix-planned',
            remedyBy: '2026-12-31',
          },
        ],
      },
    })

    expect(config.compliance.knownIssues[0]).toMatchObject({
      successCriteria: ['1.4.3'],
      reason: 'fix-planned',
      remedyBy: '2026-12-31',
    })
  })

  it.each([
    ['a missing contact address', { provider: { legalName: 'X' } }, 'provider.email'],
    ['an unroutable site url', { site: { ...VALID.site, url: 'not-a-url' } }, 'site.url'],
    ['an unknown country', { enforcement: { country: 'JP' } }, 'enforcement.country'],
    [
      'a status outside the three the regime recognises',
      { compliance: { ...VALID.compliance, status: 'mostly-fine' } },
      'compliance.status',
    ],
    [
      'a date that is not a date',
      { compliance: { ...VALID.compliance, assessedOn: '20.08.2026' } },
      'compliance.assessedOn',
    ],
    [
      'a feedback form that is not a URL',
      { provider: { ...VALID.provider, feedbackUrl: '/kontakt' } },
      'provider.feedbackUrl',
    ],
    [
      'a reason the regime does not recognise',
      { compliance: { ...VALID.compliance, auditReason: 'we-are-busy' } },
      'compliance.auditReason',
    ],
  ])('rejects %s', (_label, override, expectedPath) => {
    let thrown: unknown
    try {
      parseConfig({ ...VALID, ...override })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(ConfigError)
    expect((thrown as ConfigError).issues.join('\n')).toContain(expectedPath)
  })

  it('names the source file in the error', () => {
    expect(() => parseConfig({}, 'eaa.config.ts')).toThrow(/eaa\.config\.ts is not valid/)
  })
})

describe('defineConfig', () => {
  it('returns its input untouched, so the file stays the source of truth', () => {
    const input = defineConfig(VALID as Parameters<typeof defineConfig>[0])

    expect(input).toEqual(VALID)
  })
})

describe('loadConfig', () => {
  it('loads a TypeScript config through Node type stripping', async () => {
    const dir = await project({
      'package.json': '{"type":"module"}',
      'eaa.config.ts': `import type { EaaConfigInput } from '${sourceUrl('config/define.ts')}'
const config: EaaConfigInput = ${JSON.stringify(VALID)}
export default config
`,
    })

    const { config, path: from } = await loadConfig({ cwd: dir })

    expect(config.site.name).toBe('Musterbetrieb')
    expect(path.basename(from)).toBe('eaa.config.ts')
  })

  it('loads a JavaScript config', async () => {
    const dir = await project({
      'package.json': '{"type":"module"}',
      'eaa.config.js': `export default ${JSON.stringify(VALID)}`,
    })

    await expect(loadConfig({ cwd: dir })).resolves.toMatchObject({
      config: { enforcement: { country: 'AT' } },
    })
  })

  it('loads a JSON config', async () => {
    const dir = await project({ 'eaa.config.json': JSON.stringify(VALID) })

    await expect(loadConfig({ cwd: dir })).resolves.toMatchObject({
      config: { site: { name: 'Musterbetrieb' } },
    })
  })

  it('prefers eaa.config.ts when several are present', async () => {
    const dir = await project({
      'package.json': '{"type":"module"}',
      'eaa.config.ts': `export default ${JSON.stringify(VALID)}`,
      'eaa.config.json': JSON.stringify({ ...VALID, site: { ...VALID.site, name: 'JSON' } }),
    })

    const { config } = await loadConfig({ cwd: dir })

    expect(config.site.name).toBe('Musterbetrieb')
  })

  it('walks up from a subdirectory, so the CLI works from anywhere in the project', async () => {
    const dir = await project({
      'eaa.config.json': JSON.stringify(VALID),
      'src/pages/.keep': '',
    })

    const { config } = await loadConfig({ cwd: path.join(dir, 'src', 'pages') })

    expect(config.site.name).toBe('Musterbetrieb')
  })

  it('accepts an explicit path', async () => {
    const dir = await project({ 'config/custom.json': JSON.stringify(VALID) })

    const { config } = await loadConfig({ cwd: dir, path: 'config/custom.json' })

    expect(config.site.name).toBe('Musterbetrieb')
  })

  it('reports where it looked when there is no config', async () => {
    const dir = await project({ 'package.json': '{}' })

    // A temp directory has no eaa.config above it either.
    await expect(loadConfig({ cwd: dir })).rejects.toThrow(ConfigError)
    await expect(loadConfig({ cwd: dir })).rejects.toThrow(/No config file found/)
  })

  it('reports an explicit path that does not exist', async () => {
    const dir = await project({})

    await expect(loadConfig({ cwd: dir, path: 'nope.json' })).rejects.toThrow(/not found/)
  })

  it('reports malformed JSON without a stack trace', async () => {
    const dir = await project({ 'eaa.config.json': '{ "site": ' })

    await expect(loadConfig({ cwd: dir })).rejects.toThrow(/not valid JSON/)
  })

  it('reports a config module with no default export', async () => {
    const dir = await project({
      'package.json': '{"type":"module"}',
      'eaa.config.js': 'export const config = {}',
    })

    await expect(loadConfig({ cwd: dir })).rejects.toThrow(/no default export/)
  })

  it('validates what it loads, naming the file', async () => {
    const dir = await project({
      'eaa.config.json': JSON.stringify({ ...VALID, provider: { legalName: 'X' } }),
    })

    await expect(loadConfig({ cwd: dir })).rejects.toThrow(/eaa\.config\.json is not valid/)
  })
})

describe('findConfigFile', () => {
  it('returns undefined when nothing is found', async () => {
    const dir = await project({})

    expect(await findConfigFile(dir)).toBeUndefined()
  })
})

/** URL of a source module, for configs written into a temp directory. */
function sourceUrl(relative: string): string {
  return new URL(`../../src/${relative}`, import.meta.url).href
}
