# Manual accessibility review

Of the 55 WCAG 2.2 success criteria at Levels A and AA,
**34 have no automated rule at all**: no engine, this one included, can
reach a verdict on them. They are the part of conformance a person has to do, and this is
the list of them.

Record what you find in `examples/eaa-review.json`, which is the file `eaa-kit audit --review`
reads. Ticking a box below records nothing: this document is generated from the record and
never read back into it.

For each criterion, set `result` to one of:

- `met` — you checked it and the site meets it.
- `not-met` — you checked it and it does not. Say what is wrong in `note`.
- `not-applicable` — there is nothing on this site the criterion applies to. Not the same
  as `met`, and never counted as though it were.
- `unreviewed` — nobody has looked yet. What every entry starts as.

Set `reviewedOn` to the day you checked it. An entry with no date cannot be shown to still
hold, and an audit run with `--review-max-age` will not count it.

## Criteria no automated rule can reach

These are the review. Nothing in any eaa-kit report says anything about them.

- [x] **1.2.3 Audio Description or Media Alternative (Prerecorded)** (Level A)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/audio-description-or-media-alternative-prerecorded.html
      Recorded: not-applicable (on 2026-08-21)
      Note: No prerecorded video or audio anywhere on the site.

- [ ] **1.2.4 Captions (Live)** (Level AA)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/captions-live.html

- [ ] **1.2.5 Audio Description (Prerecorded)** (Level AA)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/audio-description-prerecorded.html

- [x] **1.3.2 Meaningful Sequence** (Level A)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/meaningful-sequence.html
      Recorded: not-met (on 2026-08-21)
      Note: On the shop pages the sidebar reads before the product, in DOM order.

- [ ] **1.3.3 Sensory Characteristics** (Level A)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/sensory-characteristics.html

- [ ] **1.3.4 Orientation** (Level AA)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/orientation.html

- [ ] **1.4.5 Images of Text** (Level AA)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/images-of-text.html

- [ ] **1.4.10 Reflow** (Level AA)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/reflow.html

- [ ] **1.4.11 Non-text Contrast** (Level AA)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html

- [ ] **1.4.13 Content on Hover or Focus** (Level AA)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html

- [ ] **2.1.2 No Keyboard Trap** (Level A)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap.html

- [ ] **2.1.4 Character Key Shortcuts** (Level A)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html

- [ ] **2.3.1 Three Flashes or Below Threshold** (Level A)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html

- [ ] **2.4.3 Focus Order** (Level A)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html

- [ ] **2.4.5 Multiple Ways** (Level AA)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/multiple-ways.html

- [ ] **2.4.6 Headings and Labels** (Level AA)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html

- [ ] **2.4.7 Focus Visible** (Level AA)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html

- [ ] **2.4.11 Focus Not Obscured (Minimum)** (Level AA)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html

- [ ] **2.5.1 Pointer Gestures** (Level A)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/pointer-gestures.html

- [ ] **2.5.2 Pointer Cancellation** (Level A)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/pointer-cancellation.html

- [ ] **2.5.3 Label in Name** (Level A)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html

- [ ] **2.5.4 Motion Actuation** (Level A)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/motion-actuation.html

- [ ] **2.5.7 Dragging Movements** (Level AA)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html

- [ ] **3.2.1 On Focus** (Level A)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/on-focus.html

- [ ] **3.2.2 On Input** (Level A)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/on-input.html

- [ ] **3.2.3 Consistent Navigation** (Level AA)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/consistent-navigation.html

- [ ] **3.2.4 Consistent Identification** (Level AA)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html

- [ ] **3.2.6 Consistent Help** (Level A)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/consistent-help.html

- [ ] **3.3.1 Error Identification** (Level A)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html

- [ ] **3.3.3 Error Suggestion** (Level AA)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/error-suggestion.html

- [x] **3.3.4 Error Prevention (Legal, Financial, Data)** (Level AA)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/error-prevention-legal-financial-data.html
      Recorded: met (on 2026-08-19)

- [ ] **3.3.7 Redundant Entry** (Level A)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html

- [ ] **3.3.8 Accessible Authentication (Minimum)** (Level AA)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html

- [ ] **4.1.3 Status Messages** (Level AA)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html

## Criteria an audit can reach

An audit reaches these when the rules below actually match something on the site. A run
that found nothing to check has not shown the criterion is met, so they are worth a look
too — and where this engine could not decide a rule, the check to do by hand is named.

- [ ] **1.1.1 Non-text Content** (Level A)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html
      Rules that touch it: aria-meter-name, aria-progressbar-name, image-alt, input-image-alt, object-alt, role-img-alt, svg-img-alt

- [ ] **1.2.1 Audio-only and Video-only (Prerecorded)** (Level A)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/audio-only-and-video-only-prerecorded.html
      Rules that touch it: audio-caption

- [ ] **1.2.2 Captions (Prerecorded)** (Level A)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/captions-prerecorded.html
      Rules that touch it: video-caption

- [ ] **1.3.1 Info and Relationships** (Level A)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html
      Rules that touch it: aria-hidden-body, aria-required-children, aria-required-parent, definition-list, dlitem, list, listitem, td-headers-attr, th-has-data-cells

- [ ] **1.3.5 Identify Input Purpose** (Level AA)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/identify-input-purpose.html
      Rules that touch it: autocomplete-valid

- [ ] **1.4.1 Use of Color** (Level A)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html
      Rules that touch it: link-in-text-block
      link-in-text-block: Look at links inside paragraphs. If the only thing distinguishing them from the surrounding text is colour, they need an underline or a 3:1 contrast difference against that text as well.

- [ ] **1.4.2 Audio Control** (Level A)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/audio-control.html
      Rules that touch it: no-autoplay-audio
      no-autoplay-audio: Load the page and listen. Anything that plays for more than three seconds on its own needs a pause or stop control, or a volume control independent of the system volume.

- [ ] **1.4.3 Contrast (Minimum)** (Level AA)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
      Rules that touch it: color-contrast
      color-contrast: Open the page and check text against its background with a contrast checker. Body text needs 4.5:1, and large or bold text 3:1. Check the states too — hover, focus, visited, disabled and placeholder text are the ones usually missed.

- [ ] **1.4.4 Resize Text** (Level AA)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html
      Rules that touch it: meta-viewport

- [ ] **1.4.12 Text Spacing** (Level AA)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html
      Rules that touch it: avoid-inline-spacing
      avoid-inline-spacing: Override line height to 1.5×, paragraph spacing to 2×, letter spacing to 0.12× and word spacing to 0.16× the font size, then check nothing is clipped or overlapping. Inline styles that set spacing with !important are what break this.

- [x] **2.1.1 Keyboard** (Level A)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html
      Rules that touch it: frame-focusable-content, scrollable-region-focusable, server-side-image-map
      scrollable-region-focusable: Find anything that scrolls inside the page — a code block, a wide table, a long list — and try reaching it with the Tab key alone. If it cannot take focus, a keyboard user cannot scroll it.
      Recorded: met (on 2026-08-21)
      Note: Every control reached and operated with the keyboard alone, in Firefox and Safari.

- [ ] **2.2.1 Timing Adjustable** (Level A)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html
      Rules that touch it: meta-refresh

- [ ] **2.2.2 Pause, Stop, Hide** (Level A)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html
      Rules that touch it: blink, marquee

- [ ] **2.4.1 Bypass Blocks** (Level A)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/bypass-blocks.html
      Rules that touch it: bypass

- [ ] **2.4.2 Page Titled** (Level A)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/page-titled.html
      Rules that touch it: document-title

- [ ] **2.4.4 Link Purpose (In Context)** (Level A)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html
      Rules that touch it: area-alt, link-name

- [ ] **2.5.8 Target Size (Minimum)** (Level AA)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
      Rules that touch it: target-size
      target-size: Measure the clickable area of buttons, icon links and form controls: 24×24 CSS pixels at minimum, unless they are inline in a sentence or have that much clear space around them. Icon-only controls in a header or a media player are where this usually fails.

- [ ] **3.1.1 Language of Page** (Level A)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/language-of-page.html
      Rules that touch it: html-has-lang, html-lang-valid, html-xml-lang-mismatch

- [ ] **3.1.2 Language of Parts** (Level AA)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/language-of-parts.html
      Rules that touch it: valid-lang

- [ ] **3.3.2 Labels or Instructions** (Level A)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html
      Rules that touch it: form-field-multiple-labels

- [ ] **4.1.2 Name, Role, Value** (Level A)
      What it requires: https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html
      Rules that touch it: area-alt, aria-allowed-attr, aria-braille-equivalent, aria-command-name, aria-conditional-attr, aria-deprecated-role, aria-hidden-body, aria-hidden-focus, aria-input-field-name, aria-prohibited-attr, aria-required-attr, aria-roledescription, aria-roles, aria-tab-name, aria-toggle-field-name, aria-tooltip-name, aria-valid-attr, aria-valid-attr-value, button-name, duplicate-id-aria, frame-title, frame-title-unique, input-button-name, input-image-alt, label, link-name, nested-interactive, select-name, summary-name

---

A completed review is not a compliance statement, and this tool cannot check that anything
recorded here is true. It records what somebody says they checked, which is the same
standing as the claims in the statement it generates.
