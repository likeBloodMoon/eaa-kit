/**
 * Text this package writes: escaping, counting and the standards references
 * that appear in every report and in the statement.
 *
 * Both documents eaa-kit produces embed text it did not write: an issue
 * description from a config file, axe-core's help text, and — in the audit
 * report — the markup of the element that failed, which is by definition
 * arbitrary HTML from somebody's build. Getting the escaping wrong in the
 * report would mean a page that fails an accessibility audit for having a stray
 * `<script>` hands that script to whoever opens the report.
 */

/** For text nodes. Leaves quotes alone, which are fine between tags. */
export function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** For attribute values, where a quote would end the attribute. */
export function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** `plural(1, 'page')` is `page`, `plural(2, 'page')` is `pages`. */
export function plural(value: number, noun: string): string {
  return value === 1 ? noun : `${noun}s`
}

/** `count(2, 'page')` is `2 pages`. */
export function count(value: number, noun: string): string {
  return `${value} ${plural(value, noun)}`
}

/**
 * Element markup on one line, optionally bounded: one minified page must not be
 * able to fill a report or run past a terminal.
 */
export function collapse(html: string, max?: number): string {
  const flat = html.replace(/\s+/g, ' ').trim()
  if (max === undefined || flat.length <= max) return flat
  return `${flat.slice(0, max - 1)}…`
}

/** `WCAG 1.1.1, EN 301 549 9.1.1.1`, in that order, or an empty string. */
export function standardsReference(
  successCriteria: readonly string[],
  enClauses: readonly string[],
): string {
  return [
    ...successCriteria.map((criterion) => `WCAG ${criterion}`),
    ...enClauses.map((clause) => `EN 301 549 ${clause}`),
  ].join(', ')
}
