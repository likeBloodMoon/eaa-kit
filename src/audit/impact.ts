import type { ImpactValue } from 'axe-core'
import type { PageAudit } from './runners/jsdom.ts'

/** axe-core's impact scale, least to most severe. */
export const IMPACT_LEVELS = ['minor', 'moderate', 'serious', 'critical'] as const

export type ImpactLevel = (typeof IMPACT_LEVELS)[number]

/** What `--fail-on` defaults to: serious and critical break the build. */
export const DEFAULT_FAIL_ON: ImpactLevel = 'serious'

export function isImpactLevel(value: string): value is ImpactLevel {
  return (IMPACT_LEVELS as readonly string[]).includes(value)
}

/**
 * Whether a violation is severe enough to fail the run.
 *
 * A violation whose impact axe-core did not classify counts at every threshold.
 * Guessing low would let an unclassified failure through silently, and a
 * missing impact is a gap in what we know, not evidence that it is harmless.
 */
export function meetsThreshold(impact: ImpactValue, threshold: ImpactLevel): boolean {
  if (impact === null || !isImpactLevel(impact)) return true
  return IMPACT_LEVELS.indexOf(impact) >= IMPACT_LEVELS.indexOf(threshold)
}

/** Violations at or above `threshold`, counted per rule per page. */
export function countAtOrAbove(audits: readonly PageAudit[], threshold: ImpactLevel): number {
  let total = 0
  for (const audit of audits) {
    for (const finding of audit.violations) {
      if (meetsThreshold(finding.impact, threshold)) total += 1
    }
  }
  return total
}
