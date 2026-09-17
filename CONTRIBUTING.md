# Contributing to Commonspace

Bug fixes, features, tests, documentation, and focused improvements are welcome. Read the page that owns your work: [Product model](docs/specs/product.md), [Development](docs/guides/development.md), or [Operations](docs/guides/operations.md).

## Before editing

Search existing issues and pull requests. For a larger feature or product-model change, agree on the user problem and approach with a maintainer first. Keep one logical change per pull request.

Read the relevant [Product specification](docs/specs/product-spec.md), [Architecture](docs/guides/architecture.md), and [Development guide](docs/guides/development.md). Keep behavior in its existing owner; do not add a second product object or implementation path for the same rule.

## Set up

Clone your fork, add `commonspaceai/commonspace` as the upstream remote, and follow [Development setup](docs/guides/development.md#setup).

## Make the change

1. State the user problem, owning package, product rule, and verification plan.
2. Add a focused failing test for behavior changes; explain when existing coverage is sufficient.
3. Make the smallest change that solves the problem.
4. Update affected consumers, saved-data migrations, tests, and canonical documentation together.
5. Review the complete diff, including generated files.

Preserve local serving, request validation, private session data, exact native-session continuity, and the boundaries in [Architecture](docs/guides/architecture.md).

## Verify

Use the smallest check that proves the change. Replace the example test with the relevant file:

```bash
pnpm test tests/channel-context.spec.ts
pnpm check
git diff --check
```

| Change | Required evidence |
| --- | --- |
| Shared types, server, saved data, or security | Focused regression test, `pnpm check`, and `pnpm verify:live` |
| UI component or screen | Storybook states, behavior checks, `pnpm check`, and desktop inspection |
| Packaging, installation, dependencies, or release | Focused checks, `pnpm check`, `pnpm package:npm`, and `pnpm verify:npm-package` |
| Documentation or templates only | Links, commands, Markdown syntax, and `git diff --check` |

Use [Visual verification](docs/design/visual-verification.md) for rendered UI review and [Releasing](docs/guides/releasing.md) for candidate checks. Real-agent and real-service checks are additional; record what ran and what did not.

## Pull requests

Explain the problem, resulting behavior, changed files, checks and skipped checks, visible-change evidence, and migration/security/compatibility risks. Disclose the AI provider and exact model, or write `None, human-authored`.

Use descriptive branch names and conventional commits. Mark unfinished work as draft. Merge requires passing required CI, resolved substantive feedback, and maintainer approval.

## Documentation and privacy

Put detailed rules in their canonical reference. Avoid repeating instructions across pages. Distinguish supported behavior, planned work, and verification that still needs to run.

Use synthetic data. Never commit workspace state, credentials, native sessions, private paths, generated builds, npm tarballs, or browser artifacts. Follow [Security](SECURITY.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).
