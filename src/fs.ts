import { stat } from 'node:fs/promises'
import path from 'node:path'

/**
 * Asking the filesystem a yes-or-no question.
 *
 * Six modules had their own copy of the same try/stat/catch, each answering a
 * slightly different question and each getting it right by hand. A path that
 * cannot be stat'd is not a path of the kind asked about, which is the only
 * behaviour any caller here wants from an unreadable directory.
 */

/** Whether anything is there, resolved against `root` when one is given. */
export async function exists(target: string, root?: string): Promise<boolean> {
  try {
    await stat(root === undefined ? target : path.resolve(root, target))
    return true
  } catch {
    return false
  }
}

export async function isFile(target: string | URL): Promise<boolean> {
  try {
    return (await stat(target)).isFile()
  } catch {
    return false
  }
}

export async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory()
  } catch {
    return false
  }
}

/** Platform-native separators to POSIX, so paths in reports match everywhere. */
export function toPosix(filePath: string): string {
  return filePath.split(path.sep).join('/')
}
