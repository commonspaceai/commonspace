# Development guide

Use this guide to run Commonspace from source, choose the right verification loop, and change shared or runtime behavior safely. Start with [Contributing](../../CONTRIBUTING.md) for the contribution process and [Installation](../start/install.md) if you only want to run the application.

## Setup

Use Node.js 22.13+ or 24+, Git, and the pnpm version pinned by `packageManager` in [`package.json`](../../package.json). Corepack can provide that pnpm version.

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open the UI at `http://127.0.0.1:5173`. The API runs at `http://127.0.0.1:3100`. Vite forwards `/api` requests to the server, so browser code uses relative, same-origin API paths. The development API server does not serve the browser application; use the Vite URL.

A new workspace starts empty. Agent credentials are optional for application development: unit tests, Storybook, and the standard live verifier do not require an authenticated harness. Use `COMMONSPACE_HOME` to keep development data separate from an existing workspace; see [runtime configuration](operations.md#runtime-configuration).

Install the browser used by local checks after installing dependencies:

```bash
pnpm exec playwright install chromium
```

Read [Architecture](architecture.md) for package ownership before a change that crosses boundaries.

## Development workflow

1. Describe the user-visible problem, the product rule involved, and the owning boundary.
2. For behavior changes, add a focused failing test that demonstrates the missing behavior. For visual-only changes, identify the Storybook states and desktop interactions that need review.
3. Implement the smallest change and rerun the focused verification.
4. Update the affected user and developer documentation.
5. Run the complete local check. Run the live verifier for server or visible end-to-end changes.

```bash
pnpm check
pnpm verify:live
```

Choose checks by the evidence you need:

| Command | What it verifies |
| --- | --- |
| `pnpm check:fast` | Formatting, lint, types, unit/integration tests, and representative Storybook browser tests during iteration |
| `pnpm check` | The full local gate, including all Storybook browser tests and production application and Storybook builds |
| `pnpm verify:live` | A fresh production build and the integrated desktop browser flow through both separate development-style servers and the installed single-origin path |
| `pnpm check:ui` | UI types, the complete Storybook browser suite, and the production UI build |
| `pnpm test:e2e` | A production build followed by integrated Playwright application flows; use `test:e2e:built` after an already-current build |
| `pnpm test:visual` | Selected reviewed Storybook pixel baselines; changed images require inspection and explicit approval |

The live verifier uses temporary workspace data and test runtimes. It proves production wiring without proving that an authenticated external agent works. Provider-backed harness checks are a separate opt-in step described below.

For the desktop flows documented in [Using the desktop workspace](desktop-usage.md), use these focused checks during iteration:

```bash
pnpm exec vitest run tests/desktop-usability.spec.tsx
pnpm test:storybook -- CommonspaceSearch RunDelivery CommonspaceApp
pnpm test:e2e
```

The unit regressions protect native-control appearance and queue focus recovery. Storybook covers search error retry with preserved filters, keyboard queue mutations, unavailable delivery controls, and isolated screen states. Assembled browser tests cover routing/deep links, settings focus and save recovery, and Light/Dark/System changes across reloads. Run the complete `pnpm check` and `pnpm verify:live` after focused checks pass; inspect their rendered evidence before claiming visual acceptance.

## Fast UI loop

Run Storybook while editing components:

```bash
pnpm storybook
```

Open `http://127.0.0.1:6006`. The development server is loopback-only, and fails instead of silently selecting another port. Stories use local fixtures, so they do not need the Commonspace API. The testing panel can rerun the selected story's interactions and accessibility checks after an edit.

For a focused terminal loop, pass a story-file filter:

```bash
pnpm test:storybook:watch -- Conversation
```

Use the representative screen suite for a quick check, then the full UI gate before handing off visible work:

```bash
pnpm test:storybook:smoke
pnpm check:ui
```

Storybook's Vitest suite checks rendering, interactions, and accessibility in a real browser. The watch command reruns the explicit one-shot browser suite when story source or Storybook configuration changes, and its runner removes package-manager separators so forwarded file and test-name filters stay attached to Vitest. Pixel comparisons use the separate `pnpm test:visual` command, which builds Storybook and serves that exact static output on an isolated loopback server before checking that every baseline points to the expected story metadata. The optional Chromatic integration also needs a configured project; it is not required for the local workflow.

Use the Light / Dark toolbar to inspect the actual rendering, including overlays. Follow [Visual verification](../design/visual-verification.md) for Storybook states, screenshot review, and baseline changes. Keep component permutations in Storybook and use `verify:live` for behavior that depends on the assembled application.

## Self-development hot reload

A stable supervisor watches `server/src` and `packages/shared/src`. After an edit, the running server keeps its agent processes and context endpoint alive until all accepted turns finish. Multiple edits during active work become one restart. The browser reconnects after the replacement server is healthy.

The server continues accepting work while waiting, so continuous activity can delay a reload. `SIGINT` and `SIGTERM` are explicit shutdowns: they cancel active work rather than wait for this idle boundary.

## CI and service verification

CI runs static/build checks, unit/integration tests, Storybook browser checks, integrated Playwright E2E, reviewed macOS visual baselines, and a Windows platform job. The aggregate `check` job succeeds only when all five jobs pass. The Windows job runs the focused `pnpm test:platform` suite, Storybook smoke, production browser flows, and npm build/install smoke; the complete unit/runtime suite remains on Linux. See [Windows validation](windows-validation.md) for PowerShell commands and evidence limits. GitHub enforces `check` as a merge requirement only after a maintainer configures branch protection; see [Maintaining](maintaining.md).

CI and local browser checks install/use Playwright's managed Chromium unless `COMMONSPACE_USE_SYSTEM_CHROME=1` is set.

Workspace-scale measurements are opt-in and never part of the normal test gate:

```bash
pnpm benchmark:workspace
COMMONSPACE_BENCHMARK_SIZES=1000,10000,20000 pnpm benchmark:workspace
COMMONSPACE_BENCHMARK_REPETITIONS=5 pnpm benchmark:workspace
```

The benchmark discards one warm-up, then runs three measured samples per size by default. It seeds progressively larger synthetic DM transcripts and reports message acceptance/persistence, bootstrap payload and processing, search, export/import, and process heap/RSS deltas as JSON. Run it on an otherwise idle machine and record Node, operating system, CPU architecture, size list, repetition count, dispersion, and raw output with any performance claim.

Normal development does not register a background service. To exercise source-based macOS installation, use `pnpm service:install` with a committed `main` checkout. The service commands and managed paths are documented in [Operations](operations.md#installed-macos-service).

## npm packaging

Build and verify the same npm tarball used by the release workflow:

```bash
pnpm build:npm
pnpm verify:npm-package
```

`build:npm` bundles Commonspace-owned runtime code, copies the built UI, and writes one ignored tarball under `artifacts/npm/`. External packages remain ordinary npm dependencies. The verifier installs the tarball in a clean temporary prefix and runs it outside the source checkout without agent credentials. See [Installation](../start/install.md) and [Releasing](../releases/releasing.md).

## Contract changes

`packages/shared` owns every shape exchanged between the server and UI. Update the shared contract, all consumers, tests, and documentation together.

When a persisted shape changes:

1. Increment `COMMONSPACE_STATE_VERSION` when compatibility changes.
2. Validate and sanitize every field loaded from disk.
3. Migrate during initialization and persist the migrated result.
4. Remove host-private paths and native-session references from browser snapshots.
5. Cover malformed state, migration, and recovery with focused tests.
6. Update [Architecture](architecture.md) and [Operations](operations.md).

## Agent runtime changes

The server owns Agent Client Protocol (ACP) integration. ACP connects Commonspace to a supported local harness and reports its session capabilities, activity, and permission choices. Commonspace must reflect those reports without inventing capabilities or changing provider-specific profiles.

Keep activity provider-neutral, bounded, and based only on emitted ACP updates. Runtime-specific credentials, configuration, and native transcripts remain owned by each native harness.

`pnpm verify:adapters` checks real Claude Code, Gemini CLI, and OpenCode runtimes against local model API fixtures without an account, including native restart/resume for Claude Code and OpenCode, safe Gemini reload rejection with preserved work, fresh context, scoped MCP, and progress. These checks also run in the standard test suite. Individual commands are `verify:adapter:claude-code`, `verify:adapter:gemini`, and `verify:adapter:opencode`. See the [adapter guide](../adapters/agent-adapters.md#account-free-runtime-verification).

Provider-backed harness checks use local credentials and model access, so run only those relevant to the integration being changed:

```bash
pnpm verify:acp:hermes
pnpm verify:acp:codex
pnpm verify:acp:claude-code
pnpm verify:acp:mcp
```

Parser and service tests establish routing contracts; they do not measure model decomposition quality. To evaluate a configured OpenAI-compatible provider against representative cross-responsibility cases with exact constraint tokens and Project scopes, set `COMMONSPACE_ROUTING_BASE_URL`, `COMMONSPACE_ROUTING_MODEL`, and optional `COMMONSPACE_ROUTING_API_KEY`, then run:

```bash
pnpm verify:routing-quality
```

This opt-in evaluation may call a remote model and incur provider cost. Record provider/model/version and results; do not turn a mocked JSON parser test into a routing-quality claim.

The first three check native session startup and resumption. The MCP check also requires real harnesses to read scoped context and post visible progress. These checks complement deterministic tests; they do not replace them.

The Codex live checks honor `COMMONSPACE_CODEX_PATH` when testing a particular installed CLI. Use a complete runtime installation, including its Code Mode companion when that feature is enabled. The selected CLI must support the model configured in its native settings; an authenticated but outdated CLI can still fail model requests.

On macOS, `pnpm verify:notifications` checks whether the native notifier accepts a safe test alert. Use **Send test notification** in Workspace settings to check visible delivery and follow any operating-system guidance.

Follow the [agent adapter guide](../adapters/agent-adapters.md) and [proposal template](../adapters/agent-adapter-template.md) when adding a harness. Claude Code checks honor `COMMONSPACE_CLAUDE_CODE_PATH`; `pnpm verify:acp:claude-code` checks native recall after service restart, and `pnpm verify:acp:mcp:claude-code` checks scoped context and progress.
