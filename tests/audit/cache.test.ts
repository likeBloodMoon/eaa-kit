import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CACHE_SCHEMA_VERSION,
  type CacheInputs,
  DEFAULT_CACHE_DIR,
  fromEntry,
  inputsKey,
  openCache,
  pageKey,
} from '../../src/audit/cache.ts'
import type { CollectedPage } from '../../src/audit/collect.ts'
import { completeCollection, runCompleteness } from '../../src/audit/completeness.ts'
import type { PageAudit } from '../../src/audit/result.ts'

const TODAY = new Date('2026-09-10T00:00:00Z')

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function workspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-cache-'))
  dirs.push(dir)
  return dir
}

function page(overrides: Partial<CollectedPage> = {}): CollectedPage {
  return {
    relativePath: 'index.html',
    absolutePath: '/home/somebody/site/dist/index.html',
    html: '<!doctype html><html lang="en"><head><title>Home</title></head><body></body></html>',
    ...overrides,
  }
}

function audit(overrides: Partial<PageAudit> = {}): PageAudit {
  return {
    relativePath: 'index.html',
    absolutePath: '/home/somebody/site/dist/index.html',
    url: 'file:///home/somebody/site/dist/index.html',
    engine: 'jsdom',
    violations: [],
    incomplete: [],
    passes: [],
    inapplicable: [],
    durationMs: 42,
    ...overrides,
  }
}

const INPUTS: CacheInputs = {
  toolVersion: '0.7.0',
  axeVersion: '4.13.0',
  tags: ['wcag2a', 'wcag2aa'],
  engine: 'jsdom',
  fast: false,
}

describe('the identity of a page', () => {
  it('changes when the markup changes', () => {
    expect(pageKey(page())).not.toBe(pageKey(page({ html: '<!doctype html><p>different</p>' })))
  })

  it('changes when the same markup is served at another path', () => {
    // The path is what every baseline, diff and report keys on, so two paths
    // are two pages even when the bytes match.
    expect(pageKey(page())).not.toBe(pageKey(page({ relativePath: 'about/index.html' })))
  })

  it('does not change when only the machine does', () => {
    expect(pageKey(page())).toBe(pageKey(page({ absolutePath: '/somewhere/else/index.html' })))
  })
})

describe('the identity of everything else', () => {
  const variants: Array<[string, Partial<CacheInputs>]> = [
    ['a new tool version', { toolVersion: '0.7.1' }],
    ['a new axe-core', { axeVersion: '4.14.0' }],
    ['a different rule set', { tags: ['wcag2a'] }],
    ['the other engine', { engine: 'browser' }],
    ['--fast', { fast: true }],
    ['a viewport', { viewport: { width: 360, height: 640 } }],
    ['a base URL', { baseUrl: 'https://example.com' }],
    ['a different timeout', { timeoutMs: 9000 }],
    ['a credential', { headers: { Authorization: 'Basic abc' } }],
  ]

  for (const [what, change] of variants) {
    it(`changes with ${what}`, () => {
      expect(inputsKey({ ...INPUTS, ...change })).not.toBe(inputsKey(INPUTS))
    })
  }

  it('does not change when nothing did', () => {
    expect(inputsKey({ ...INPUTS })).toBe(inputsKey(INPUTS))
  })

  it('never contains the credential it was keyed on', () => {
    const key = inputsKey({ ...INPUTS, headers: { Authorization: 'Basic sk-secret' } })

    expect(key).not.toContain('sk-secret')
  })
})

describe('reading and writing', () => {
  it('misses on an empty cache and hits after a flush', async () => {
    const cwd = await workspace()
    const first = await openCache(INPUTS, { cwd, today: TODAY })

    expect(first.get(page())).toBeUndefined()
    first.put(page(), audit())
    await first.flush()

    const second = await openCache(INPUTS, { cwd, today: TODAY })
    expect(second.get(page())?.page).toBe('index.html')
  })

  it('misses when anything about the run changed', async () => {
    const cwd = await workspace()
    const first = await openCache(INPUTS, { cwd, today: TODAY })
    first.put(page(), audit())
    await first.flush()

    const other = await openCache({ ...INPUTS, fast: true }, { cwd, today: TODAY })

    expect(other.get(page())).toBeUndefined()
  })

  it('discards the whole cache when the inputs changed, rather than reasoning about entries', async () => {
    const cwd = await workspace()
    const first = await openCache(INPUTS, { cwd, today: TODAY })
    first.put(page(), audit())
    first.put(page({ relativePath: 'about.html' }), audit({ relativePath: 'about.html' }))
    await first.flush()

    await openCache({ ...INPUTS, axeVersion: '5.0.0' }, { cwd, today: TODAY })

    const left = await readdir(path.join(cwd, DEFAULT_CACHE_DIR)).catch(() => [])
    expect(left).toEqual([])
  })

  it('treats an unreadable entry as a miss and audits that page again', async () => {
    const cwd = await workspace()
    const first = await openCache(INPUTS, { cwd, today: TODAY })
    first.put(page(), audit())
    await first.flush()
    await writeFile(
      path.join(cwd, DEFAULT_CACHE_DIR, `${pageKey(page())}.json`),
      '{ broken',
      'utf8',
    )

    const second = await openCache(INPUTS, { cwd, today: TODAY })

    expect(second.get(page())).toBeUndefined()
  })

  it('never stores a page that could not be audited', async () => {
    // A timeout is a fact about a machine at a moment. Freezing it would make
    // one bad afternoon permanent; storing it as clean would be worse.
    const cwd = await workspace()
    const cache = await openCache(INPUTS, { cwd, today: TODAY })

    cache.put(page(), audit({ error: 'axe-core timed out after 30000ms' }))
    await cache.flush()

    const second = await openCache(INPUTS, { cwd, today: TODAY })
    expect(second.get(page())).toBeUndefined()
  })

  it('stores nothing about the machine it ran on', async () => {
    const cwd = await workspace()
    const cache = await openCache(INPUTS, { cwd, today: TODAY })
    cache.put(page(), audit())
    await cache.flush()

    const stored = await readFile(
      path.join(cwd, DEFAULT_CACHE_DIR, `${pageKey(page())}.json`),
      'utf8',
    )

    expect(stored).not.toContain('/home/somebody')
    expect(stored).not.toContain('durationMs')
  })

  it('is not an error when it cannot be written', async () => {
    // A read-only checkout, a full disk, a sandbox that forbids the directory:
    // the run was correct and the next one is merely as slow as it would have
    // been anyway. Stood in for here by a cache directory that is a file.
    const cwd = await workspace()
    await writeFile(path.join(cwd, 'not-a-directory'), 'in the way', 'utf8')
    const cache = await openCache(INPUTS, { cwd, dir: 'not-a-directory/cache', today: TODAY })
    cache.put(page(), audit())

    await expect(cache.flush()).resolves.toBeUndefined()
  })
})

describe('a restored result', () => {
  it('takes the page from the cache and everything else from this run', async () => {
    const cwd = await workspace()
    const cache = await openCache(INPUTS, { cwd, today: TODAY })
    cache.put(page(), audit({ durationMs: 512 }))
    await cache.flush()

    const entry = (await openCache(INPUTS, { cwd, today: TODAY })).get(page())
    const restored = fromEntry(entry as never, page({ absolutePath: '/elsewhere/index.html' }), {
      url: 'https://example.com/',
      engine: 'jsdom',
    })

    expect(restored.absolutePath).toBe('/elsewhere/index.html')
    expect(restored.url).toBe('https://example.com/')
    // Not the duration of a run that happened on another day.
    expect(restored.durationMs).toBe(0)
    expect(restored.reused).toEqual({ on: '2026-09-10' })
  })
})

describe('what the completeness record makes of it', () => {
  it('counts reused pages apart from audited ones', () => {
    const completeness = runCompleteness(
      [audit(), audit({ relativePath: 'a.html', reused: { on: '2026-09-01' } })],
      completeCollection('directory', 2),
    )

    expect(completeness.audited).toBe(1)
    expect(completeness.reused).toBe(1)
  })

  it('does not call a run incomplete for reusing a result', () => {
    // Nothing was missed: every page has a verdict from an engine that saw this
    // exact markup. `complete` answers a different question.
    const completeness = runCompleteness(
      [audit({ reused: { on: '2026-09-01' } })],
      completeCollection('directory', 1),
    )

    expect(completeness.complete).toBe(true)
    expect(completeness.reused).toBe(1)
  })

  it('says nothing about reuse when there was none', () => {
    expect(runCompleteness([audit()], completeCollection('directory', 1)).reused).toBe(0)
  })
})

describe('the stored format', () => {
  it('carries a schema version, so a later shape is a miss rather than a misread', async () => {
    const cwd = await workspace()
    const cache = await openCache(INPUTS, { cwd, today: TODAY })
    cache.put(page(), audit())
    await cache.flush()
    const file = path.join(cwd, DEFAULT_CACHE_DIR, `${pageKey(page())}.json`)
    const stored = JSON.parse(await readFile(file, 'utf8')) as { schemaVersion: number }
    expect(stored.schemaVersion).toBe(CACHE_SCHEMA_VERSION)

    await writeFile(file, JSON.stringify({ ...stored, schemaVersion: 99 }), 'utf8')
    const second = await openCache(INPUTS, { cwd, today: TODAY })

    expect(second.get(page())).toBeUndefined()
  })
})
