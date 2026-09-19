# Security policy

Report suspected security problems privately. Do not put vulnerability details, credentials, or private workspace data in a normal issue.

## Send a private report

Use [Security → Report a vulnerability](https://github.com/commonspaceai/commonspace/security/advisories/new). If that form is unavailable, ask the repository owner for a confidential reporting route. Keep vulnerability details out of GitHub issues.

Include:

- the affected Commonspace release or Git commit;
- your operating system and Node.js version;
- the smallest reproduction you can provide without private data;
- the possible impact and any workaround you have found.

Do not attach workspace state, credential stores, or agent transcripts unless a maintainer requests them through the private reporting channel.

## Supported versions

Security fixes target `main` and the latest release. Older versions do not have a separate backport commitment. Follow the affected-version and upgrade guidance in security advisories; response times are not guaranteed.

## How Commonspace protects local data

- The server listens only on `127.0.0.1`. Requests that change data must pass the same-origin browser checks.
- Project folders are resolved to their real filesystem locations before they are passed to an agent.
- Agent commands run without a shell, with limits on input, output, and execution time.
- Commonspace stores references to agent sessions. The agents retain their own credentials and session stores.
- Project File previews, human file uploads, and agent-generated file imports block known credential-bearing filenames and private-key extensions. This policy checks filenames; it does not inspect file contents for secrets.
- Commonspace stores only the selected inference Agent ID. Authentication remains in the selected harness and its native credential store.
- Unsafe agent modes are off by default and require explicit environment variables.

These protections do not make Commonspace a secret manager or every Project file safe to share. Agents may read files and contact model services according to their permissions and provider settings. Keep secrets out of messages, screenshots, and files you ask agents to inspect.

See [Operations](docs/guides/operations.md) for local storage, configuration, and recovery details.
