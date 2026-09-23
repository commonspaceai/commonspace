# Contributing to Commonspace

You can help by reporting a problem, improving a guide, or sending a focused fix. Normal development and fixture tests do not require agent credentials.

## Choose a starting point

- **Improve the docs:** find the page in the [documentation index](docs/README.md), then choose **Edit this file** on GitHub to propose a correction. Explain what was confusing and check its links and commands. You do not need to run the app build for a docs-only change.
- **Report a bug:** [search existing issues](https://github.com/commonspaceai/commonspace/issues), then [file a report](https://github.com/commonspaceai/commonspace/issues/new?template=bug_report.yml) with steps to reproduce, expected behavior, and your version and OS.
- **Change code:** check [issues](https://github.com/commonspaceai/commonspace/issues) and [pull requests](https://github.com/commonspaceai/commonspace/pulls) for related work. Agree on the problem and approach before starting a larger feature. Keep one logical change per pull request.

For code changes, use the [Product specification](docs/specs/product-spec.md) for behavior, [Architecture](docs/guides/architecture.md) to find the owning package, and [Development](docs/guides/development.md) for commands. Read the sections relevant to your change.

## Set up

Clone your fork, add `commonspaceai/commonspace` as the upstream remote, and follow [Development setup](docs/guides/development.md#setup).

## Make the change

1. State the user problem, owning package, product rule, and verification plan.
2. Add a focused failing test for behavior changes; explain when existing coverage is sufficient.
3. Make the smallest change that solves the problem, following the [simplicity rules](AGENTS.md#simplicity).
4. Update affected consumers, saved-data migrations, tests, and canonical documentation together.
5. Review the complete diff, including generated files. Remove unnecessary mechanisms and explain why any material added complexity is needed under the [simplicity rules](AGENTS.md#simplicity).

Preserve local serving, request validation, private session data, exact native-session continuity, and the boundaries in [Architecture](docs/guides/architecture.md).

## Verify

Choose checks based on what changed:

| Change                                            | Required evidence                                                          |
| ------------------------------------------------- | -------------------------------------------------------------------------- |
| Shared types, server, saved data, or security     | Focused regression test, `pnpm check`, and `pnpm verify:live`              |
| UI component or screen                            | Storybook states, behavior checks, `pnpm check`, and desktop inspection    |
| Packaging, installation, dependencies, or release | Focused checks and the complete macOS `pnpm verify:release` candidate gate |
| Documentation or templates only                   | Links, commands, Markdown syntax, and `git diff --check`                   |

For a code change, start with the relevant focused test. Once the change is settled, run its required integration checks. For example:

```bash
pnpm test tests/channel-context.spec.ts
pnpm check
git diff --check
```

Replace the example test with the relevant file and add `pnpm verify:live` for shared, server, saved-data, or security changes. Docs-only changes use the last table row; they do not require this code-check sequence.

Use [Visual verification](docs/design/visual-verification.md) while iterating on UI and [Releasing](docs/guides/releasing.md) for candidate checks. Real-agent and real-service checks are additional; record what ran and what did not.

## Pull requests

Explain the problem, resulting behavior, changed files, checks and skipped checks, visible-change evidence, and migration/security/compatibility risks. Disclose the AI provider and exact model, or write `None, human-authored`.

Use descriptive branch names and conventional commits. Mark unfinished work as draft. Merge requires passing required CI, resolved substantive feedback, and maintainer approval.

## Documentation and privacy

Put detailed rules in their canonical reference. Avoid repeating instructions across pages. Distinguish supported behavior, planned work, and verification that still needs to run.

Use synthetic data. Never commit workspace state, credentials, native sessions, private paths, generated builds, npm tarballs, or browser artifacts. Follow [Security](SECURITY.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).
