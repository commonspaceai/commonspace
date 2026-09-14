# Release candidate acceptance record

Copy this file for each candidate. Do not carry a historical result forward as a current pass.

## Candidate identity

| Field | Value |
| --- | --- |
| Version/tag | |
| Exact commit | |
| Clean source (`git status --short`) | |
| Date/time and operator | |
| OS/version and architecture | |
| Node and pnpm versions | |
| Browser/version | |
| Codex version | Not run — replace with version or exact reason |
| Hermes version | Not run — replace with version or exact reason |
| Claude Code version | Not run — replace with version or exact reason |
| Gemini CLI version | Not run — replace with version or exact reason |
| OpenCode version | Not run — replace with version or exact reason |

Allowed results: `Pass`, `Fail`, or `Not run — <exact reason>`. Link local or CI evidence without copying credentials, transcripts, native session IDs, or private paths.

## Automated and package evidence

| Boundary | Command | Result | Evidence/notes |
| --- | --- | --- | --- |
| Static, unit/integration, Storybook, builds | `pnpm check` | | |
| Integrated production browser flows | `pnpm test:e2e` | | |
| Reviewed visual baselines | `pnpm test:visual` | | Record inspected states; do not regenerate silently |
| Production separate/installed serving smoke | `pnpm verify:live` | | |
| npm tarball creation | `pnpm build:npm` | | Record package name, version, and size |
| Clean npm command/startup/API/UI/shutdown/restart | `pnpm verify:npm-package` | | Record platform and shutdown method; Windows IPC does not prove console Ctrl+C |
| Windows source/platform/browser and candidate package | [Windows validation](../guides/windows-validation.md) | | Record Windows runner/build, architecture, exact commit, and Actions run URL |
| Exact release tarball on Windows | Release `windows-package` job | | Same artifact as Linux verification and npm publication |
| Mocked macOS service lifecycle | `pnpm verify:service` | | `launchctl` and health responses are substituted |
| Account-free pinned adapter fixtures | `pnpm verify:adapters` | | Focused rerun of tests included by `pnpm check`; real CLIs against local model fixtures |
| Provider routing quality | `pnpm verify:routing-quality` | | Record endpoint locality, provider/model/version, cases, and cost boundary |

## Real release acceptance

| Scenario | Result | Evidence/notes |
| --- | --- | --- |
| Add each authenticated supported Agent | | Record runtime identity/version; omit credentials |
| Project-scoped work with explicit and inferred references | | |
| Native permission request and exact choice | | |
| Failure, timeout, and retry recovery | | |
| Commonspace restart and exact native-session continuation | | |
| `pnpm verify:acp` | | Authenticated runtime/model access required |
| `pnpm verify:acp:mcp` | | Scoped context, progress, final reply |
| Export and HTTP import restoration with exact attachment bytes | | Use clean destination and explicit Project mappings |
| Credential files blocked in previews, tracked/deleted/renamed diffs, and attachments | | Include an in-root symlink alias; use synthetic credentials |
| Git preview and browser embedding protections | | Configured textconv/fsmonitor/filter commands remain unexecuted; installed HTML sends framing-denial headers |
| Candidate npm package startup on a clean machine | | Not established by repository-local smoke alone |
| Actual macOS service status, update, failed-update recovery, rollback | | |
| Windows terminal Ctrl+C, folder picker, native notifications and authenticated runtimes | | Record each result separately using the Windows guide; do not infer these from headless CI |

## Decision

- Release blockers:
- Known compatibility, migration, package-size, or performance implications:
- Checks not run and exact reasons:
- Approval and date:
