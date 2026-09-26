/**
 * Whether a page is an empty shell that a script fills in.
 *
 * A single-page app's build writes one `index.html` holding an empty
 * `<div id="root">` and a script tag. The browserless engine does not run
 * scripts, so it audits the empty div, finds nothing wrong with it, and the
 * run reports a clean site that was never looked at. That is the false
 * assurance this tool exists to refuse, so such a page is set aside and named
 * as not audited instead.
 *
 * The test is what a visitor could perceive before any script runs: text,
 * images and media, embedded frames, and form controls. A page with none of
 * those is a shell, whatever its root element is called.
 */
export function isAppShell(html: string): boolean {
  const body =
    /<body\b[^>]*>([\s\S]*)<\/body\s*>/i.exec(html)?.[1] ??
    html.replace(/<head\b[\s\S]*?<\/head\s*>/i, '')
  const visible = body
    .replace(/<!--[\s\S]*?-->/g, '')
    // Never shown as they are, and a noscript apology is not the page either.
    .replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, '')
  if (
    /<(img|svg|video|audio|canvas|iframe|object|embed|input|select|textarea|button|picture)\b/i.test(
      visible,
    )
  ) {
    return false
  }
  const text = visible
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;/g, ' ')
    .trim()
  return text === ''
}
