import { describe, expect, it, vi } from 'vitest'
import { auditBuild } from '../../src/integration/run.ts'

/**
 * What the integrations hand over to the audit.
 *
 * Every option but `enabled` and `failBuild` is the audit command's own and is
 * passed through untouched, which is what lets a flag reach all five plugins by
 * being named in one interface. That is only true while nothing in between
 * rebuilds the object key by key, so it is asserted rather than assumed: a flag
 * the changelog says exists and the plugins cannot pass is the failure this
 * catches.
 */

const runAuditCommand = vi.hoisted(() => vi.fn(async () => ({ audits: [], exitCode: 0 })))

vi.mock('../../src/cli/audit.ts', () => ({ runAuditCommand }))

describe('auditBuild', () => {
  it('passes the audit options through, and keeps its own two', async () => {
    await auditBuild(
      'dist',
      { fast: true, failOn: 'critical', browser: false, enabled: true, failBuild: false },
      { info: () => {}, warn: () => {}, error: () => {} },
    )

    expect(runAuditCommand).toHaveBeenCalledWith('dist', {
      fast: true,
      failOn: 'critical',
      browser: false,
    })
  })
})
