import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as s from '../schema.ts'
import { isoDate } from '../text.ts'
import type { CollectedPage } from './collect.ts'
import type { Finding, IncompleteFinding, PageAudit, RuleOutcome } from './result.ts'

/**
 * Results kept between runs, so a build re-audits only what changed.
 *
 * CI audits the whole build on every push and most pushes change three pages.
 * Worse, a run where *nothing* changed still pays the fixed cost of an audit:
 * measured on the five-page fixture, `--version` is ~240 ms and an audit ~1,510
 * ms, and almost all of the difference is loading jsdom before a single page is
 * parsed. The engine is behind an `await import`, so a run that needs no engine
 * need not pay for one — but only if the hit-or-miss decision is made before
 * the import, which is what shapes everything here.
 *
 * The saving is obvious and so is the risk, so the refusals come first:
 *
 * - **A reused result is not a result this run produced.** It is carried on the
 *   audit as `reused`, counted apart from audited pages in the completeness
 *   record, printed by every report format, and — the one that matters —
 *   `diff` will not call a reused page fixed. A cache that let a stale verdict
 *   pass as a fresh one would turn this tool into the thing it exists to refuse.
 * - **Only what is a property of the page is stored.** Not the absolute path or
 *   the URL, which are machine-specific and would leak a home directory into a
 *   file somebody commits by accident; not `durationMs`, which is a fact about
 *   a moment; not `accepted`, which is a baseline decision re-applied on every
 *   run; and never `error`, because a page that timed out did so on a machine
 *   at a time, and freezing that would make one bad afternoon permanent.
 * - **Anything that could change a verdict invalidates everything.** The
 *   manifest records those inputs; a mismatch throws the whole cache away
 *   rather than reasoning about which entries survived.
 * - **A cache that cannot be read is a miss.** Never an error, never a stale
 *   answer. The worst a broken cache may do is make a run as slow as it was
 *   before there was one.
 */

/** Bumped when a stored field is removed, renamed, or changes meaning. */
export const CACHE_SCHEMA_VERSION = 1

/** Where entries live, under the directory the tool already owns. */
export const DEFAULT_CACHE_DIR = '.eaa-kit/cache'

const MANIFEST_FILE = 'manifest.json'

/**
 * Everything that could change what an audit concludes.
 *
 * Not a list of flags: a list of *inputs to a verdict*. `--fail-on` and
 * `--format` are absent because they decide how a finding is reported rather
 * than whether it is one, and `--concurrency` is absent because a test asserts
 * that threading does not move the output. Everything else that reaches the
 * engine belongs here, and `headers` reaches it only as a hash — a credential
 * is never written to disk by this tool.
 */
export interface CacheInputs {
  toolVersion: string
  axeVersion: string
  /** Rule tags the run audits under, in the order they were given. */
  tags: readonly string[]
  engine: 'jsdom' | 'browser'
  fast: boolean
  /** Browser only, and it changes layout-dependent verdicts. */
  viewport?: { width: number; height: number }
  /** Relative hrefs resolve against it, so it can change a verdict. */
  baseUrl?: string
  timeoutMs?: number
  /** Hashed, never stored: what was sent can change what was served. */
  headers?: Record<string, string>
}

const outcomeSchema = s.object({
  ruleId: s.string(),
  help: s.withDefault(s.string(), () => ''),
  helpUrl: s.withDefault(s.string(), () => ''),
  successCriteria: s.withDefault(s.array(s.string()), () => []),
  enClauses: s.withDefault(s.array(s.string()), () => []),
  tags: s.withDefault(s.array(s.string()), () => []),
})

const nodeSchema = s.object({
  html: s.string(),
  target: s.withDefault(s.array(s.string()), () => []),
  failureSummary: s.optional(s.string()),
})

const findingSchema = s.object({
  ruleId: s.string(),
  help: s.withDefault(s.string(), () => ''),
  helpUrl: s.withDefault(s.string(), () => ''),
  successCriteria: s.withDefault(s.array(s.string()), () => []),
  enClauses: s.withDefault(s.array(s.string()), () => []),
  tags: s.withDefault(s.array(s.string()), () => []),
  impact: s.withDefault(s.nullable(s.string()), () => null),
  nodes: s.withDefault(s.array(nodeSchema), () => []),
})

const incompleteSchema = s.object({
  ruleId: s.string(),
  help: s.withDefault(s.string(), () => ''),
  helpUrl: s.withDefault(s.string(), () => ''),
  successCriteria: s.withDefault(s.array(s.string()), () => []),
  enClauses: s.withDefault(s.array(s.string()), () => []),
  tags: s.withDefault(s.array(s.string()), () => []),
  impact: s.withDefault(s.nullable(s.string()), () => null),
  nodes: s.withDefault(s.array(nodeSchema), () => []),
  reason: s.enumeration(['needs-review', 'engine-limitation']),
  reasonDetail: s.withDefault(s.string(), () => ''),
})

const entrySchema = s.object({
  schemaVersion: s.number(),
  /** The page this describes, as the run names it. */
  page: s.string(),
  /** ISO date the result was produced, printed by the reports. */
  cachedOn: s.string(),
  violations: s.withDefault(s.array(findingSchema), () => []),
  incomplete: s.withDefault(s.array(incompleteSchema), () => []),
  passes: s.withDefault(s.array(outcomeSchema), () => []),
  inapplicable: s.withDefault(s.array(outcomeSchema), () => []),
})

const manifestSchema = s.object({
  schemaVersion: s.number(),
  /** Hash of everything in `CacheInputs`. A mismatch discards the cache. */
  key: s.string(),
  createdOn: s.withDefault(s.string(), () => ''),
})

export type CacheEntry = s.Infer<typeof entrySchema>

/** What a run gets back: the results it may reuse, and where to put the rest. */
export interface PageCache {
  /** A stored result for this page, or undefined for a miss. */
  get(page: CollectedPage): CacheEntry | undefined
  /** Record a fresh result. Written when `flush` is called, not before. */
  put(page: CollectedPage, audit: PageAudit): void
  /** Write what was recorded. Best-effort: a cache that cannot be written is not an error. */
  flush(): Promise<void>
}

/**
 * The identity of a page's content.
 *
 * Path and HTML together: the same markup at two paths is two pages, because
 * the path is what a baseline, a diff and every report key on. A full digest
 * rather than the sixteen characters `elementFingerprint` uses — that one is
 * read by people in a committed file, and this one is read only by the tool,
 * where a collision would serve one page's verdicts for another's.
 */
export function pageKey(page: CollectedPage): string {
  return createHash('sha256').update(`${page.relativePath}\n${page.html}`).digest('hex')
}

/**
 * The identity of everything else the verdict depends on.
 *
 * Headers are hashed with the rest and never recorded: what a run sent can
 * change what it was served, so it belongs in the key, and a credential does
 * not belong on disk.
 */
export function inputsKey(inputs: CacheInputs): string {
  const headers = Object.entries(inputs.headers ?? {})
    .map(([name, value]) => `${name.toLowerCase()}=${value}`)
    .sort()
    .join('\n')

  return createHash('sha256')
    .update(
      [
        `tool=${inputs.toolVersion}`,
        `axe=${inputs.axeVersion}`,
        `tags=${[...inputs.tags].join(',')}`,
        `engine=${inputs.engine}`,
        `fast=${inputs.fast}`,
        `viewport=${inputs.viewport ? `${inputs.viewport.width}x${inputs.viewport.height}` : ''}`,
        `baseUrl=${inputs.baseUrl ?? ''}`,
        `timeout=${inputs.timeoutMs ?? ''}`,
        `headers=${createHash('sha256').update(headers).digest('hex')}`,
      ].join('\n'),
    )
    .digest('hex')
}

/**
 * Open the cache for a run, discarding it if anything about the run changed.
 *
 * Everything is read up front and held in memory: an audit asks about every
 * page before it audits any, the entries are small, and a synchronous answer
 * is what lets the caller decide whether to import an engine at all.
 */
export async function openCache(
  inputs: CacheInputs,
  options: { dir?: string; cwd?: string; today?: Date } = {},
): Promise<PageCache> {
  const root = path.resolve(options.cwd ?? process.cwd(), options.dir ?? DEFAULT_CACHE_DIR)
  const key = inputsKey(inputs)
  const today = isoDate(options.today ?? new Date())

  const entries = (await manifestMatches(root, key)) ? await readEntries(root) : new Map()
  const written = new Map<string, CacheEntry>()

  return {
    get(page) {
      return entries.get(pageKey(page))
    },
    put(page, audit) {
      // A page that could not be audited is not a result. Storing it would make
      // one timeout permanent; storing it as clean would be worse.
      if (audit.error !== undefined) return
      written.set(pageKey(page), toEntry(page, audit, today))
    },
    async flush() {
      if (written.size === 0) return
      try {
        await mkdir(root, { recursive: true })
        // The manifest is written first: a run interrupted between the two
        // leaves entries nothing will read, which is a miss, rather than
        // entries a later run trusts under the wrong key.
        await writeFile(
          path.join(root, MANIFEST_FILE),
          `${JSON.stringify({ schemaVersion: CACHE_SCHEMA_VERSION, key, createdOn: today }, null, 2)}\n`,
          'utf8',
        )
        await Promise.all(
          [...written].map(([hash, entry]) =>
            writeFile(path.join(root, `${hash}.json`), `${JSON.stringify(entry)}\n`, 'utf8'),
          ),
        )
      } catch {
        // A read-only checkout, a full disk, a sandbox that forbids the
        // directory: the run was correct and the next one is merely as slow as
        // it would have been anyway.
      }
    },
  }
}

/**
 * Whether the stored cache was produced under the same conditions as this run.
 *
 * A mismatch empties the directory rather than leaving entries to be stepped
 * over. They can never be read again — the key that would reach them is gone —
 * and leaving them would grow `.eaa-kit/` without limit.
 */
async function manifestMatches(root: string, key: string): Promise<boolean> {
  let raw: string
  try {
    raw = await readFile(path.join(root, MANIFEST_FILE), 'utf8')
  } catch {
    return false
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    await discard(root)
    return false
  }

  const result = s.safeParse(manifestSchema, parsed)
  if (
    !result.success ||
    result.data.schemaVersion !== CACHE_SCHEMA_VERSION ||
    result.data.key !== key
  ) {
    await discard(root)
    return false
  }
  return true
}

async function discard(root: string): Promise<void> {
  try {
    await rm(root, { recursive: true, force: true })
  } catch {
    // Nothing readable will be read: `manifestMatches` has already said no.
  }
}

/** Every entry in the directory, keyed by page hash. A bad file is skipped. */
async function readEntries(root: string): Promise<Map<string, CacheEntry>> {
  let files: string[]
  try {
    files = await readdir(root)
  } catch {
    return new Map()
  }

  const entries = new Map<string, CacheEntry>()
  await Promise.all(
    files
      .filter((file) => file.endsWith('.json') && file !== MANIFEST_FILE)
      .map(async (file) => {
        try {
          const parsed: unknown = JSON.parse(await readFile(path.join(root, file), 'utf8'))
          const result = s.safeParse(entrySchema, parsed)
          if (!result.success || result.data.schemaVersion !== CACHE_SCHEMA_VERSION) return
          entries.set(path.basename(file, '.json'), result.data)
        } catch {
          // One unreadable entry is one page audited again.
        }
      }),
  )
  return entries
}

/** The parts of a result that describe the page rather than the run. */
function toEntry(page: CollectedPage, audit: PageAudit, today: string): CacheEntry {
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    page: page.relativePath,
    cachedOn: today,
    violations: audit.violations as CacheEntry['violations'],
    incomplete: audit.incomplete as CacheEntry['incomplete'],
    passes: audit.passes as CacheEntry['passes'],
    inapplicable: audit.inapplicable as CacheEntry['inapplicable'],
  }
}

/**
 * A stored result, put back together as this run's audit.
 *
 * The page's own facts come from the cache; everything about *this* run — where
 * the file is, what URL it is audited under, which engine is running — comes
 * from the run, because those are not properties of the result. `durationMs` is
 * zero rather than the duration of a run that happened on another day, and
 * `reused` is what stops every consumer downstream from mistaking this for work
 * that was done just now.
 */
export function fromEntry(
  entry: CacheEntry,
  page: CollectedPage,
  context: { url: string; engine: 'jsdom' | 'browser' },
): PageAudit {
  return {
    relativePath: page.relativePath,
    absolutePath: page.absolutePath,
    url: context.url,
    engine: context.engine,
    violations: entry.violations as Finding[],
    incomplete: entry.incomplete as IncompleteFinding[],
    passes: entry.passes as RuleOutcome[],
    inapplicable: entry.inapplicable as RuleOutcome[],
    durationMs: 0,
    reused: { on: entry.cachedOn },
  }
}
