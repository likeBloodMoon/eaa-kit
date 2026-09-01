import axe from 'axe-core'
import { manualCheckFor } from './manual.ts'
import { DEFAULT_TAGS, ENGINE_BLIND_RULES, type PageAudit, successCriteria } from './result.ts'

/**
 * How much of WCAG this run could reach at all.
 *
 * The tool refuses to divide passes by failures, and it is right to: only
 * `passes` is evidence, `inapplicable` is not, and the two summed would make an
 * empty page look compliant. But refusing that number left nothing in its
 * place, so a reader got a page of honest disclaimers and no measurement, and
 * "automated testing finds a minority of barriers" stayed a sentence rather
 * than a figure.
 *
 * There is an honest denominator, and it is the standard rather than the DOM.
 * WCAG 2.2 has 55 success criteria at Levels A and AA. axe-core has rules
 * touching 23 of them. That is the number nobody publishes, and it is the most
 * useful thing this tool can say about its own limits: most of WCAG cannot be
 * checked by any automated engine, and no amount of green output changes it.
 *
 * Four outcomes, and every criterion lands in exactly one — the same discipline
 * `shapeResults` enforces for rules, for the same reason. They must never be
 * summed into a score.
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

/**
 * What this run established about one criterion.
 *
 * `nothing-to-check` is kept apart from `evaluated` deliberately. A rule that
 * ran and found no matching element has not shown that the criterion is met —
 * a page with no images proves nothing about image alternatives — and folding
 * the two together would be the same mistake as adding `inapplicable` to
 * `passes`.
 */
export type CoverageStatus =
  | 'evaluated'
  | 'not-evaluated'
  | 'nothing-to-check'
  | 'no-automated-rule'

export interface CriterionCoverage extends SuccessCriterion {
  status: CoverageStatus
  /** Rules in scope that map to this criterion, sorted. */
  rules: string[]
  /**
   * True when re-running with `--browser` would move this out of
   * `not-evaluated`. False means a person has to look, whatever engine runs.
   */
  browserWouldAnswer: boolean
}

export interface Coverage {
  criteria: CriterionCoverage[]
  /** A rule reached a pass or a violation here. */
  evaluated: number
  /** A rule exists and this engine could not decide it. */
  notEvaluated: number
  /** Rules ran and found nothing on this site to check. */
  nothingToCheck: number
  /** No automated rule exists at all. Somebody has to look. */
  noAutomatedRule: number
  /** Of `notEvaluated`, how many `--browser` would answer. */
  browserWouldAnswer: number
  /** Everything above sums to this: the criteria in WCAG 2.2 at A and AA. */
  total: number
}

/**
 * Rules axe-core would run under these tags, mapped to the criteria they cover.
 *
 * Experimental rules are excluded, matching `blindRulesInScope`: axe-core leaves
 * them off by default, so counting them as coverage would promise checks that
 * never run.
 */
function rulesByCriterion(tags: readonly string[]): Map<string, string[]> {
  const byCriterion = new Map<string, string[]>()
  for (const rule of axe.getRules([...tags])) {
    if (rule.tags.includes('experimental')) continue
    for (const criterion of successCriteria(rule.tags)) {
      const rules = byCriterion.get(criterion)
      if (rules) rules.push(rule.ruleId)
      else byCriterion.set(criterion, [rule.ruleId])
    }
  }
  for (const rules of byCriterion.values()) rules.sort()
  return byCriterion
}

/** Rule ids this run reached a pass or a violation on, across every page. */
function decidedRules(audits: readonly PageAudit[]): Set<string> {
  const decided = new Set<string>()
  for (const audit of audits) {
    for (const finding of audit.violations) decided.add(finding.ruleId)
    for (const finding of audit.accepted ?? []) decided.add(finding.ruleId)
    for (const outcome of audit.passes) decided.add(outcome.ruleId)
  }
  return decided
}

/** Rule ids this run reached no verdict on because the engine cannot see them. */
function blindedRules(audits: readonly PageAudit[]): Set<string> {
  const blind = new Set<string>()
  for (const audit of audits) {
    for (const finding of audit.incomplete) {
      if (finding.reason === 'engine-limitation') blind.add(finding.ruleId)
    }
  }
  return blind
}

/**
 * What this run reached, criterion by criterion.
 *
 * `audits` decides `evaluated` rather than the engine's capabilities alone: a
 * rule that could have run and never matched anything has not established that
 * the criterion is met on this site, and saying otherwise would be a coverage
 * claim resting on an empty page.
 */
export function buildCoverage(
  audits: readonly PageAudit[],
  tags: readonly string[] = DEFAULT_TAGS,
): Coverage {
  const byCriterion = rulesByCriterion(tags)
  const decided = decidedRules(audits)
  const blinded = blindedRules(audits)

  const criteria: CriterionCoverage[] = WCAG22_AA_CRITERIA.map((criterion) => {
    const rules = byCriterion.get(criterion.number) ?? []

    if (rules.length === 0) {
      return { ...criterion, status: 'no-automated-rule', rules, browserWouldAnswer: false }
    }

    if (rules.some((rule) => decided.has(rule))) {
      return { ...criterion, status: 'evaluated', rules, browserWouldAnswer: false }
    }

    // No verdict. Either the engine is blind to a rule here, or every rule ran
    // and matched nothing — different facts with different remedies, so they
    // are not folded together.
    const engineBlind = rules.filter(
      (rule) => blinded.has(rule) || ENGINE_BLIND_RULES[rule] !== undefined,
    )

    // One blind rule is enough. Requiring all of them was wrong on the one
    // criterion where the rules are mixed: WCAG 2.1.1 Keyboard has
    // scrollable-region-focusable, which needs computed overflow, alongside two
    // this engine can see — so a page with no frames and no image maps reported
    // 2.1.1 as "nothing to check" while the same report's rule listing said
    // scrollable-region-focusable had reached no verdict. One document
    // contradicting itself about a Level A criterion, and in the direction that
    // understates the gap.
    if (engineBlind.length > 0) {
      return {
        ...criterion,
        status: 'not-evaluated',
        rules,
        // `browserAnswers` is recorded per rule beside the manual check. If a
        // browser resolves every rule standing between here and a verdict, then
        // re-running with --browser is a real answer; otherwise a person looks
        // whatever engine runs.
        browserWouldAnswer: engineBlind.every(
          (rule) => manualCheckFor(rule)?.browserAnswers === true,
        ),
      }
    }

    return { ...criterion, status: 'nothing-to-check', rules, browserWouldAnswer: false }
  })

  const count = (status: CoverageStatus): number =>
    criteria.filter((criterion) => criterion.status === status).length

  return {
    criteria,
    evaluated: count('evaluated'),
    notEvaluated: count('not-evaluated'),
    nothingToCheck: count('nothing-to-check'),
    noAutomatedRule: count('no-automated-rule'),
    browserWouldAnswer: criteria.filter((criterion) => criterion.browserWouldAnswer).length,
    total: WCAG22_AA_CRITERIA.length,
  }
}

/**
 * The sentence a reader needs before drawing anything from a clean report.
 *
 * Deliberately leads with what was not checked. A report that opened with "23
 * criteria evaluated" would read as a score, which is precisely what this
 * refuses to be.
 */
export function coverageSummary(coverage: Coverage): string {
  const unautomatable = coverage.noAutomatedRule
  return (
    `Of the ${coverage.total} WCAG 2.2 A and AA success criteria, ` +
    `${unautomatable} cannot be checked by any automated engine and need a person. ` +
    `This run reached a verdict on ${coverage.evaluated}.`
  )
}
