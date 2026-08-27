/**
 * Public entry point, imported by `eaa.config.ts`:
 *
 *   import { defineConfig } from 'eaa-kit'
 *
 * The CLI is a separate entry, so importing this does not pull in jsdom or
 * axe-core.
 */

export type {
  AssessmentMethod,
  ComplianceStatus,
  Country,
  EaaConfig,
  EaaConfigInput,
  IssueReason,
  KnownIssue,
  StatementLocale,
} from './config/define.ts'
export {
  ASSESSMENT_METHODS,
  COMPLIANCE_STATUSES,
  COUNTRIES,
  ConfigError,
  configSchema,
  defineConfig,
  ISSUE_REASONS,
  parseConfig,
  STATEMENT_LOCALES,
} from './config/define.ts'
export type { LoadConfigOptions, LoadedConfig } from './config/load.ts'
export { CONFIG_FILENAMES, findConfigFile, loadConfig } from './config/load.ts'
export { StatementError } from './statement/error.ts'
export type { AuditFinding, AuditSummary } from './statement/findings.ts'
export { readAuditReport, summariseAuditReport } from './statement/findings.ts'
export type { HtmlDocumentOptions } from './statement/html.ts'
export { toHtmlBody, toHtmlDocument } from './statement/html.ts'
export type { RenderedStatement, RenderStatementOptions } from './statement/render.ts'
export { renderStatement } from './statement/render.ts'
