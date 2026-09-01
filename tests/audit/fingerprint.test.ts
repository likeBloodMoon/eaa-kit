import { describe, expect, it } from 'vitest'
import { elementFingerprint, openingTag } from '../../src/audit/fingerprint.ts'

/**
 * The identity of a violating element, and the one property everything built on
 * it needs: it must not move when the page around the element does.
 *
 * The baseline, `diff` and SARIF all key off this. When it was the element's
 * whole outerHTML, the document-level rules — whose element is `<html>` and
 * whose outerHTML is therefore the entire page — changed identity on every
 * edit, and all three consumers reported nonsense as a result.
 */

describe('openingTag', () => {
  it('takes the element and leaves its descendants out', () => {
    expect(openingTag('<a href="/x"><img src="1.png"></a>')).toBe('<a href="/x">')
  })

  it('keeps a leaf element whole, because it has no descendants to drop', () => {
    expect(openingTag('<img src="/logo.svg">')).toBe('<img src="/logo.svg">')
  })

  it('does not stop at a > inside an attribute value', () => {
    expect(openingTag(`<a title="a > b" href="/x">go</a>`)).toBe(`<a title="a > b" href="/x">`)
    expect(openingTag(`<a title='a > b'>go</a>`)).toBe(`<a title='a > b'>`)
  })

  it('leaves markup with no closing bracket as it found it', () => {
    // Nothing to take, and inventing a tag here would give two different
    // fragments the same identity.
    expect(openingTag('<img src="/a.png"')).toBe('<img src="/a.png"')
  })

  it('passes through what is not an element', () => {
    // The empty string is the identity a rule that failed with no attached node
    // carries, and the baseline writes an entry against exactly that.
    expect(openingTag('')).toBe('')
    expect(openingTag('   ')).toBe('')
    expect(openingTag('bare text')).toBe('bare text')
  })
})

describe('elementFingerprint', () => {
  it('is stable for the same element', () => {
    expect(elementFingerprint('image-alt', 'img', '<img>')).toBe(
      elementFingerprint('image-alt', 'img', '<img>'),
    )
  })

  it('changes when the rule, the selector or the element itself changes', () => {
    const base = elementFingerprint('image-alt', 'img', '<img>')

    expect(elementFingerprint('link-name', 'img', '<img>')).not.toBe(base)
    expect(elementFingerprint('image-alt', 'img.x', '<img>')).not.toBe(base)
    expect(elementFingerprint('image-alt', 'img', '<img alt="">')).not.toBe(base)
  })

  it('does not move when the page inside a document-level element changes', () => {
    // The regression this exists for. `html-has-lang` fails against `<html>`,
    // so its outerHTML is the whole document: hashing that made adding one
    // paragraph anywhere look like a different barrier, which the baseline
    // stopped suppressing and `diff` reported as both new and fixed.
    const before = elementFingerprint(
      'html-has-lang',
      'html',
      '<html><head><title></title></head><body><h1>Kontakt</h1></body></html>',
    )
    const after = elementFingerprint(
      'html-has-lang',
      'html',
      '<html><head><title></title></head><body><h1>Kontakt</h1><p>New.</p></body></html>',
    )

    expect(after).toBe(before)
  })

  it('still moves when the document element itself is fixed', () => {
    // The other half: a barrier that was actually addressed has to change
    // identity, or `diff` could never report anything as fixed.
    const broken = elementFingerprint('html-has-lang', 'html', '<html><head></head></html>')
    const fixed = elementFingerprint(
      'html-has-lang',
      'html',
      '<html lang="de"><head></head></html>',
    )

    expect(fixed).not.toBe(broken)
  })

  it('tells two containers apart by the selector axe-core gives them', () => {
    // Dropping the descendants costs nothing here: axe-core qualifies an
    // ambiguous match with :nth-child(…), so the two links stay distinct.
    const first = elementFingerprint('link-name', 'a:nth-child(1)', '<a href="/x"><img></a>')
    const second = elementFingerprint('link-name', 'a:nth-child(2)', '<a href="/x"><img></a>')

    expect(first).not.toBe(second)
  })
})
