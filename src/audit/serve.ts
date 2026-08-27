import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import path from 'node:path'

/**
 * Content types for what a static build actually contains. Anything else is
 * served as an octet-stream, which is fine: the browser only needs to parse
 * HTML, CSS and fonts for an audit to be meaningful.
 */
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
}

export interface StaticServer {
  /** Origin to navigate to, e.g. http://127.0.0.1:49512 */
  origin: string
  close(): Promise<void>
}

/**
 * Serve a build directory over loopback for the browser runner.
 *
 * A local server rather than file:// URLs, because root-absolute asset paths —
 * `/assets/site.css`, which every static site generator emits — do not resolve
 * under file://. Measured on a page whose stylesheet sets `color: #ccc`: the
 * computed colour is the default black over file:// and the real value over
 * http://. Auditing colour contrast against an unstyled page would be worse
 * than not auditing it at all.
 *
 * Bound to 127.0.0.1 on an ephemeral port, so it is not reachable off the
 * machine and cannot collide with a dev server.
 */
export async function serveDirectory(root: string): Promise<StaticServer> {
  const absoluteRoot = path.resolve(root)

  const server = createServer((request, response) => {
    void handle(absoluteRoot, request.url ?? '/', response)
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('Static server did not bind to a port')
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server),
  }
}

async function handle(
  root: string,
  requestUrl: string,
  response: import('node:http').ServerResponse,
): Promise<void> {
  const file = resolveFile(root, requestUrl)
  if (!file) {
    response.writeHead(404).end()
    return
  }

  try {
    const stats = await stat(file)
    const target = stats.isDirectory() ? path.join(file, 'index.html') : file

    // The status line has to be decided before it is sent, not after the stream
    // has already failed. A directory with no index.html is the ordinary way to
    // get here: `<a href="/assets/">` on any real site.
    if (!(await isReadableFile(target))) {
      response.writeHead(404).end()
      return
    }

    const type = CONTENT_TYPES[path.extname(target).toLowerCase()] ?? 'application/octet-stream'
    response.writeHead(200, { 'content-type': type })
    createReadStream(target)
      // Belt and braces for a file that disappears between the check and the
      // read: the headers are already gone, so all that is left is to stop.
      .on('error', () => {
        if (!response.headersSent) response.writeHead(404)
        response.end()
      })
      .pipe(response)
  } catch {
    response.writeHead(404).end()
  }
}

async function isReadableFile(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isFile()
  } catch {
    return false
  }
}

/** Resolves a request path inside the root, or nothing if it escapes it. */
function resolveFile(root: string, requestUrl: string): string | undefined {
  const { pathname } = new URL(requestUrl, 'http://127.0.0.1')

  // decodeURIComponent throws on a stray or truncated percent escape, and a
  // page only has to contain `<img src="/%">` to produce one. Thrown here it
  // would reach nothing that could catch it and would take the process down
  // mid-audit, so a request nobody can decode is simply a request for nothing.
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return undefined
  }

  const candidate = path.resolve(root, `.${path.posix.normalize(decoded)}`)

  // Traversal guard. The audited directory is the user's own build, but a
  // server that will follow ../../ out of its root is not one to ship.
  const relative = path.relative(root, candidate)
  if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined

  return candidate
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections()
    server.close(() => resolve())
  })
}
