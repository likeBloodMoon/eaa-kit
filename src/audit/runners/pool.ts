import { availableParallelism } from 'node:os'
import { Worker } from 'node:worker_threads'
import { isFile } from '../../fs.ts'
import type { CollectedPage } from '../collect.ts'
import { DEFAULT_PAGE_TIMEOUT_MS, failedPage, type PageAudit, pageUrl } from '../result.ts'
import type { JsdomRunnerOptions } from './jsdom.ts'

/**
 * Audit pages across worker threads.
 *
 * The sequential runner's own comment is right that async concurrency buys
 * nothing here: jsdom parsing and axe-core are CPU-bound, and interleaving them
 * on one thread just interleaves them. Threads are a different claim. Measured
 * on a 4-core box over 100 pages of a typical marketing site: 199 ms per page
 * on one thread, 101 ms per page over three workers.
 *
 * This module deliberately does not import jsdom. When the work goes to
 * workers, the process that spawned them never parses a page itself, and
 * loading a 630 ms dependency to supervise threads that each load their own
 * would be pure overhead. The one path that needs it — the fallback below —
 * imports it when it gets there.
 */

/**
 * What one page costs to audit, near enough to decide whether threads are worth
 * starting: a fixed cost for building the document and setting axe-core up,
 * plus a term for the markup it has to walk.
 *
 * Calibrated by measurement on a 4-core box, not derived: a 190-byte page takes
 * ~30 ms and a 12 KB page ~200 ms. It is a coarse estimate and does not need to
 * be anything better — the only decisions resting on it are how many threads to
 * start, and whether to start any, where the measured cost of being one worker
 * out is a few percent either way.
 */
const PAGE_FIXED_MS = 25
const BYTES_PER_MS = 70

/**
 * Estimated work below which the run stays on one thread.
 *
 * Workers load jsdom while the process that spawned them waits, and on a busy
 * machine two of them loading it at once take longer than one would. Under this
 * much work that latency is not repaid: measured over 10 pages of ~190 bytes,
 * 1.47 s on one thread against 1.51 s across two.
 */
const MIN_WORK_FOR_THREADS_MS = 500

/**
 * Estimated work one worker should be carrying before another is added.
 *
 * Two workers carry a run to about 32 pages of a typical marketing site on
 * their own; past that a third starts winning. Measured at 2 and 3 workers:
 * 12 pages 2.91 s and 3.10 s, 32 pages 4.84 s and 4.88 s, 48 pages 6.23 s and
 * 5.90 s, 64 pages 7.91 s and 7.00 s.
 */
const WORK_PER_WORKER_MS = 1600

/** Threading at all means at least two, or there is nothing to overlap with. */
const MIN_WORKERS = 2

/**
 * Grace above the runner's own per-page timeout before a worker is killed.
 *
 * The runner races axe-core against a timer, which works whenever the work
 * yields to the event loop: the page is reported with an error and the thread
 * lives on to take the next one. That is the better outcome, so it is given
 * room to happen first. This is the backstop for when it cannot — see
 * `watchdog` below.
 */
const HARD_TIMEOUT_GRACE_MS = 5_000

/**
 * Ceiling on workers regardless of core count. Past this, the run is bounded by
 * memory bandwidth and by each worker's own start-up rather than by cores, and
 * every extra thread holds another jsdom document tree.
 */
const MAX_WORKERS = 8

export interface PooledRunnerOptions extends JsdomRunnerOptions {
  /**
   * Workers to spawn. Defaults to what `plannedWorkers` decides. 1 audits in
   * this process, with no threads and no start-up cost.
   */
  concurrency?: number
  /**
   * Where to load the worker from, for a bundle whose layout `findWorkerEntry`
   * does not recognise. Defaults to whatever it finds.
   */
  workerEntry?: URL
}

/** Roughly how long these pages would take to audit on one thread. */
export function estimateWorkMs(pages: readonly CollectedPage[]): number {
  let total = 0
  for (const page of pages) total += PAGE_FIXED_MS + page.html.length / BYTES_PER_MS
  return total
}

/**
 * How many workers this run should use, given the machine it is on.
 *
 * Page count alone cannot answer this: five pages of a real marketing site are
 * worth threading and forty pages of a stub site are not, and the difference is
 * how much markup there is to walk. So the decision is made on estimated work.
 *
 * Returns 1 for anything small enough that starting threads would cost more
 * than it saves — the caller treats that as "audit in this process".
 */
export function plannedWorkers(
  pages: readonly CollectedPage[],
  parallelism = availableParallelism(),
): number {
  const work = estimateWorkMs(pages)
  if (work < MIN_WORK_FOR_THREADS_MS) return 1

  // One core is left for the process supervising the workers and for whatever
  // else is running: on a CI box this is rarely the only thing on the machine.
  const cores = Math.max(1, parallelism - 1)
  if (cores < MIN_WORKERS) return 1

  const wanted = Math.max(MIN_WORKERS, Math.round(work / WORK_PER_WORKER_MS))
  return Math.min(wanted, cores, MAX_WORKERS)
}

/**
 * Audit pages in parallel, returning them in the order they were given.
 *
 * Falls back to auditing in this process whenever threads are not available or
 * not worth it, so callers get results either way and never a partial answer.
 */
export async function runPooledAudit(
  pages: readonly CollectedPage[],
  options: PooledRunnerOptions = {},
): Promise<PageAudit[]> {
  if (pages.length === 0) return []

  const { concurrency, workerEntry, ...runnerOptions } = options
  const workers = concurrency ?? plannedWorkers(pages)
  const entry = workers > 1 ? (workerEntry ?? (await findWorkerEntry())) : undefined

  // No threads asked for, or no worker entry to run in them: this is not a
  // failure, it is the single-threaded runner, which is always correct.
  if (!entry) return auditHere(pages, runnerOptions)

  return runWorkers(pages, runnerOptions, Math.min(workers, pages.length), entry)
}

async function auditHere(
  pages: readonly CollectedPage[],
  options: JsdomRunnerOptions,
): Promise<PageAudit[]> {
  const { runJsdomAudit } = await import('./jsdom.ts')
  return runJsdomAudit(pages, options)
}

/**
 * The only place a per-page ceiling can actually be enforced.
 *
 * The runner's own timeout is a `Promise.race`, and a race cannot interrupt
 * synchronous work: jsdom's parse and axe-core's walk of the tree both hold the
 * thread, so the timer that is meant to stop them never gets to run. Measured
 * on a 120,000-element document with a two-second ceiling, the audit was still
 * going more than ten minutes later — and because the pool waits on its
 * workers, the whole run went with it. A CI job hung until the platform killed
 * it, which is the failure the ceiling exists to prevent.
 *
 * `worker.terminate()` is the answer, because it stops the thread whatever it
 * is doing. So the supervisor keeps its own deadline per page and kills the
 * thread that overruns it, records that page as unaudited, and lets the rest of
 * the run carry on. The page is reported as a failure rather than as a clean
 * page, which the CLI already turns into exit 2.
 *
 * Two runs still have no hard ceiling, because both refuse the threads that
 * would carry it: `--concurrency 1`, and a machine with too few cores to spare
 * one. Both are documented rather than papered over, and the size cap in
 * `collectPages` is what keeps them bounded in practice.
 */
async function runWorkers(
  pages: readonly CollectedPage[],
  options: JsdomRunnerOptions,
  count: number,
  entry: URL,
): Promise<PageAudit[]> {
  const deadlineMs = (options.timeoutMs ?? DEFAULT_PAGE_TIMEOUT_MS) + HARD_TIMEOUT_GRACE_MS
  // Indexed by position, not by completion order: two runs of the same build
  // must produce the same report, and the workers finish out of order.
  //
  // Filled rather than merely sized. `new Array(n)` is sparse, and map, flatMap
  // and filter all skip holes — so a page no worker ever reported on would not
  // appear in the sweep below, would not be turned into a failed page by the
  // map at the end, and would vanish from the report instead of being counted
  // as unaudited. Every safety net in this function depends on the slot
  // existing.
  const audits: Array<PageAudit | undefined> = Array.from({ length: pages.length })
  let next = 0

  await Promise.all(
    Array.from({ length: count }, () => {
      return new Promise<void>((resolve) => {
        let worker: Worker
        try {
          worker = new Worker(entry, { workerData: options })
        } catch {
          // A thread that could never start leaves its share to the others, and
          // whatever nobody reaches is swept up below.
          resolve()
          return
        }

        // The page this worker is currently holding, so that a thread which
        // dies mid-page is recorded against the page that killed it.
        let inFlight: number | undefined
        // Pages this worker has actually reported on. A thread that dies having
        // reported none never worked at all, which says something about the
        // thread rather than about the page it happened to be holding.
        let completed = 0

        // Armed while a page is out with this worker, cleared when it replies.
        let watchdog: NodeJS.Timeout | undefined
        const disarm = (): void => {
          if (watchdog !== undefined) clearTimeout(watchdog)
          watchdog = undefined
        }

        const finish = (): void => {
          disarm()
          void worker.terminate()
          resolve()
        }

        const feed = (): void => {
          const index = next
          if (index >= pages.length) {
            inFlight = undefined
            finish()
            return
          }
          next += 1
          inFlight = index
          worker.postMessage(pages[index])

          // The hard ceiling. A thread wedged in synchronous work answers
          // nothing and runs no timer of its own, so the only move left is to
          // kill it — and the page it was holding is recorded as unaudited
          // rather than left to look clean. The worker is not replaced: the
          // others keep draining the queue, and anything they never reach is
          // swept up below.
          watchdog = setTimeout(() => {
            watchdog = undefined
            if (inFlight !== undefined) {
              audits[inFlight] = failedPage(
                identity(pages[inFlight] as CollectedPage, options),
                `the audit worker was stopped after ${deadlineMs}ms on this page`,
              )
              inFlight = undefined
            }
            finish()
          }, deadlineMs)
          // A run whose pages all answer quickly should not be held open by the
          // timer that is waiting to prove they did not.
          watchdog.unref?.()
        }

        worker.on('message', (audit: PageAudit) => {
          disarm()
          if (inFlight !== undefined) {
            audits[inFlight] = audit
            completed += 1
          }
          feed()
        })

        // Reached when the thread itself dies. Two very different things look
        // the same here, and blaming the page for both would be wrong:
        //
        // A worker that has already reported on pages and then dies was most
        // likely killed by the page it was holding — running out of memory on a
        // pathological document is the realistic cause — so that page is
        // recorded as unaudited, which the CLI reports as a run that could not
        // finish rather than as a clean page.
        //
        // A worker that dies having reported nothing never worked at all: the
        // entry point is missing from the install, or unloadable on this
        // runtime. The page it was holding has nothing wrong with it, so it is
        // left for the sweep below to audit in this process. Threads that
        // cannot start are meant to make a run slower, not fail it.
        worker.on('error', (cause: Error) => {
          disarm()
          if (inFlight !== undefined && completed > 0) {
            audits[inFlight] = failedPage(
              identity(pages[inFlight] as CollectedPage, options),
              `audit worker failed: ${cause.message}`,
            )
          }
          finish()
        })

        feed()
      })
    }),
  )

  // Anything no worker produced: pages they never reached, and pages held by a
  // worker that turned out never to have worked. A page a worker actually died
  // on is not here — it carries its own error, and handing it to this process
  // would just repeat whatever killed the thread.
  const missing = audits.flatMap((audit, index) => (audit ? [] : [index]))
  if (missing.length > 0) {
    const swept = await auditHere(
      missing.map((index) => pages[index] as CollectedPage),
      options,
    )
    for (const [position, index] of missing.entries()) {
      audits[index] = swept[position] as PageAudit
    }
  }

  return audits.map(
    (audit, index) =>
      audit ??
      failedPage(
        identity(pages[index] as CollectedPage, options),
        'the audit worker holding this page stopped before it reported',
      ),
  )
}

function identity(
  page: CollectedPage,
  options: JsdomRunnerOptions,
): Parameters<typeof failedPage>[0] {
  return {
    relativePath: page.relativePath,
    absolutePath: page.absolutePath,
    url: pageUrl(page, options.baseUrl),
    engine: 'jsdom',
    durationMs: 0,
  }
}

/**
 * Locate the worker entry point.
 *
 * It is a file on disk, so it has to be found at runtime, and the layout
 * differs between running from source and running the bundle — where this
 * module is inlined into a chunk at the root of dist/ and the worker is a
 * separate entry. The candidates are tried in order rather than assuming one,
 * the same way the statement templates are found.
 */
export async function findWorkerEntry(): Promise<URL | undefined> {
  const candidates = [
    new URL('./worker.ts', import.meta.url), // src/audit/runners/ during development
    new URL('./audit/runners/worker.js', import.meta.url), // a chunk at dist/
    new URL('../audit/runners/worker.js', import.meta.url), // a chunk at dist/cli/
    new URL('./worker.js', import.meta.url), // a build that keeps the layout
  ]

  for (const candidate of candidates) {
    if (await isFile(candidate)) return candidate
  }
  return undefined
}
