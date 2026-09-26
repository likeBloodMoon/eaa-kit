import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { detectProject } from '../../src/audit/detect.ts'

/**
 * The gate for detection: one fixture per stack, each the file layout of a real
 * project of that kind, and the answer `eaa-kit detect --json` must give for
 * it, recorded next to it in expected.json.
 *
 * Each is copied somewhere empty first. Inside this repository, a fixture
 * without a lockfile would find this repository's own and call itself pnpm.
 *
 * `UPDATE_STACKS=1 pnpm vitest run tests/audit/detect.test.ts` rewrites the
 * expected answers, which then have to be read and believed before committing.
 */

const STACKS = fileURLToPath(new URL('../fixtures/stacks/', import.meta.url))
const scratch = await mkdtemp(path.join(tmpdir(), 'eaa-kit-stacks-'))

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true })
})

const stacks = (await readdir(STACKS, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

describe('eaa-kit detect, over every stack fixture', () => {
  it('has a fixture for every kind of project it claims to handle', () => {
    expect(stacks.length).toBeGreaterThanOrEqual(14)
  })

  it.each(stacks)('%s', async (stack) => {
    const copy = path.join(scratch, stack)
    await cp(path.join(STACKS, stack), copy, {
      recursive: true,
      filter: (source) => path.basename(source) !== 'expected.json',
    })

    const detected = JSON.parse(JSON.stringify(await detectProject(copy)))
    const expectedFile = path.join(STACKS, stack, 'expected.json')

    if (process.env['UPDATE_STACKS'] === '1') {
      await writeFile(expectedFile, `${JSON.stringify(detected, null, 2)}\n`)
    }
    expect(detected).toEqual(JSON.parse(await readFile(expectedFile, 'utf8')))
  })
})
