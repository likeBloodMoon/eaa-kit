import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  applyBaseline,
  BASELINE_SCHEMA_VERSION,
  type Baseline,
  BaselineError,
  buildBaseline,
  readBaseline,
  serialiseBaseline,
  writeBaseline,
} from '../../src/audit/baseline.ts'
import { elementFingerprint } from '../../src/audit/fingerprint.ts'
import type { Finding, PageAudit } from '../../src/audit/result.ts'

const TODAY = new Date('2026-08-27T10:00:00.000Z')

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function project(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-baseline-'))
  dirs.push(dir)
  return dir
}

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    ruleId: 'image-alt',
    help: 'Images must have alternative text',
    helpUrl: 'https://example.test/image-alt',
    successCriteria: ['1.1.1'],
    enClauses: ['9.1.1.1'],
    tags: [],
    impact: 'critical',
    nodes: [{ html: '<img src="/logo.svg">', target: ['img'] }],
    ...overrides,
  }
}

function page(relativePath: string, violations: Finding[]): PageAudit {
  return {
    relativePath,
    absolutePath: `/dist/${relativePath}`,
    url: `file:///dist/${relativePath}`,
    engine: 'jsdom',
    violations,
    incomplete: [],
    passes: [],
    inapplicable: [],
    durationMs: 1,
  }
}

/** The baseline that accepts everything in these audits. */
function baselineFor(audits: readonly PageAudit[], overrides = {}): Baseline {
  return buildBaseline(audits, { today: TODAY, ...overrides })
}

describe('buildBaseline', () => {
  it('records one entry per violating element', () => {
    const audits = [
      page('index.html', [
        finding({
          nodes: [
            { html: '<img src="/a.png">', target: ['img.a'] },
            { html: '<img src="/b.png">', target: ['img.b'] },
          ],
        }),
      ]),
    ]

    expect(baselineFor(audits).entries).toHaveLength(2)
  })

  it('carries enough for a human to read the file', () => {
    const entry = baselineFor([page('index.html', [finding()])]).entries[0]

    expect(entry).toMatchObject({
      page: 'index.html',
      ruleId: 'image-alt',
      selector: 'img',
      help: 'Images must have alternative text',
      impact: 'critical',
      acceptedOn: '2026-08-27',
    })
    expect(entry?.fingerprint).toHaveLength(16)
  })

  it('records a violation that named no elements', () => {
    const audits = [page('index.html', [finding({ nodes: [] })])]

    expect(baselineFor(audits).entries).toHaveLength(1)
  })

  it('writes a note and an expiry when asked', () => {
    const baseline = baselineFor([page('index.html', [finding()])], {
      note: 'agreed with the client',
      expiresOn: '2026-12-31',
    })

    expect(baseline.entries[0]).toMatchObject({
      note: 'agreed with the client',
      expiresOn: '2026-12-31',
    })
  })

  it('sorts entries so the file diffs cleanly', () => {
    const audits = [
      page('z.html', [finding({ ruleId: 'z-rule' })]),
      page('a.html', [finding({ ruleId: 'b-rule' }), finding({ ruleId: 'a-rule' })]),
    ]

    expect(baselineFor(audits).entries.map((entry) => `${entry.page} ${entry.ruleId}`)).toEqual([
      'a.html a-rule',
      'a.html b-rule',
      'z.html z-rule',
    ])
  })

  it('has nothing to record for a clean run', () => {
    expect(baselineFor([page('index.html', [])]).entries).toEqual([])
  })
})

describe('applyBaseline', () => {
  const audits = [page('index.html', [finding()])]

  it('moves an accepted violation out of the failing set', () => {
    const outcome = applyBaseline(audits, baselineFor(audits), { today: TODAY })

    expect(outcome.audits[0]?.violations).toEqual([])
    expect(outcome.accepted).toBe(1)
  })

  it('keeps it as a violation rather than turning it into a pass', () => {
    // The one thing a baseline must never do is make a barrier look met.
    const outcome = applyBaseline(audits, baselineFor(audits), { today: TODAY })

    expect(outcome.audits[0]?.accepted?.[0]?.ruleId).toBe('image-alt')
    expect(outcome.audits[0]?.passes).toEqual([])
  })

  it('does not touch the audits it was given', () => {
    applyBaseline(audits, baselineFor(audits), { today: TODAY })

    expect(audits[0]?.violations).toHaveLength(1)
  })

  it('still fails a new violation of an already-accepted rule', () => {
    // The whole safety property: accepting one image without alt text must not
    // accept the next one.
    const later = [
      page('index.html', [
        finding({
          nodes: [
            { html: '<img src="/logo.svg">', target: ['img'] },
            { html: '<img src="/new.png">', target: ['img.new'] },
          ],
        }),
      ]),
    ]

    const outcome = applyBaseline(later, baselineFor(audits), { today: TODAY })

    expect(outcome.audits[0]?.violations).toHaveLength(1)
    expect(outcome.audits[0]?.violations[0]?.nodes).toEqual([
      { html: '<img src="/new.png">', target: ['img.new'] },
    ])
    expect(outcome.audits[0]?.accepted?.[0]?.nodes).toHaveLength(1)
  })

  it('still fails the same element on a different page', () => {
    const elsewhere = [page('about.html', [finding()])]

    const outcome = applyBaseline(elsewhere, baselineFor(audits), { today: TODAY })

    expect(outcome.audits[0]?.violations).toHaveLength(1)
    expect(outcome.accepted).toBe(0)
  })

  it('still fails a different rule on the same element', () => {
    const other = [page('index.html', [finding({ ruleId: 'image-redundant-alt' })])]

    const outcome = applyBaseline(other, baselineFor(audits), { today: TODAY })

    expect(outcome.audits[0]?.violations).toHaveLength(1)
  })

  it('accepts a violation that named no elements', () => {
    const none = [page('index.html', [finding({ nodes: [] })])]

    const outcome = applyBaseline(none, baselineFor(none), { today: TODAY })

    expect(outcome.audits[0]?.violations).toEqual([])
    expect(outcome.audits[0]?.accepted).toHaveLength(1)
  })

  it('reports entries that no longer match, so the file can shrink', () => {
    const fixed = [page('index.html', [])]

    const outcome = applyBaseline(fixed, baselineFor(audits), { today: TODAY })

    expect(outcome.stale).toHaveLength(1)
    expect(outcome.stale[0]?.ruleId).toBe('image-alt')
  })

  it('reports nothing stale when everything still matches', () => {
    expect(applyBaseline(audits, baselineFor(audits), { today: TODAY }).stale).toEqual([])
  })

  it('stops suppressing once an entry has expired', () => {
    const expiring = baselineFor(audits, { expiresOn: '2026-08-26' })

    const outcome = applyBaseline(audits, expiring, { today: TODAY })

    expect(outcome.audits[0]?.violations).toHaveLength(1)
    expect(outcome.expired).toHaveLength(1)
    expect(outcome.accepted).toBe(0)
  })

  it('still suppresses on the day it expires', () => {
    const expiring = baselineFor(audits, { expiresOn: '2026-08-27' })

    const outcome = applyBaseline(audits, expiring, { today: TODAY })

    expect(outcome.accepted).toBe(1)
    expect(outcome.expired).toEqual([])
  })

  it('does not report an expired entry as stale as well', () => {
    const expiring = baselineFor(audits, { expiresOn: '2026-01-01' })

    const outcome = applyBaseline(audits, expiring, { today: TODAY })

    expect(outcome.stale).toEqual([])
  })

  it('accepts nothing from an empty baseline', () => {
    const empty: Baseline = { schemaVersion: 1, createdOn: '', entries: [] }

    const outcome = applyBaseline(audits, empty, { today: TODAY })

    expect(outcome.audits[0]?.violations).toHaveLength(1)
    expect(outcome.audits[0]?.accepted).toBeUndefined()
  })
})

describe('the file', () => {
  it('round-trips through disk unchanged', async () => {
    const dir = await project()
    const baseline = baselineFor([page('index.html', [finding()])])

    await writeBaseline('eaa-baseline.json', baseline, dir)

    expect(await readBaseline('eaa-baseline.json', dir)).toEqual(baseline)
  })

  it('creates the directories on the way to it', async () => {
    const dir = await project()

    await writeBaseline('config/a11y/baseline.json', baselineFor([]), dir)

    expect(await readBaseline('config/a11y/baseline.json', dir)).toBeDefined()
  })

  it('ends with a newline, like every other file this tool writes', async () => {
    const dir = await project()
    await writeBaseline('b.json', baselineFor([]), dir)

    expect(await readFile(path.join(dir, 'b.json'), 'utf8')).toMatch(/\}\n$/)
  })

  it('declares its schema version', () => {
    expect(baselineFor([]).schemaVersion).toBe(BASELINE_SCHEMA_VERSION)
    expect(serialiseBaseline(baselineFor([]))).toContain('"schemaVersion": 1')
  })

  it('says how to make one when it is not there', async () => {
    const dir = await project()

    await expect(readBaseline('missing.json', dir)).rejects.toThrow(
      /Could not read the baseline at missing\.json.*eaa-kit baseline/s,
    )
  })

  it('rejects a file that is not JSON', async () => {
    const dir = await project()
    await writeFile(path.join(dir, 'b.json'), 'not json', 'utf8')

    await expect(readBaseline('b.json', dir)).rejects.toThrow(/is not valid JSON/)
  })

  it('rejects a document that is not a baseline', async () => {
    const dir = await project()
    await writeFile(path.join(dir, 'b.json'), JSON.stringify({ hello: 'world' }), 'utf8')

    await expect(readBaseline('b.json', dir)).rejects.toThrow(BaselineError)
    await expect(readBaseline('b.json', dir)).rejects.toThrow(/is not an eaa-kit baseline/)
  })

  it('rejects a schema version it does not know how to read', async () => {
    const dir = await project()
    await writeFile(
      path.join(dir, 'b.json'),
      JSON.stringify({ schemaVersion: 99, entries: [] }),
      'utf8',
    )

    await expect(readBaseline('b.json', dir)).rejects.toThrow(/schemaVersion 99/)
  })
})

describe('elementFingerprint', () => {
  it('is stable for the same element', () => {
    expect(elementFingerprint('image-alt', 'img', '<img>')).toBe(
      elementFingerprint('image-alt', 'img', '<img>'),
    )
  })

  it('changes when the rule, the selector or the markup changes', () => {
    const base = elementFingerprint('image-alt', 'img', '<img>')

    expect(elementFingerprint('link-name', 'img', '<img>')).not.toBe(base)
    expect(elementFingerprint('image-alt', 'img.x', '<img>')).not.toBe(base)
    expect(elementFingerprint('image-alt', 'img', '<img alt="">')).not.toBe(base)
  })

  it('does not depend on the page, so a moved page keeps its baseline', () => {
    // The same promise SARIF relies on: moving a file must not close one alert
    // and open an identical one.
    expect(elementFingerprint('image-alt', 'img', '<img>')).toHaveLength(16)
  })
})
