import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OUTPUT_FORMATS } from '../../src/cli/audit.ts'
import { auditInvocation, baselineInvocation } from '../../src/cli/command.ts'
import { AUDIT_FORMATS, ConfigError, parseAuditConfig } from '../../src/config/define.ts'
import { loadAuditConfig } from '../../src/config/load.ts'

/**
 * Defaults from the project's config file, and what the flags do to them.
 *
 * The precedence is the whole feature: a file says what a project usually
 * wants, and a flag says what somebody wants on this run. Getting it backwards
 * would make `--browser` unusable for a one-off check on a project whose config
 * says otherwise, which is the shape of mistake nobody notices until they hit
 * it.
 */

const dirs: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function project(config?: unknown, name = 'eaa.config.json'): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-config-'))
  dirs.push(dir)
  if (config !== undefined) {
    await writeFile(path.join(dir, name), JSON.stringify(config, null, 2))
  }
  return dir
}

describe('the audit block', () => {
  it('is read without the statement config around it', async () => {
    // Most of the config file is required, and none of it is required to say
    // how an audit should run. A project that wants defaults and no statement
    // writes the block alone.
    const dir = await project({ audit: { failOn: 'critical', browser: true } })

    await expect(loadAuditConfig({ cwd: dir })).resolves.toMatchObject({
      audit: { failOn: 'critical', browser: true },
    })
  })

  it('is absent from a config file written for the statement alone', async () => {
    const dir = await project({ site: { name: 'x', url: 'https://x.test', locale: 'de-AT' } })

    await expect(loadAuditConfig({ cwd: dir })).resolves.toMatchObject({ audit: undefined })
  })

  it('is not required to exist at all', async () => {
    // `eaa-kit audit` predates the config file and still runs against projects
    // that have never had one; finding nothing is not a failure.
    const dir = await project()

    await expect(loadAuditConfig({ cwd: dir })).resolves.toBeUndefined()
  })

  it('refuses a path that names a file that is not there', async () => {
    const dir = await project()

    await expect(loadAuditConfig({ cwd: dir, path: 'nope.json' })).rejects.toThrow(ConfigError)
  })

  it('names the field a reader has to fix', () => {
    expect(() =>
      parseAuditConfig({ audit: { failOn: 'catastrophic' } }, 'eaa.config.json'),
    ).toThrow(ConfigError)

    try {
      parseAuditConfig({ audit: { concurrency: 0 } }, 'eaa.config.json')
      expect.unreachable()
    } catch (cause) {
      expect((cause as ConfigError).issues).toEqual(['audit.concurrency: must be 1 or more'])
    }
  })

  it('holds a count to the rule the flag parser holds it to', () => {
    try {
      parseAuditConfig({ audit: { maxPages: 2.5 } })
      expect.unreachable()
    } catch (cause) {
      expect((cause as ConfigError).issues).toEqual(['audit.maxPages: expected a whole number'])
    }
    // Depth 0 is the entry page alone, as it is on the command line.
    expect(parseAuditConfig({ audit: { maxDepth: 0 } })).toEqual({ maxDepth: 0 })
  })

  it('accepts the formats the audit command accepts, and no others', () => {
    expect([...AUDIT_FORMATS]).toEqual([...OUTPUT_FORMATS])
  })
})

describe('auditInvocation', () => {
  it('takes its defaults from the config and lets a typed flag win', () => {
    const invocation = auditInvocation(
      undefined,
      { failOn: 'minor', browser: true, include: ['about/**'] },
      { failOn: 'critical', build: true },
    )

    expect(invocation.options).toMatchObject({
      failOn: 'critical',
      browser: true,
      include: ['about/**'],
    })
  })

  it('prefers the directory somebody typed over the one the file names', () => {
    expect(auditInvocation('build', { dir: 'dist' }, { build: true }).dir).toBe('build')
    expect(auditInvocation(undefined, { dir: 'dist' }, { build: true }).dir).toBe('dist')
    // Neither: auto-detection, which is what an argument-less run has always
    // done and what the config file must not quietly take away.
    expect(auditInvocation(undefined, {}, { build: true }).dir).toBeUndefined()
  })

  it('takes no build from either side', () => {
    // commander reports build: true for a flag nobody typed, so this one cannot
    // be merged like the rest.
    expect(auditInvocation(undefined, { build: false }, { build: true }).options.noBuild).toBe(true)
    expect(auditInvocation(undefined, {}, { build: false }).options.noBuild).toBe(true)
    expect(
      auditInvocation(undefined, { build: true }, { build: true }).options.noBuild,
    ).toBeUndefined()
  })

  it('does not pass its own two keys on to the audit', () => {
    const { options } = auditInvocation('dist', { dir: 'dist' }, { build: true, config: 'x.json' })

    expect(options).not.toHaveProperty('config')
    expect(options).not.toHaveProperty('dir')
    expect(options).not.toHaveProperty('build')
  })
})

describe('baselineInvocation', () => {
  it('reads only the defaults that mean the same thing to it', () => {
    const { options } = baselineInvocation(
      'dist',
      {
        include: ['about/**'],
        browser: true,
        concurrency: 2,
        // Audit-only. `output` is the report's path here and the baseline's
        // path there, so carrying it across would write the baseline over the
        // report somebody set aside.
        output: 'report.json',
        format: 'json',
        failOn: 'critical',
        baseline: 'eaa-baseline.json',
        fast: true,
      },
      {},
    )

    expect(options).toEqual({ include: ['about/**'], browser: true, concurrency: 2 })
  })

  it('falls back through the argument, the file, and ./dist', () => {
    expect(baselineInvocation('build', { dir: 'out' }, {}).dir).toBe('build')
    expect(baselineInvocation(undefined, { dir: 'out' }, {}).dir).toBe('out')
    expect(baselineInvocation(undefined, {}, {}).dir).toBe('./dist')
  })
})
