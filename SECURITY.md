# Security policy

## Supported versions

Security fixes go into the latest minor release only. eaa-kit is still 0.x, so upgrading
from one minor version to the next is how you get a fix; there are no backports.

| Version | Supported |
| --- | --- |
| 0.11.x | Yes |
| Older | No |

## Reporting a vulnerability

Please report it privately through GitHub: open the repository's **Security** tab and
choose **Report a vulnerability**. That opens a private advisory that only the maintainer
can see. Do not open a public issue or pull request for it.

Include what you can of:

- the version (`eaa-kit --version`) and how you ran it (CLI, GitHub Action, a build
  integration, or the library);
- what an attacker controls, such as the site being audited, a sitemap, a repository's
  files, or a config file, and what they gain;
- a way to reproduce it. A small HTML page or a few commands is ideal.

You should get an answer within seven days. Once the problem is confirmed, the fix is
released as soon as it is ready, and the advisory is published with the release. You will
be credited in it unless you would rather not be.

## What counts

eaa-kit fetches pages from sites it is pointed at, parses markup nobody has vetted, starts
a project's build and server, and runs inside CI with credentials in its environment. These
are in scope:

- anything that sends `--header` or `--basic-auth` credentials somewhere other than the
  audited site, or writes them to disk, a report or a log;
- a crawl that reaches a host it was not allowed to, such as a remote host without
  `--allow-remote`, or another origin through a redirect;
- markup, a sitemap or a robots.txt that makes the tool hang, run out of memory or crash;
- a report (HTML, Markdown, SARIF, JSON) or a statement that lets audited content run
  script or inject markup where the report is opened or published;
- a way for repository content to run commands that `--no-build` or the documentation says
  will not run;
- anything in the GitHub Action that lets workflow inputs or audited content run commands.

Out of scope: a project's own build and server running when you audit it without
`--no-build` (that is the documented behaviour, announced before it happens), findings that
are wrong but not exploitable (please open an ordinary issue), and vulnerabilities in a
dependency that eaa-kit does not reach.

The documentation site has its own repository,
[eea-kit-web](https://github.com/likeBloodMoon/eea-kit-web). Report problems with its
audit-a-URL tool there, the same way.
