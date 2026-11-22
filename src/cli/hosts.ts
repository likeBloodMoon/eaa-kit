/**
 * The CI systems `init` writes a pipeline for.
 *
 * On their own so the command line can list them in `--help` without loading
 * the project detection that writing a pipeline needs.
 */
export const CI_HOSTS = ['github', 'gitlab', 'bitbucket'] as const
export type CiHost = (typeof CI_HOSTS)[number]

/** How each host's pipeline is named to a person. */
export const CI_HOST_NAMES: Record<CiHost, string> = {
  github: 'GitHub Actions workflow',
  gitlab: 'GitLab CI job',
  bitbucket: 'Bitbucket Pipelines step',
}
