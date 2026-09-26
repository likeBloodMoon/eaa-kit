import path from 'node:path'
import pc from 'picocolors'
import type { ProjectDetection } from '../audit/detect.ts'

/**
 * `eaa-kit detect`.
 *
 * What the tool makes of this project, and the evidence for each part of it,
 * without building, starting or auditing anything. The answer to "why did it
 * audit that?" before the question has to be asked, and the thing to paste
 * into an issue when the answer is wrong.
 */

export interface DetectCommandOptions {
  /** Print the detection as JSON, for tools and for bug reports. */
  json?: boolean
  /** Colour. Defaults to whatever picocolors detects for this terminal. */
  color?: boolean
}

export async function runDetectCommand(
  dir: string | undefined,
  options: DetectCommandOptions = {},
): Promise<string> {
  const { detectProject } = await import('../audit/detect.ts')
  const detection = await detectProject(path.resolve(dir ?? '.'))
  return options.json
    ? `${JSON.stringify(detection, null, 2)}\n`
    : formatDetection(detection, options)
}

export function formatDetection(
  detection: ProjectDetection,
  options: DetectCommandOptions = {},
): string {
  const colors = pc.createColors(options.color ?? pc.isColorSupported)
  const lines: string[] = []
  const row = (label: string, value: string, why?: string): void => {
    lines.push(
      `${label.padEnd(16)} ${value}${why === undefined ? '' : `  ${colors.dim(`(${why})`)}`}`,
    )
  }

  const framework = detection.framework
  row(
    'Framework',
    framework?.name ?? 'none recognised',
    framework === undefined ? undefined : framework.evidence.join('; '),
  )
  if (detection.packageManager !== undefined) {
    row('Package manager', detection.packageManager.name, detection.packageManager.evidence)
  }
  if (detection.workspace !== undefined) {
    row(
      'Monorepo',
      detection.workspace.sites.map((site) => `${site.dir} (${site.framework})`).join(', '),
      detection.workspace.evidence,
    )
  }
  const inner = detection.site ?? detection
  if (inner.site === undefined && detection.site !== undefined) {
    row(
      'Site framework',
      inner.framework?.name ?? 'none recognised',
      inner.framework?.evidence.join('; '),
    )
  }
  if (inner.directory !== undefined) row('Build output', `${inner.directory}/`)
  if (inner.next !== undefined) {
    const { pages, dynamic } = inner.next
    row(
      'Next.js pages',
      `${pages} listed by the build`,
      dynamic.length === 0 ? undefined : `not listed, rendered on request: ${dynamic.join(', ')}`,
    )
  }
  lines.push('')
  lines.push(`${colors.bold('An audit would')} ${detection.summary}.`)

  const next = nextCommand(detection)
  if (next !== undefined) lines.push(`  ${colors.cyan('→')} ${colors.bold(next)}`)
  return `${lines.join('\n')}\n`
}

/** The command to type next, given what was found. */
function nextCommand(detection: ProjectDetection): string | undefined {
  const inner = detection.site ?? detection
  if (detection.plan === 'choose-site') {
    const first = detection.workspace?.sites[0]?.dir
    return first === undefined ? undefined : `cd ${first} && npx eaa-kit detect`
  }
  if (inner.appShell) return 'npx eaa-kit audit --browser'
  switch (inner.plan) {
    case 'audit-build':
    case 'build':
    case 'build-and-serve':
    case 'serve':
      return 'npx eaa-kit'
    case 'url':
      return 'npx eaa-kit audit --url http://localhost:8000'
    default:
      return inner.build ?? 'npx eaa-kit audit ./path/to/build'
  }
}
