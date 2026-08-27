/**
 * Lives in its own module so that both the renderer and the audit-report reader
 * can throw it without importing each other.
 *
 * Everything the statement command can fail on lands here: a missing template,
 * an audit report it cannot read. The CLI turns it into exit code 2, since a
 * statement that could not be produced is never a statement with a problem in
 * it — nothing is emitted at all.
 */
export class StatementError extends Error {
  override readonly name = 'StatementError'
}
