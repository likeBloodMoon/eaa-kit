import { describe, expect, it } from 'vitest'
import {
  overlaidRules,
  remediatedRules,
  remediationFor,
  remediationFrameworks,
} from '../../src/audit/remediation.ts'

describe('remediationFor', () => {
  it('says who a barrier stops, not just what the rule is called', () => {
    // axe-core's help text already says "images must have alternative text".
    // Repeating it would be a second copy of the thing that was not enough.
    const remediation = remediationFor('image-alt')

    expect(remediation?.why).toContain('screen reader')
    expect(remediation?.why).not.toContain('must have alternative text')
  })

  it('corrects the markup that actually failed rather than showing a textbook line', () => {
    const remediation = remediationFor('image-alt')

    expect(remediation?.example?.('<img src="/assets/logo.svg">')).toBe(
      '<img src="/assets/logo.svg" alt="What this image shows">',
    )
  })

  it('replaces an attribute that is there rather than adding a second one', () => {
    const fixed = remediationFor('html-has-lang')?.example?.('<html lang="">')

    expect(fixed).toBe('<html lang="de">')
    expect(fixed?.match(/lang=/g)).toHaveLength(1)
  })

  it('keeps a self-closing tag self-closing', () => {
    expect(remediationFor('image-alt')?.example?.('<img src="/a.png" />')).toBe(
      '<img src="/a.png" alt="What this image shows" />',
    )
  })

  it('puts content inside an element that has none', () => {
    expect(remediationFor('link-name')?.example?.('<a href="/about/"></a>')).toBe(
      '<a href="/about/">Where this link goes</a>',
    )
  })

  it('returns nothing rather than guessing at markup it cannot parse', () => {
    expect(remediationFor('image-alt')?.example?.('not markup at all')).toBeUndefined()
  })

  it('gives the framework-specific fix where one exists', () => {
    const generic = remediationFor('html-has-lang')
    const astro = remediationFor('html-has-lang', 'astro')

    expect(astro?.fix).toContain('src/layouts')
    expect(astro?.fix).not.toBe(generic?.fix)
  })

  it('inherits everything the overlay does not restate', () => {
    // An overlay that replaced the entry outright would silently drop the
    // corrected snippet and the sentence about who is shut out, neither of
    // which changes with the framework.
    const generic = remediationFor('html-has-lang')
    const astro = remediationFor('html-has-lang', 'astro')

    expect(astro?.why).toBe(generic?.why)
    expect(astro?.example?.('<html>')).toBe('<html lang="de">')
  })

  it('falls back to the generic fix for a framework with no overlay', () => {
    expect(remediationFor('image-alt', 'eleventy')?.fix).toBe(remediationFor('image-alt')?.fix)
    expect(remediationFor('image-alt', 'not-a-framework')).toBeDefined()
  })

  it('has nothing to say about a rule it does not cover, rather than something vague', () => {
    expect(remediationFor('definitely-not-a-rule')).toBeUndefined()
  })
})

describe('the remediation table', () => {
  it('covers the rules that actually fire on real sites', () => {
    const rules = remediatedRules()

    for (const rule of ['image-alt', 'link-name', 'button-name', 'html-has-lang', 'label']) {
      expect(rules, rule).toContain(rule)
    }
  })

  it('gives every entry both a reason and a fix', () => {
    for (const rule of remediatedRules()) {
      const remediation = remediationFor(rule)
      expect(remediation?.why, rule).toBeTruthy()
      expect(remediation?.fix, rule).toBeTruthy()
    }
  })

  it('never overlays a rule that has no generic entry to merge onto', () => {
    // Such an overlay would produce advice for some projects and silence for
    // every other, which is worse than having neither.
    const generic = new Set(remediatedRules())

    for (const [framework, rules] of Object.entries(overlaidRules())) {
      for (const rule of rules) {
        expect(generic.has(rule), `${framework}/${rule}`).toBe(true)
      }
    }
  })

  it('overlays only frameworks the registry can actually detect', async () => {
    const { FRAMEWORKS } = await import('../../src/audit/frameworks.ts')
    const known = new Set(FRAMEWORKS.map((framework) => framework.id))

    for (const framework of remediationFrameworks()) {
      expect(known.has(framework), framework).toBe(true)
    }
  })

  it('states a real difference in every overlay rather than restating the generic fix', () => {
    for (const [framework, rules] of Object.entries(overlaidRules())) {
      for (const rule of rules) {
        expect(remediationFor(rule, framework)?.fix, `${framework}/${rule}`).not.toBe(
          remediationFor(rule)?.fix,
        )
      }
    }
  })
})
