import { describe, expect, it } from 'vitest'
import {
  type Collection,
  completeCollection,
  discoveryLabel,
  missedParts,
  runCompleteness,
} from '../../src/audit/completeness.ts'
import type { PageAudit } from '../../src/audit/result.ts'

/** A page result with nothing on it, to bolt an error onto. */
function page(overrides: Partial<PageAudit> = {}): PageAudit {
  return {
    relativePath: 'index.html',
    absolutePath: '/dist/index.html',
    url: 'file:///dist/index.html',
    engine: 'jsdom',
    violations: [],
    incomplete: [],
    passes: [],
    inapplicable: [],
    durationMs: 1,
    ...overrides,
  }
}

function collection(overrides: Partial<Collection> = {}): Collection {
  return { discovery: 'links', collected: 2, unreachable: [], truncated: false, ...overrides }
}

describe('runCompleteness', () => {
  it('is complete when everything known about was reached and audited', () => {
    const result = runCompleteness([page(), page()], completeCollection('directory', 2))

    expect(result).toMatchObject({ complete: true, audited: 2, errored: 0, truncated: false })
    expect(result.unreachable).toEqual([])
  })

  it('counts a page that errored apart from one that was never reached', () => {
    // The markup was in hand and the audit is what failed, which is a different
    // problem with a different fix.
    const result = runCompleteness(
      [page(), page({ relativePath: 'broken.html', error: 'axe-core timed out' })],
      collection({ unreachable: [{ location: '/gone', reason: '404' }] }),
    )

    expect(result.errored).toBe(1)
    expect(result.audited).toBe(1)
    expect(result.unreachable).toHaveLength(1)
    expect(result.complete).toBe(false)
  })

  it('is incomplete when the run stopped at its page limit, even with nothing wrong', () => {
    // The case the reports used to be unable to distinguish from a clean run.
    const result = runCompleteness([page(), page()], collection({ truncated: true }))

    expect(result.complete).toBe(false)
    expect(result.errored).toBe(0)
    expect(result.unreachable).toEqual([])
  })

  it('carries the collection through unchanged', () => {
    const source = collection({ discovery: 'sitemap', collected: 7 })
    const result = runCompleteness([page()], source)

    expect(result.discovery).toBe('sitemap')
    expect(result.collected).toBe(7)
  })
})

describe('missedParts', () => {
  it('names each kind of gap separately rather than summing them', () => {
    const result = runCompleteness(
      [page({ error: 'boom' })],
      collection({
        truncated: true,
        unreachable: [
          { location: '/a', reason: '404' },
          { location: '/b', reason: 'timeout' },
        ],
      }),
    )

    expect(missedParts(result)).toEqual([
      '2 could not be reached',
      '1 could not be audited',
      'the run stopped at its page limit',
    ])
  })

  it('is empty for a complete run', () => {
    expect(missedParts(runCompleteness([page()], completeCollection('directory', 1)))).toEqual([])
  })
})

describe('discoveryLabel', () => {
  it('says how the pages were found, in words a reader can act on', () => {
    expect(discoveryLabel('directory')).toBe('files in the build directory')
    expect(discoveryLabel('sitemap')).toBe('sitemap.xml and links')
    expect(discoveryLabel('links')).toBe('links from the entry page')
  })
})
