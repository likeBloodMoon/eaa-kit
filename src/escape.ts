/**
 * HTML escaping, shared by everything in this package that writes HTML.
 *
 * Both documents eaa-kit produces embed text it did not write: an issue
 * description from a config file, axe-core's help text, and — in the audit
 * report — the markup of the element that failed, which is by definition
 * arbitrary HTML from somebody's build. Getting this wrong in the report would
 * mean a page that fails an accessibility audit for having a stray `<script>`
 * hands that script to whoever opens the report.
 */

/** For text nodes. Leaves quotes alone, which are fine between tags. */
export function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** For attribute values, where a quote would end the attribute. */
export function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
