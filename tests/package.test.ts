import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

interface PackageJson {
  engines?: { node?: string }
  dependencies?: Record<string, string>
}

const own = require('../package.json') as PackageJson
const jsdom = require('jsdom/package.json') as PackageJson

describe('engines', () => {
  it('promises exactly the Node versions jsdom supports', () => {
    // 0.1.0 shipped `>=22.22.2`, which reads as "any Node from 22.22.2 up".
    // jsdom supports only the even-numbered release lines, so installing on
    // Node 23 or 25 warned about EBADENGINE naming jsdom — a dependency the
    // user never chose — instead of eaa-kit refusing the runtime itself.
    //
    // Equality rather than a subset check: jsdom is the narrowest runtime
    // dependency, so its range is the one we can honestly promise. If it moves,
    // this fails and somebody decides what to promise instead of finding out
    // from an npm warning after publishing.
    expect(own.engines?.node).toBe(jsdom.engines?.node)
  })

  it('still declares jsdom as a runtime dependency', () => {
    // The test above passes vacuously if both are undefined.
    expect(own.dependencies?.jsdom).toBeDefined()
    expect(jsdom.engines?.node).toBeTruthy()
  })
})
