import { createHash } from 'node:crypto'

/**
 * A stable identity for one violating element.
 *
 * Derived from the rule, the selector and the element's own markup, and
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
  return createHash('sha256').update(`${ruleId}\n${selector}\n${html}`).digest('hex').slice(0, 16)
}
