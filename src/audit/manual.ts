/**
 * What a person has to check, and where to read about it.
 *
 * Automated testing finds a minority of accessibility barriers. This tool says
 * so everywhere, and saying so is not much use on its own: a reader told that
 * six rules "could not be evaluated" is left knowing there is a gap and not
 * what to do about it.
 *
 * So each rule the browserless engine cannot decide carries the check somebody
 * would do by hand, and each success criterion carries a link to what it
 * actually requires. The point is to turn the honest disclaimer into the part
 * of the report with the most work in it.
 */

/**
 * WCAG 2.2 Understanding pages, by success criterion.
 *
 * The Understanding document rather than the criterion text: the text says what
 * conformance is, and the Understanding page says what it is for and how to
 * meet it, which is what somebody reading a report needs.
 *
 * Level A and AA only, since that is what this tool audits against.
 */
const UNDERSTANDING: Readonly<Record<string, string>> = {
  '1.1.1': 'non-text-content',
  '1.2.1': 'audio-only-and-video-only-prerecorded',
  '1.2.2': 'captions-prerecorded',
  '1.2.3': 'audio-description-or-media-alternative-prerecorded',
  '1.2.4': 'captions-live',
  '1.2.5': 'audio-description-prerecorded',
  '1.3.1': 'info-and-relationships',
  '1.3.2': 'meaningful-sequence',
  '1.3.3': 'sensory-characteristics',
  '1.3.4': 'orientation',
  '1.3.5': 'identify-input-purpose',
  '1.4.1': 'use-of-color',
  '1.4.2': 'audio-control',
  '1.4.3': 'contrast-minimum',
  '1.4.4': 'resize-text',
  '1.4.5': 'images-of-text',
  '1.4.10': 'reflow',
  '1.4.11': 'non-text-contrast',
  '1.4.12': 'text-spacing',
  '1.4.13': 'content-on-hover-or-focus',
  '2.1.1': 'keyboard',
  '2.1.2': 'no-keyboard-trap',
  '2.1.4': 'character-key-shortcuts',
  '2.2.1': 'timing-adjustable',
  '2.2.2': 'pause-stop-hide',
  '2.3.1': 'three-flashes-or-below-threshold',
  '2.4.1': 'bypass-blocks',
  '2.4.2': 'page-titled',
  '2.4.3': 'focus-order',
  '2.4.4': 'link-purpose-in-context',
  '2.4.5': 'multiple-ways',
  '2.4.6': 'headings-and-labels',
  '2.4.7': 'focus-visible',
  '2.4.11': 'focus-not-obscured-minimum',
  '2.5.1': 'pointer-gestures',
  '2.5.2': 'pointer-cancellation',
  '2.5.3': 'label-in-name',
  '2.5.4': 'motion-actuation',
  '2.5.7': 'dragging-movements',
  '2.5.8': 'target-size-minimum',
  '3.1.1': 'language-of-page',
  '3.1.2': 'language-of-parts',
  '3.2.1': 'on-focus',
  '3.2.2': 'on-input',
  '3.2.3': 'consistent-navigation',
  '3.2.4': 'consistent-identification',
  '3.2.6': 'consistent-help',
  '3.3.1': 'error-identification',
  '3.3.2': 'labels-or-instructions',
  '3.3.3': 'error-suggestion',
  '3.3.4': 'error-prevention-legal-financial-data',
  '3.3.7': 'redundant-entry',
  '3.3.8': 'accessible-authentication-minimum',
  '4.1.2': 'name-role-value',
  '4.1.3': 'status-messages',
}

/** Where to read what a success criterion requires, or undefined if unknown. */
export function understandingUrl(criterion: string): string | undefined {
  const slug = UNDERSTANDING[criterion]
  return slug === undefined ? undefined : `https://www.w3.org/WAI/WCAG22/Understanding/${slug}.html`
}

export interface ManualCheck {
  /** What to do, in the imperative, by somebody who is not an auditor. */
  check: string
  /** Whether `--browser` would answer it instead, so the run need not be manual. */
  browserAnswers: boolean
}

/**
 * The check a person does for a rule this engine could not decide.
 *
 * Written as an action rather than a restatement of the criterion. "Ensure
 * sufficient contrast" tells somebody nothing they did not already know; the
 * useful sentence names what to open and what to look at.
 */
export const MANUAL_CHECKS: Readonly<Record<string, ManualCheck>> = {
  'color-contrast': {
    check:
      'Open the page and check text against its background with a contrast checker. Body text needs 4.5:1, and large or bold text 3:1. Check the states too — hover, focus, visited, disabled and placeholder text are the ones usually missed.',
    browserAnswers: true,
  },
  'color-contrast-enhanced': {
    check: 'Only needed if you are claiming AAA. Body text needs 7:1 and large text 4.5:1.',
    browserAnswers: true,
  },
  'target-size': {
    check:
      'Measure the clickable area of buttons, icon links and form controls: 24×24 CSS pixels at minimum, unless they are inline in a sentence or have that much clear space around them. Icon-only controls in a header or a media player are where this usually fails.',
    browserAnswers: true,
  },
  'scrollable-region-focusable': {
    check:
      'Find anything that scrolls inside the page — a code block, a wide table, a long list — and try reaching it with the Tab key alone. If it cannot take focus, a keyboard user cannot scroll it.',
    browserAnswers: true,
  },
  'link-in-text-block': {
    check:
      'Look at links inside paragraphs. If the only thing distinguishing them from the surrounding text is colour, they need an underline or a 3:1 contrast difference against that text as well.',
    browserAnswers: true,
  },
  'no-autoplay-audio': {
    check:
      'Load the page and listen. Anything that plays for more than three seconds on its own needs a pause or stop control, or a volume control independent of the system volume.',
    browserAnswers: false,
  },
  'avoid-inline-spacing': {
    check:
      'Override line height to 1.5×, paragraph spacing to 2×, letter spacing to 0.12× and word spacing to 0.16× the font size, then check nothing is clipped or overlapping. Inline styles that set spacing with !important are what break this.',
    browserAnswers: true,
  },
  'p-as-heading': {
    check:
      'Look for paragraphs styled to look like headings. A screen reader reads them as body text, so they are invisible to anyone navigating by heading.',
    browserAnswers: false,
  },
  'css-orientation-lock': {
    check:
      'Rotate a phone or tablet. The content should work in both orientations unless one is essential, which is rare outside games and instruments.',
    browserAnswers: false,
  },
}

/** The check for a rule, if there is one written for it. */
export function manualCheckFor(ruleId: string): ManualCheck | undefined {
  return MANUAL_CHECKS[ruleId]
}
