/**
 * The command that gets somebody past an error.
 *
 * An error the reader cannot act on without opening the docs is half an error.
 * Every error class a command can stop on carries one of these where there is a
 * command that fixes it, and `fail` prints it under the message. That keeps
 * "what went wrong" and "what to type" apart, so the second one can be copied
 * as it is.
 *
 * Only where the fix is a command. An invalid field in a config file is fixed
 * by editing the field, and the issues printed under that error already name
 * it, so pointing at a command there would send somebody somewhere else.
 */
export interface NextStep {
  /** Exactly what to type. */
  command: string
  /** What it does, in a few words. */
  why: string
}

/** The next step an error carries, if it carries one. */
export function nextStepOf(cause: unknown): NextStep | undefined {
  if (cause === null || typeof cause !== 'object') return undefined
  const next = (cause as { next?: unknown }).next
  if (next === null || typeof next !== 'object') return undefined
  const { command, why } = next as Partial<NextStep>
  return typeof command === 'string' && typeof why === 'string' ? { command, why } : undefined
}
