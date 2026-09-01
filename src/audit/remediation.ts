/**
 * What to actually do about a finding.
 *
 * axe-core says what is wrong and links to a page explaining the rule. Neither
 * is the fix. "Images must have alternative text" tells somebody who already
 * knows that nothing they did not know, and the Deque page is a page — the gap
 * between a report and a corrected line of code is where an accessibility tool
 * either earns its place in a build or becomes something people mute.
 *
 * Three decisions hold this together.
 *
 * **Deterministic and offline.** No model, no API key, no network. This sits
 * next to a document with legal weight, and a plausible fix that is wrong is a
 * worse failure here than no fix at all: somebody would paste it, the report
 * would go green, and the barrier would still be there. A fixed table can be
 * reviewed once and then trusted; a generated one has to be reviewed every
 * time, by the person least equipped to.
 *
 * **The user's own markup, not a textbook example.** A generic snippet is a
 * second thing to translate. `fix` receives the element that actually failed,
 * so what comes back is the line as it should have been written.
 *
 * **A framework overlay only where the fix genuinely differs.** For most rules
 * it does not: a missing `alt` is a missing `alt` in all fourteen builders the
 * registry knows, and emitting fourteen near-identical snippets would be churn
 * pretending to be coverage. The real divergences are few and named below.
 */

export interface Remediation {
  /**
   * Who this stops, in one sentence. Not a restatement of the rule: somebody
   * deciding whether to fix this now needs to know who is shut out, and "images
   * must have alt text" does not say.
   */
  why: string
  /** What to change, in the imperative. */
  fix: string
  /**
   * The corrected markup, built from the element that failed. Absent where a
   * correction cannot be derived from the element alone — a missing `<main>`
   * is not a rewrite of anything.
   */
  example?: (html: string) => string | undefined
}

/**
 * Swap or add an attribute on the opening tag of the failing element.
 *
 * String surgery rather than a parser: the input is one element as axe-core
 * captured it, the output is shown to a person rather than written to disk, and
 * pulling in a parser to produce a suggestion would cost more than it is worth.
 */
function withAttribute(html: string, attribute: string, value: string): string | undefined {
  const openingTag = /^<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/.exec(html.trim())
  if (openingTag === null) return undefined

  const [, tag = '', raw = ''] = openingTag
  // The attribute group is greedy and swallows the slash of a self-closing tag,
  // so it is taken off here rather than matched separately — otherwise the new
  // attribute lands after it and the tag comes back as `<img / alt="…">`.
  const selfClosing = /\/\s*$/.test(raw) ? ' /' : ''
  const attributes = raw.replace(/\s*\/\s*$/, '')
  const existing = new RegExp(`\\s${attribute}\\s*=\\s*("[^"]*"|'[^']*')`, 'i')
  const replacement = `${attribute}="${value}"`

  const rewritten = existing.test(attributes)
    ? attributes.replace(existing, ` ${replacement}`)
    : `${attributes} ${replacement}`

  return `<${tag}${rewritten}${selfClosing}>`
}

/** Put text between the tags of an element that has none. */
function withContent(html: string, content: string): string | undefined {
  const opening = /^<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/.exec(html.trim())
  if (opening === null) return undefined
  const [matched, tag = ''] = opening
  return `${matched}${content}</${tag}>`
}

/**
 * The generic fix for a rule, whatever built the site.
 *
 * Scoped to the rules that actually fire on real sites. A table covering every
 * axe-core rule would be mostly entries nobody reads, and each one is a claim
 * this project has to keep true.
 */
const GENERIC: Readonly<Record<string, Remediation>> = {
  'image-alt': {
    why: 'A screen reader announces this image by its filename, or skips it entirely.',
    fix: 'Add alt text describing what the image conveys. If it is decorative and repeats adjacent text, use alt="" so it is skipped deliberately rather than by accident.',
    example: (html) => withAttribute(html, 'alt', 'What this image shows'),
  },
  'link-name': {
    why: 'A screen reader announces this as "link" with nothing after it, so where it goes is unknowable without following it.',
    fix: 'Give the link text. Where the design calls for an icon alone, keep the visible icon and add a visually hidden label or an aria-label.',
    example: (html) => withContent(html, 'Where this link goes'),
  },
  'button-name': {
    why: 'A screen reader announces this as "button" with nothing after it, so what it does is unknowable without pressing it.',
    fix: 'Give the button text, or an aria-label where it shows only an icon.',
    example: (html) => withContent(html, 'What this button does'),
  },
  'html-has-lang': {
    why: 'A screen reader reads the page in whatever language it defaults to, so German content is read with English pronunciation rules and is close to unintelligible.',
    fix: 'Set the lang attribute on <html> to the language the page is written in.',
    example: (html) => withAttribute(html, 'lang', 'de'),
  },
  'html-lang-valid': {
    why: 'An unrecognised language tag leaves a screen reader guessing, with the same result as no tag at all.',
    fix: 'Use a valid BCP 47 tag: de, de-AT, en-GB.',
    example: (html) => withAttribute(html, 'lang', 'de-AT'),
  },
  'document-title': {
    why: 'The title is the first thing a screen reader announces and what a tab and a bookmark show. Without one, every page of the site is indistinguishable from every other.',
    fix: 'Add a <title> to the document head, naming this page before the site.',
  },
  label: {
    why: 'A screen reader announces this field with no name, so what to type in it is unknowable.',
    fix: 'Give the field a <label for="…">, or an aria-label where the design has no visible label. A placeholder is not a label: it disappears as soon as somebody types.',
  },
  'form-field-multiple-labels': {
    why: 'Screen readers disagree about which label to announce, so what somebody hears depends on their software.',
    fix: 'Leave one label on the field and fold the rest into it, or into aria-describedby.',
  },
  'aria-allowed-attr': {
    why: 'An ARIA attribute its role does not permit is ignored or, worse, changes how the element is announced in a way nobody intended.',
    fix: 'Remove the attribute, or change the role to one that allows it.',
  },
  'aria-required-attr': {
    why: 'The role promises state that is not there, so a screen reader announces a control without saying whether it is checked, expanded or selected.',
    fix: 'Add the attributes the role requires, and keep them in step with the state as it changes.',
  },
  'aria-valid-attr-value': {
    why: 'An aria-labelledby or aria-describedby pointing at an id that is not on the page leaves the element with no name at all.',
    fix: 'Point it at an element that exists, or drop the attribute and label the element directly.',
  },
  'aria-hidden-focus': {
    why: 'The element is hidden from screen readers and still reachable by keyboard, so somebody tabbing through the page lands on something their software cannot describe.',
    fix: 'Remove aria-hidden, or take the element out of the tab order with tabindex="-1" and by disabling the control.',
  },
  'heading-order': {
    why: 'Headings are how screen reader users navigate a page. A level skipped reads as a missing section.',
    fix: 'Step heading levels one at a time. Where the jump was for visual size, keep the level and set the size in CSS.',
  },
  'empty-heading': {
    why: 'It appears in the heading list a screen reader user navigates by, with nothing to read.',
    fix: 'Give the heading text, or remove it and style the surrounding element instead.',
  },
  'landmark-one-main': {
    why: 'Without a main landmark there is no "skip to content": a screen reader user hears the whole navigation again on every page.',
    fix: 'Wrap the page content in <main>, once per page.',
  },
  region: {
    why: 'Content outside a landmark cannot be reached by landmark navigation, so it is only found by reading the page from the top.',
    fix: 'Put the content inside <header>, <nav>, <main> or <footer>.',
  },
  list: {
    why: 'A screen reader announces "list, N items" and lets somebody skip it. Anything else between the <li>s breaks that count.',
    fix: 'Make every direct child of <ul> or <ol> an <li>, and move anything else inside one.',
  },
  listitem: {
    why: 'An <li> outside a list is announced as ordinary text, so the grouping the layout implies is not there for anybody who cannot see it.',
    fix: 'Put the item inside a <ul> or <ol>.',
  },
  'duplicate-id-aria': {
    why: 'ARIA references resolve to the first match, so one of these elements is silently labelled by the wrong thing.',
    fix: 'Make the ids unique. Where they come from a component rendered more than once, derive the id from a prop or a generated suffix.',
  },
  'color-contrast': {
    why: 'Text this close to its background is unreadable for many people with low vision, and for anybody in bright sunlight.',
    fix: 'Raise the contrast to 4.5:1 for body text, or 3:1 for large or bold text. Check hover, focus, visited, disabled and placeholder states too — those are the ones usually missed.',
  },
  'link-in-text-block': {
    why: 'A link distinguished from its paragraph by colour alone is invisible to somebody who cannot distinguish those colours.',
    fix: 'Underline links inside paragraphs, or give them a 3:1 contrast difference against the surrounding text as well as against the background.',
  },
  'target-size': {
    why: 'A target this small is hard to hit for anybody with a tremor, and for everybody on a phone.',
    fix: 'Make the clickable area at least 24×24 CSS pixels, with padding rather than a bigger icon.',
  },
  'frame-title': {
    why: 'A screen reader announces an untitled frame as "frame", so what is in it is unknowable without entering it.',
    fix: 'Add a title attribute saying what the frame contains.',
    example: (html) => withAttribute(html, 'title', 'What this frame contains'),
  },
  'meta-viewport': {
    why: 'Blocking zoom stops anybody who needs larger text from reading the page at all on a phone.',
    fix: 'Remove user-scalable=no and any maximum-scale below 5 from the viewport meta tag.',
    example: (html) => withAttribute(html, 'content', 'width=device-width, initial-scale=1'),
  },
}

/**
 * Fixes that genuinely differ by framework.
 *
 * Deliberately short. Everything absent here is covered by the generic entry,
 * because for most rules the correction is identical whatever produced the
 * markup, and a per-framework table full of restatements would be a maintenance
 * cost with no reader.
 */
const BY_FRAMEWORK: Readonly<Record<string, Readonly<Record<string, Partial<Remediation>>>>> = {
  next: {
    'image-alt': {
      fix: 'next/image requires alt, so an empty one here means it was set to \'\' or a plain <img> was used. Give it a real alt, or alt="" only where the image repeats adjacent text.',
    },
    'html-has-lang': {
      fix: 'Set lang on the <html> element in app/layout.tsx (App Router) or pages/_document.tsx (Pages Router). Setting it in a page component will not reach the document.',
    },
  },
  nuxt: {
    'html-has-lang': {
      fix: "Set app.head.htmlAttrs.lang in nuxt.config.ts, or call useHead({ htmlAttrs: { lang: 'de' } }) in app.vue.",
    },
    'link-name': {
      fix: 'Give the <NuxtLink> content, or an aria-label where it renders an icon alone.',
    },
  },
  astro: {
    'html-has-lang': {
      fix: 'Set lang on the <html> element in your layout under src/layouts, not in the individual page.',
    },
    'image-alt': {
      fix: 'Astro\'s <Image /> requires alt. Give it one describing what the image conveys, or alt="" where it repeats adjacent text.',
    },
  },
  sveltekit: {
    'html-has-lang': {
      fix: 'Set lang on the <html> element in src/app.html, which is the template every route is rendered into.',
    },
  },
  remix: {
    'html-has-lang': {
      fix: 'Set lang on the <html> element in the root route (app/root.tsx), which renders the document shell.',
    },
  },
}

/**
 * What to do about a rule, in this project's idiom where that differs.
 *
 * `framework` is the registry id from `detectFramework`. An unknown one, or
 * none, falls through to the generic advice rather than to nothing: the fix for
 * most rules does not depend on what built the page.
 */
export function remediationFor(ruleId: string, framework?: string): Remediation | undefined {
  const generic = GENERIC[ruleId]
  const specific = framework === undefined ? undefined : BY_FRAMEWORK[framework]?.[ruleId]
  if (generic === undefined) return undefined
  // Merged rather than replaced, so an overlay states only what differs. An
  // overlay that replaced the entry would silently drop the corrected snippet
  // and the sentence about who is shut out, neither of which changes with the
  // framework — and losing them by omission is exactly the sort of quiet
  // regression an overlay table invites.
  return specific === undefined ? generic : { ...generic, ...specific }
}

/** Rules this has advice for, for the test that keeps the table honest. */
export function remediatedRules(): string[] {
  return Object.keys(GENERIC).sort()
}

/**
 * Rules each framework overlays, so a test can assert every one of them has a
 * generic entry to merge onto. An overlay for a rule with no generic entry
 * would produce advice for some projects and silence for the rest.
 */
export function overlaidRules(): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(BY_FRAMEWORK).map(([framework, rules]) => [
      framework,
      Object.keys(rules).sort(),
    ]),
  )
}

/** Frameworks carrying an overlay, for the same test. */
export function remediationFrameworks(): string[] {
  return Object.keys(BY_FRAMEWORK).sort()
}
