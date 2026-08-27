import { parentPort, workerData } from 'node:worker_threads'
import type { CollectedPage } from '../collect.ts'
import { auditPage, type JsdomRunnerOptions } from './jsdom.ts'

/**
 * One audit worker: a thread that owns its own jsdom and axe-core, and audits
 * whatever page the pool hands it.
 *
 * It exists as a separate entry point rather than as inline source passed to
 * `new Worker(…, { eval: true })` because the thing it has to import — the
 * jsdom runner — sits at a different path when running from `src` than it does
 * in the bundle, and a string of code cannot be resolved against either.
 *
 * The protocol is deliberately one message each way: a CollectedPage in, the
 * PageAudit it produced out, both plain data that structured-clone handles.
 * `auditPage` turns a page it cannot audit into a PageAudit carrying an
 * `error`, so a failure is an ordinary reply rather than a special case. Only
 * something catastrophic — the thread running out of memory — reaches the
 * pool's error handler instead.
 */

const port = parentPort
if (!port) {
  throw new Error('eaa-kit audit worker was started outside a worker thread')
}

const options = (workerData ?? {}) as JsdomRunnerOptions

port.on('message', async (page: CollectedPage) => {
  port.postMessage(await auditPage(page, options))
})
