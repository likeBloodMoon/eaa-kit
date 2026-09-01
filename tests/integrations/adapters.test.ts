import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import eaaKitDocusaurus, { type PostBuildProps } from '../../src/docusaurus/index.ts'
import eaaKitEleventy, { type EleventyAfterEvent } from '../../src/eleventy/index.ts'
import { BuildAuditError } from '../../src/integration/run.ts'
import eaaKitNuxt, { type NuxtLike } from '../../src/nuxt/index.ts'
import EaaKitWebpackPlugin, { type CompilerLike } from '../../src/webpack/index.ts'

/**
 * Each adapter is a few lines over the same shared decision function, so what
 * is worth testing is not the audit — that is covered where it lives — but the
 * wiring: that the hook is registered under the name its host actually calls,
 * that the directory handed over is the one the build wrote, and that a failing
 * audit reaches the host as something that stops the build.
 */

const dirs: string[] = []

beforeEach(() => {
  // The audit writes its report to stdout and its progress to stderr. Neither
  // belongs in the test output; what these cases assert is the wiring.
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
})

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

/** A built site with one page, clean or not. */
async function built(clean: boolean): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-adapter-'))
  dirs.push(dir)
  await mkdir(path.join(dir, 'out'), { recursive: true })
  await writeFile(
    path.join(dir, 'out', 'index.html'),
    clean
      ? '<!doctype html><html lang="en"><head><title>ok</title></head><body><main><p>hi</p></main></body></html>'
      : '<!doctype html><html><head><title>bad</title></head><body><img src="/a.png"></body></html>',
  )
  return path.join(dir, 'out')
}

describe('the Eleventy plugin', () => {
  /** Stands in for eleventyConfig, recording what the plugin registered. */
  function config(): {
    handlers: Map<string, (event: EleventyAfterEvent) => Promise<void>>
    on: (event: 'eleventy.after', handler: (event: EleventyAfterEvent) => Promise<void>) => void
  } {
    const handlers = new Map<string, (event: EleventyAfterEvent) => Promise<void>>()
    return { handlers, on: (event, handler) => void handlers.set(event, handler) }
  }

  it('registers on the hook Eleventy fires once the files are written', () => {
    const eleventyConfig = config()

    eaaKitEleventy(eleventyConfig)

    expect([...eleventyConfig.handlers.keys()]).toEqual(['eleventy.after'])
  })

  it('audits the output directory Eleventy reports, which is configurable', async () => {
    const output = await built(true)
    const eleventyConfig = config()
    eaaKitEleventy(eleventyConfig)

    await expect(
      eleventyConfig.handlers.get('eleventy.after')?.({ dir: { input: '.', output } }),
    ).resolves.toBeUndefined()
  }, 60_000)

  it('fails the build on a violation at or above the threshold', async () => {
    const output = await built(false)
    const eleventyConfig = config()
    eaaKitEleventy(eleventyConfig, { failOn: 'critical' })

    await expect(
      eleventyConfig.handlers.get('eleventy.after')?.({ dir: { input: '.', output } }),
    ).rejects.toThrow(BuildAuditError)
  }, 60_000)
})

describe('the Docusaurus plugin', () => {
  it('is a plugin with the postBuild lifecycle Docusaurus calls', () => {
    const plugin = eaaKitDocusaurus({})

    expect(plugin.name).toBe('eaa-kit')
    expect(typeof plugin.postBuild).toBe('function')
  })

  it('audits outDir, which Docusaurus hands over rather than leaving to a guess', async () => {
    const outDir = await built(true)

    await expect(
      eaaKitDocusaurus({}).postBuild({ outDir } as PostBuildProps),
    ).resolves.toBeUndefined()
  }, 60_000)

  it('fails the build on a violation at or above the threshold', async () => {
    const outDir = await built(false)

    await expect(
      eaaKitDocusaurus({}, { failOn: 'critical' }).postBuild({ outDir } as PostBuildProps),
    ).rejects.toThrow(BuildAuditError)
  }, 60_000)
})

describe('the webpack plugin', () => {
  function compiler(output: string | undefined, overrides: Partial<CompilerLike> = {}) {
    const tapped: Array<(compilation: { errors: readonly unknown[] }) => Promise<void>> = []
    const instance = {
      options: { output: output === undefined ? {} : { path: output } },
      hooks: {
        afterEmit: {
          tapPromise: (
            _name: string,
            handler: (c: { errors: readonly unknown[] }) => Promise<void>,
          ) => void tapped.push(handler),
        },
      },
      ...overrides,
    } as CompilerLike
    return { instance, run: async () => tapped[0]?.({ errors: [] }), tapped }
  }

  it('taps afterEmit, the first hook at which every file is on disk', async () => {
    const output = await built(true)
    const { instance, tapped } = compiler(output)

    new EaaKitWebpackPlugin().apply(instance)

    expect(tapped).toHaveLength(1)
  })

  it('audits webpack own output.path', async () => {
    const output = await built(true)
    const { instance, run } = compiler(output)
    new EaaKitWebpackPlugin().apply(instance)

    await expect(run()).resolves.toBeUndefined()
  }, 60_000)

  it('leaves watch rebuilds alone', async () => {
    // Auditing a whole site on every save would make a dev server unusable, and
    // a failing audit there cannot stop anything being shipped anyway.
    const output = await built(false)
    const { instance, run } = compiler(output, { watchMode: true })
    new EaaKitWebpackPlugin({ failOn: 'critical' }).apply(instance)

    await expect(run()).resolves.toBeUndefined()
  }, 60_000)

  it('does not report a failed build as accessibility findings', async () => {
    // A build that failed has no output worth judging; reporting missing pages
    // as violations would send somebody after defects nothing measured.
    const output = await built(false)
    const { instance } = compiler(output)
    const tapped: Array<(c: { errors: readonly unknown[] }) => Promise<void>> = []
    instance.hooks.afterEmit.tapPromise = (_name, handler) => void tapped.push(handler)
    new EaaKitWebpackPlugin({ failOn: 'critical' }).apply(instance)

    await expect(tapped[0]?.({ errors: ['boom'] })).resolves.toBeUndefined()
  }, 60_000)

  it('says so rather than guessing when webpack has no output path', async () => {
    const { instance, run } = compiler(undefined)
    new EaaKitWebpackPlugin().apply(instance)

    await expect(run()).rejects.toThrow(/no output.path/)
  })
})

describe('the Nuxt module', () => {
  function nuxt(publicDir: string | undefined, rootDir?: string) {
    const handlers = new Map<string, () => Promise<void>>()
    const instance: NuxtLike = {
      options: {
        ...(rootDir === undefined ? {} : { rootDir }),
        nitro: publicDir === undefined ? {} : { output: { publicDir } },
      },
      hook: (name, handler) => void handlers.set(name, handler),
    }
    return { instance, run: async () => handlers.get('close')?.(), handlers }
  }

  it('registers on close, not on Vite finishing', async () => {
    // Nuxt prerenders with Nitro after Vite is done, so a Vite hook would audit
    // the build before the pages it exists to read had been written.
    const output = await built(true)
    const { instance, handlers } = nuxt(output)

    eaaKitModuleUnderTest(instance)

    expect([...handlers.keys()]).toEqual(['close'])
  })

  function eaaKitModuleUnderTest(instance: NuxtLike, options = {}): void {
    eaaKitNuxt(options, instance)
  }

  it('audits what Nitro says it wrote', async () => {
    const output = await built(true)
    const { instance, run } = nuxt(output)
    eaaKitModuleUnderTest(instance)

    await expect(run()).resolves.toBeUndefined()
  }, 60_000)

  it('refuses to pass a server build that prerendered nothing', async () => {
    // `nuxt build` writes a server, not browsable HTML. Auditing nothing and
    // reporting success is the worst outcome available here.
    const { instance, run } = nuxt(undefined)
    eaaKitModuleUnderTest(instance)

    await expect(run()).rejects.toThrow(/nothing to audit/)
  })

  it('can be told a server build is expected', async () => {
    const { instance, run } = nuxt(undefined)
    eaaKitModuleUnderTest(instance, { allowServerBuild: true })

    await expect(run()).resolves.toBeUndefined()
  })

  it('does nothing when called without a Nuxt instance', () => {
    expect(() => eaaKitNuxt({})).not.toThrow()
  })
})
