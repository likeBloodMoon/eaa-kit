import { z } from 'zod'

/** Countries with their own supervisory body and statute text. */
export const COUNTRIES = ['AT', 'DE', 'CH'] as const
export type Country = (typeof COUNTRIES)[number]

/** Languages a statement can be rendered in. */
export const STATEMENT_LOCALES = ['de', 'en'] as const
export type StatementLocale = (typeof STATEMENT_LOCALES)[number]

/**
 * Wording follows the EU model statement: fully, partially, or not conformant
 * with the standard. "partially-compliant" is the honest answer for most sites
 * and the one that carries obligations to list what is missing.
 */
export const COMPLIANCE_STATUSES = ['compliant', 'partially-compliant', 'non-compliant'] as const
export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number]

export const ASSESSMENT_METHODS = ['self-assessment', 'external-audit'] as const
export type AssessmentMethod = (typeof ASSESSMENT_METHODS)[number]

/**
 * Why a known barrier still exists. The first two are the grounds the EU regime
 * recognises for leaving something inaccessible; the third is a plain promise to
 * fix it, which is what most small sites actually mean.
 */
export const ISSUE_REASONS = ['disproportionate-burden', 'out-of-scope', 'fix-planned'] as const
export type IssueReason = (typeof ISSUE_REASONS)[number]

const knownIssueObject = z.object({
  /** What is not accessible, in the statement's language. */
  description: z.string().min(1),
  /** WCAG success criteria, e.g. ['1.4.3']. */
  successCriteria: z.array(z.string()).default([]),
  /** EN 301 549 clauses, e.g. ['9.1.4.3']. */
  en301549: z.array(z.string()).default([]),
  reason: z.enum(ISSUE_REASONS).optional(),
  /** ISO date by which the barrier is expected to be removed. */
  remedyBy: z.iso.date().optional(),
})

/**
 * A bare string is accepted as shorthand for `{ description }`. It is piped
 * through the object schema so both branches produce the same output type,
 * rather than a union that callers have to narrow before reading `remedyBy`.
 */
const knownIssueSchema = z.union([
  z
    .string()
    .min(1)
    .transform((description) => ({ description }))
    .pipe(knownIssueObject),
  knownIssueObject,
])

export const configSchema = z.object({
  site: z.object({
    name: z.string().min(1),
    url: z.url(),
    /** BCP 47 tag of the site itself, e.g. 'de-AT'. */
    locale: z.string().min(2),
  }),
  provider: z.object({
    /** The legal entity answerable for the service. */
    legalName: z.string().min(1),
    /**
     * The feedback address. Required: the EAA obliges providers to offer a way
     * to report accessibility barriers, and a statement without one is not
     * usable for its purpose.
     */
    email: z.email(),
    phone: z.string().min(1).optional(),
    address: z.string().min(1).optional(),
  }),
  compliance: z.object({
    status: z.enum(COMPLIANCE_STATUSES),
    standard: z.string().min(1).default('EN 301 549 V3.2.1 (WCAG 2.2 AA)'),
    knownIssues: z.array(knownIssueSchema).default([]),
    /** When the assessment was carried out. */
    assessedOn: z.iso.date(),
    assessmentMethod: z.enum(ASSESSMENT_METHODS).default('self-assessment'),
  }),
  enforcement: z.object({
    /** Drives which supervisory body and statute the template names. */
    country: z.enum(COUNTRIES),
  }),
})

export type EaaConfigInput = z.input<typeof configSchema>
export type EaaConfig = z.output<typeof configSchema>
export type KnownIssue = EaaConfig['compliance']['knownIssues'][number]

/**
 * Identity function that gives `eaa.config.ts` its types. Deliberately does not
 * validate: a config file is loaded and checked in one place, so that an error
 * points at the file rather than at wherever the module happened to be
 * imported.
 */
export function defineConfig(config: EaaConfigInput): EaaConfigInput {
  return config
}

export class ConfigError extends Error {
  override readonly name = 'ConfigError'

  constructor(
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message)
  }
}

/** Validate an already-loaded config object. */
export function parseConfig(value: unknown, source = 'config'): EaaConfig {
  const result = configSchema.safeParse(value)
  if (result.success) return result.data

  const issues = result.error.issues.map((issue) => {
    const path = issue.path.join('.')
    return path ? `${path}: ${issue.message}` : issue.message
  })
  throw new ConfigError(`${source} is not valid`, issues)
}
