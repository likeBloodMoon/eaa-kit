import { type FSWatcher, watch as fsWatch } from 'node:fs'
import path from 'node:path'
import pc from 'picocolors'
import { isDirectory } from '../fs.ts'
import { note, warn } from './command.ts'

/**
 * `eaa-kit audit --watch`.
 *
 * A run over a build where nothing changed costs about what starting the
 * process costs, because the page cache reuses every result and never loads an
 * engine. That makes the run worth repeating on every save, and this repeats
 * it: when anything in the build directory changes, the audit runs again, and
 * only the pages whose markup changed are audited again.
 *
 * Three refusals, from the roadmap:
 *
 * - Directories only. A running site changes without writing anything this
 *   process can see, and a watch over one would really be a poll. The command
 *   refuses `--url` before this is reached.
 * - No verdict on the way out. A watch shows results. Failing a build is the
 *   one-shot run's job, so a watch that ends because somebody pressed Ctrl-C
 *   exits 0 whatever the last run found.
 * - Never skip a run because one is already going. A change that lands during
 *   a run starts another run as soon as it finishes. Otherwise the report on
 *   screen would describe a build that the files on disk have already
 *   replaced.
 */

export interface AuditRun {
  exitCode: number
  directory?: string
}

/** The part of `fs.watch` this uses, so a test can hand in its own. */
export type Watch = (
  directory: string,
  onChange: (file: string | null) => void,
  onError: (error: Error) => void,
) => { close: () => void }

export interface WatchAuditOptions {
  /** One audit of `directory`, or of whatever auto-detection finds when it is undefined. */
  run: (directory: string | undefined) => Promise<AuditRun>
  /** The directory asked for, if one was. */
  directory: string | undefined
  cwd: string
  /**
   * Paths under the watched directory that a run writes itself: the report
   * under `--output`, and the page cache. A change there is the watch seeing
   * its own output, and reacting to it would run for ever.
   */
  ignore?: readonly string[]
  /** How long to wait for a build to stop writing before auditing it. */
  debounceMs?: number
  /** How often to look for a directory that is not there yet. */
  pollMs?: number
  /** Ends the watch. Defaults to SIGINT and SIGTERM. */
  signal?: AbortSignal
  watch?: Watch
}

const DEFAULT_DEBOUNCE_MS = 150
const DEFAULT_POLL_MS = 1000

/**
 * Run, then run again on every change, until the signal fires.
 *
 * Resolves with 0 once the watch is ended, or with 2 when there is nothing it
 * could watch: a run that found its pages over HTTP, or found none at all with
 * no directory named to wait for.
 */
export async function watchAudit(options: WatchAuditOptions): Promise<number> {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS
  const watch = options.watch ?? nodeWatch
  const { signal, dispose } = stopSignal(options.signal)

  const first = await options.run(options.directory)

  // The directory the first run actually read is the one to watch, and the one
  // every later run is pointed at. Pointing them at it rather than repeating
  // auto-detection matters: detection may run the project's build, and a build
  // writes into the directory being watched.
  const found = first.directory ?? options.directory
  if (found === undefined) {
    dispose()
    warn(
      '--watch needs a build directory to watch, and this run did not read one. ' +
        'Name the directory, e.g. eaa-kit audit ./dist --watch.',
    )
    return 2
  }
  const target = path.resolve(options.cwd, found)
  const ignored = (options.ignore ?? []).map((entry) => path.resolve(options.cwd, entry))

  let running: Promise<void> | undefined
  let pending = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let watcher: { close: () => void } | undefined
  let poller: ReturnType<typeof setInterval> | undefined

  const runAgain = async (): Promise<void> => {
    do {
      pending = false
      process.stderr.write(`\n${pc.dim(`─── ${new Date().toLocaleTimeString()} ───`)}\n`)
      await options.run(found)
    } while (pending && !signal.aborted)
    running = undefined
    if (!signal.aborted) waiting()
  }

  const schedule = (): void => {
    if (signal.aborted) return
    if (running !== undefined) {
      pending = true
      return
    }
    clearTimeout(timer)
    timer = setTimeout(() => {
      running = runAgain()
    }, debounceMs)
  }

  const isIgnored = (file: string | null): boolean => {
    if (file === null) return false
    const absolute = path.resolve(target, file)
    return ignored.some((entry) => absolute === entry || absolute.startsWith(`${entry}${path.sep}`))
  }

  const arm = async (): Promise<void> => {
    if (signal.aborted) return
    if (!(await isDirectory(target))) {
      // Not there yet, or removed by a build that empties its output by
      // deleting it. Wait for it rather than giving up: `vite build` in another
      // terminal is the whole reason somebody runs a watch.
      poller ??= setInterval(() => {
        void isDirectory(target).then((present) => {
          if (!present || signal.aborted) return
          clearInterval(poller)
          poller = undefined
          void arm()
          schedule()
        })
      }, pollMs)
      return
    }
    watcher = watch(
      target,
      (file) => {
        if (!isIgnored(file)) schedule()
      },
      () => {
        watcher?.close()
        watcher = undefined
        void arm()
      },
    )
  }

  const waiting = (): void => {
    note(`Watching ${path.relative(options.cwd, target) || '.'} for changes. Ctrl-C to stop.`)
  }

  await arm()
  waiting()

  await new Promise<void>((resolve) => {
    if (signal.aborted) resolve()
    else signal.addEventListener('abort', () => resolve(), { once: true })
  })

  clearTimeout(timer)
  clearInterval(poller)
  watcher?.close()
  dispose()
  // A run in progress finishes rather than being abandoned halfway through a
  // write to the cache or to --output.
  await running
  return 0
}

/** Recursive `fs.watch`, which Node supports on every platform this tool does. */
function nodeWatch(
  directory: string,
  onChange: (file: string | null) => void,
  onError: (error: Error) => void,
): { close: () => void } {
  const watcher: FSWatcher = fsWatch(directory, { recursive: true }, (_event, file) =>
    onChange(file === null ? null : String(file)),
  )
  watcher.on('error', onError)
  return watcher
}

/** The caller's signal, or one that Ctrl-C and SIGTERM fire. */
function stopSignal(given: AbortSignal | undefined): {
  signal: AbortSignal
  dispose: () => void
} {
  if (given !== undefined) return { signal: given, dispose: () => {} }

  const controller = new AbortController()
  const stop = (): void => controller.abort()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  return {
    signal: controller.signal,
    dispose: () => {
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
    },
  }
}
