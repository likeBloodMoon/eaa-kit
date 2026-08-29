import { describe, expect, it } from 'vitest'
import { MANUAL_CHECKS, manualCheckFor, understandingUrl } from '../../src/audit/manual.ts'
import { ENGINE_BLIND_RULES } from '../../src/audit/runners/jsdom.ts'

describe('manual checks', () => {
  it('has one for every rule this engine cannot evaluate', () => {
    // The whole point: a reader told a rule "could not be evaluated" is left
    // knowing there is a gap and not what to do about it.
    const missing = Object.keys(ENGINE_BLIND_RULES).filter((rule) => !(rule in MANUAL_CHECKS))

    expect(missing).toEqual([])
  })

  it('writes each as an action, not a restatement of the criterion', () => {
    // "Ensure sufficient contrast" tells somebody nothing they did not know.
    for (const [rule, { check }] of Object.entries(MANUAL_CHECKS)) {
      expect(check.length, rule).toBeGreaterThan(40)
      expect(check, rule).not.toMatch(/^Ensure |^Make sure /)
    }
  })

  it('says which checks a browser run would answer instead', () => {
    // color-contrast is measurable by machine given a rendered page; autoplay
    // audio is a person listening.
    expect(manualCheckFor('color-contrast')?.browserAnswers).toBe(true)
    expect(manualCheckFor('no-autoplay-audio')?.browserAnswers).toBe(false)
  })

  it('has nothing to say about a rule that needs no manual check', () => {
    expect(manualCheckFor('image-alt')).toBeUndefined()
  })
})

describe('understandingUrl', () => {
  it.each([
    ['1.4.3', 'contrast-minimum'],
    ['2.5.8', 'target-size-minimum'],
    ['1.1.1', 'non-text-content'],
    ['4.1.2', 'name-role-value'],
  ])('maps %s to the Understanding page for %s', (criterion, slug) => {
    expect(understandingUrl(criterion)).toBe(
      `https://www.w3.org/WAI/WCAG22/Understanding/${slug}.html`,
    )
  })

  it('covers every criterion the blind rules cite', () => {
    // A rule pointing at a criterion with no link leaves the reader to search
    // for it, which is the thing this is meant to save them.
    const cited = ['1.4.1', '1.4.2', '1.4.3', '1.4.12', '2.1.1', '2.1.3', '2.5.8', '1.3.1']
    const missing = cited.filter((c) => understandingUrl(c) === undefined && c !== '2.1.3')

    expect(missing).toEqual([])
  })

  it('returns nothing for a criterion it does not know', () => {
    // AAA criteria and anything invented: a wrong link is worse than none.
    expect(understandingUrl('9.9.9')).toBeUndefined()
  })
})
