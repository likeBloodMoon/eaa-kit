/**
 * WCAG 2.2 at Levels A and AA, as data.
 *
 * Its own module because it is not this tool's: it is the standard's list, and
 * three things now read it that have nothing to do with an engine — the
 * checklist, the worksheet and the statement. Leaving it in `coverage.ts` meant
 * importing axe-core to find out how many success criteria WCAG has, which cost
 * the statement command 90 ms to be told a fact about a document published in
 * 2023.
 */

export type Level = 'A' | 'AA'

export interface SuccessCriterion {
  /** e.g. '1.4.3'. */
  number: string
  title: string
  level: Level
}

/**
 * WCAG 2.2 at Levels A and AA, which is what this tool audits against.
 *
 * 4.1.1 Parsing is deliberately absent: it was removed in WCAG 2.2 and counting
 * it would inflate the denominator with a criterion nobody has to meet.
 */
export const WCAG22_AA_CRITERIA: readonly SuccessCriterion[] = [
  { number: '1.1.1', title: 'Non-text Content', level: 'A' },
  { number: '1.2.1', title: 'Audio-only and Video-only (Prerecorded)', level: 'A' },
  { number: '1.2.2', title: 'Captions (Prerecorded)', level: 'A' },
  { number: '1.2.3', title: 'Audio Description or Media Alternative (Prerecorded)', level: 'A' },
  { number: '1.2.4', title: 'Captions (Live)', level: 'AA' },
  { number: '1.2.5', title: 'Audio Description (Prerecorded)', level: 'AA' },
  { number: '1.3.1', title: 'Info and Relationships', level: 'A' },
  { number: '1.3.2', title: 'Meaningful Sequence', level: 'A' },
  { number: '1.3.3', title: 'Sensory Characteristics', level: 'A' },
  { number: '1.3.4', title: 'Orientation', level: 'AA' },
  { number: '1.3.5', title: 'Identify Input Purpose', level: 'AA' },
  { number: '1.4.1', title: 'Use of Color', level: 'A' },
  { number: '1.4.2', title: 'Audio Control', level: 'A' },
  { number: '1.4.3', title: 'Contrast (Minimum)', level: 'AA' },
  { number: '1.4.4', title: 'Resize Text', level: 'AA' },
  { number: '1.4.5', title: 'Images of Text', level: 'AA' },
  { number: '1.4.10', title: 'Reflow', level: 'AA' },
  { number: '1.4.11', title: 'Non-text Contrast', level: 'AA' },
  { number: '1.4.12', title: 'Text Spacing', level: 'AA' },
  { number: '1.4.13', title: 'Content on Hover or Focus', level: 'AA' },
  { number: '2.1.1', title: 'Keyboard', level: 'A' },
  { number: '2.1.2', title: 'No Keyboard Trap', level: 'A' },
  { number: '2.1.4', title: 'Character Key Shortcuts', level: 'A' },
  { number: '2.2.1', title: 'Timing Adjustable', level: 'A' },
  { number: '2.2.2', title: 'Pause, Stop, Hide', level: 'A' },
  { number: '2.3.1', title: 'Three Flashes or Below Threshold', level: 'A' },
  { number: '2.4.1', title: 'Bypass Blocks', level: 'A' },
  { number: '2.4.2', title: 'Page Titled', level: 'A' },
  { number: '2.4.3', title: 'Focus Order', level: 'A' },
  { number: '2.4.4', title: 'Link Purpose (In Context)', level: 'A' },
  { number: '2.4.5', title: 'Multiple Ways', level: 'AA' },
  { number: '2.4.6', title: 'Headings and Labels', level: 'AA' },
  { number: '2.4.7', title: 'Focus Visible', level: 'AA' },
  { number: '2.4.11', title: 'Focus Not Obscured (Minimum)', level: 'AA' },
  { number: '2.5.1', title: 'Pointer Gestures', level: 'A' },
  { number: '2.5.2', title: 'Pointer Cancellation', level: 'A' },
  { number: '2.5.3', title: 'Label in Name', level: 'A' },
  { number: '2.5.4', title: 'Motion Actuation', level: 'A' },
  { number: '2.5.7', title: 'Dragging Movements', level: 'AA' },
  { number: '2.5.8', title: 'Target Size (Minimum)', level: 'AA' },
  { number: '3.1.1', title: 'Language of Page', level: 'A' },
  { number: '3.1.2', title: 'Language of Parts', level: 'AA' },
  { number: '3.2.1', title: 'On Focus', level: 'A' },
  { number: '3.2.2', title: 'On Input', level: 'A' },
  { number: '3.2.3', title: 'Consistent Navigation', level: 'AA' },
  { number: '3.2.4', title: 'Consistent Identification', level: 'AA' },
  { number: '3.2.6', title: 'Consistent Help', level: 'A' },
  { number: '3.3.1', title: 'Error Identification', level: 'A' },
  { number: '3.3.2', title: 'Labels or Instructions', level: 'A' },
  { number: '3.3.3', title: 'Error Suggestion', level: 'AA' },
  { number: '3.3.4', title: 'Error Prevention (Legal, Financial, Data)', level: 'AA' },
  { number: '3.3.7', title: 'Redundant Entry', level: 'A' },
  { number: '3.3.8', title: 'Accessible Authentication (Minimum)', level: 'AA' },
  { number: '4.1.2', title: 'Name, Role, Value', level: 'A' },
  { number: '4.1.3', title: 'Status Messages', level: 'AA' },
]
