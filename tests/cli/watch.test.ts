import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type AuditRun, type Watch, watchAudit } from '../../src/cli/watch.ts'

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

async function directory(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-watch-'))
  dirs.push(dir)
  return dir
}

/** A watcher the test fires by hand, instead of waiting on the filesystem. */
function fakeWatch(): {
  watch: Watch
  change: (file: string | null) => void
  closed: () => boolean
} {
  let listener: ((file: string | null) => void) | undefined
  let isClosed = false
  return {
    watch: (_directory, onChange) => {
      listener = onChange
      return {
        close: () => {
          isClosed = true
        },
      }
    },
    change: (file) => listener?.(file),
    closed: () => isClosed,
  }
}

const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))

describe('audit --watch', () => {
  it('runs once, then again on a change, pointed at the directory it found', async () => {
    const dir = await directory()
    const calls: Array<string | undefined> = []
    const run = async (given: string | undefined): Promise<AuditRun> => {
      calls.push(given)
      return { exitCode: 1, directory: dir }
    }
    const fake = fakeWatch()
    const controller = new AbortController()

    const done = watchAudit({
      run,
      directory: undefined,
      cwd: dir,
      debounceMs: 5,
      signal: controller.signal,
      watch: fake.watch,
    })
    await settle()
    fake.change('index.html')
    await settle()
    controller.abort()

    // Auto-detection happens once. Every later run is told the directory, so
    // a detection that would run the build never writes into what is watched.
    expect(calls).toEqual([undefined, dir])
    // A watch shows results; failing a build is the one-shot run's job.
    expect(await done).toBe(0)
    expect(fake.closed()).toBe(true)
  })

  it('folds a burst of changes into one run', async () => {
    const dir = await directory()
    let runs = 0
    const fake = fakeWatch()
    const controller = new AbortController()

    const done = watchAudit({
      run: async () => {
        runs += 1
        return { exitCode: 0, directory: dir }
      },
      directory: dir,
      cwd: dir,
      debounceMs: 10,
      signal: controller.signal,
      watch: fake.watch,
    })
    await settle()
    for (const file of ['a.html', 'b.html', 'c.html']) fake.change(file)
    await settle(50)
    controller.abort()
    await done

    expect(runs).toBe(2)
  })

  it('runs again after a change that arrives mid-run, rather than dropping it', async () => {
    const dir = await directory()
    let runs = 0
    let release: (() => void) | undefined
    const fake = fakeWatch()
    const controller = new AbortController()

    const done = watchAudit({
      run: async () => {
        runs += 1
        // The second run is held open until the test lets it go.
        if (runs === 2) {
          await new Promise<void>((resolve) => {
            release = resolve
          })
        }
        return { exitCode: 0, directory: dir }
      },
      directory: dir,
      cwd: dir,
      debounceMs: 5,
      signal: controller.signal,
      watch: fake.watch,
    })
    await settle()
    fake.change('index.html')
    await settle()
    expect(runs).toBe(2)

    fake.change('about.html')
    release?.()
    await settle()
    controller.abort()
    await done

    expect(runs).toBe(3)
  })

  it('does not react to what a run writes itself', async () => {
    const dir = await directory()
    let runs = 0
    const fake = fakeWatch()
    const controller = new AbortController()

    const done = watchAudit({
      run: async () => {
        runs += 1
        return { exitCode: 0, directory: dir }
      },
      directory: dir,
      cwd: dir,
      ignore: ['.eaa-kit', 'report.html'],
      debounceMs: 5,
      signal: controller.signal,
      watch: fake.watch,
    })
    await settle()
    fake.change(path.join('.eaa-kit', 'cache', 'pages.json'))
    fake.change('report.html')
    await settle()
    controller.abort()
    await done

    expect(runs).toBe(1)
  })

  it('refuses when the run read no directory and none was named', async () => {
    const fake = fakeWatch()

    const code = await watchAudit({
      run: async () => ({ exitCode: 2 }),
      directory: undefined,
      cwd: process.cwd(),
      signal: new AbortController().signal,
      watch: fake.watch,
    })

    expect(code).toBe(2)
    expect(stderr.join('')).toContain('--watch needs a build directory')
  })

  it('waits for a named directory that does not exist yet', async () => {
    const parent = await directory()
    const missing = path.join(parent, 'dist')
    let runs = 0
    const fake = fakeWatch()
    const controller = new AbortController()

    const done = watchAudit({
      run: async () => {
        runs += 1
        return { exitCode: 2 }
      },
      directory: missing,
      cwd: parent,
      debounceMs: 5,
      pollMs: 10,
      signal: controller.signal,
      watch: fake.watch,
    })
    await settle()
    expect(runs).toBe(1)

    const { mkdir } = await import('node:fs/promises')
    await mkdir(missing)
    await settle(60)
    controller.abort()
    await done

    // The build that created it is the change worth auditing.
    expect(runs).toBe(2)
  })
})
