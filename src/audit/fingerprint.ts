import { createHash } from 'node:crypto'

/**
 * A stable identity for one violating element.
 *
 * Derived from the rule, the selector and the element's own opening tag, and
 * deliberately not from the file it was found in. Two consumers need this and
 * they need it to agree: SARIF, so that moving a page does not close one code
 * scanning alert and open an identical one, and the baseline, so that an
 * accepted violation stays accepted when the surrounding page changes.
 *
 * Sixteen hex characters. This identifies a defect for humans and tooling, not
 * a secret, and a full digest in every entry would make a baseline file for a
 * large site unreadable.
 */
export function elementFingerprint(ruleId: string, selector: string, html: string): string {
  return createHash('sha256')
    .update(`${ruleId}\n${selector}\n${openingTag(html)}`)
    .digest('hex')
    .slice(0, 16)
}

/**
 * The element's own tag, without anything nested inside it.
 *
 * axe-core hands back the failing element's outerHTML, which for a leaf like
 * `<img>` is the element and for a container is the element and every
 * descendant it has. Hashing all of that made the identity of a container
 * depend on its contents — and the container that matters here is `<html>`,
 * which every document-level rule fails against: `html-has-lang`,
 * `document-title`, `landmark-one-main`, `page-has-heading-one`.
 *
 * Their outerHTML is the whole page. So adding one paragraph anywhere changed
 * the fingerprint of every document-level violation on that page, and all three
 * consumers believed it:
 *
 * - the baseline stopped suppressing barriers it had accepted, and the build
 *   went red on a page whose only change was a typo fix;
 * - `diff` reported the same untouched barrier as both new and **fixed**, which
 *   is the one thing it exists to refuse to do;
 * - SARIF churned its partialFingerprints, so code scanning closed an alert and
 *   opened an identical one on every edit.
 *
 * The identity of an element is its own tag and attributes. Where two elements
 * share those, axe-core's selector already tells them apart — it qualifies
 * ambiguous matches with `:nth-child(…)` — so nothing that was distinguishable
 * before stops being distinguishable now.
 *
 * Anything that is not an element — the empty string a rule with no attached
 * node carries — is returned unchanged, so those keep the identity they had.
 */
export function openingTag(html: string): string {
  const trimmed = html.trim()
  if (!trimmed.startsWith('<')) return trimmed

  // Attribute values may contain `>`, so the scan tracks quoting rather than
  // taking the first one it sees: `<a title="a > b">` is one tag, not two.
  let quote: '"' | "'" | undefined
  for (let i = 1; i < trimmed.length; i += 1) {
    const char = trimmed[i]
    if (quote !== undefined) {
      if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '>') return trimmed.slice(0, i + 1)
  }

  // No closing `>` at all: markup this malformed has no tag to take, so it is
  // hashed as it came rather than silently becoming something else.
  return trimmed
}
