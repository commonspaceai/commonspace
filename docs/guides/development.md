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

## Verification commands

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

Use [Desktop usage](desktop-usage.md) for assembled flows and [Visual verification](../design/visual-verification.md) for rendered evidence.

### Focused iteration

Run a relevant file while iterating, then use the change-specific requirements in [Contributing](../../CONTRIBUTING.md#verify) before handing off. Examples:

| Change | Focused check | Evidence limit |
| --- | --- | --- |
| Server state or shared context | `pnpm test tests/channel-context.spec.ts` | Synthetic state transitions; use the test file that owns the changed behavior |
| Routing contracts or dispatch | `pnpm test tests/ai-router.spec.ts tests/commonspace-host.spec.ts` | Parsing and service mechanics, not live semantic routing quality |
| UI component | `pnpm test:storybook:watch -- Conversation` | Isolated interactions and accessibility; assembled behavior needs browser flows |
| ACP lifecycle | `pnpm test tests/acp-runtime.spec.ts` | Protocol fixtures, not authenticated harness compatibility |
| Portable scripts or installation | `pnpm test:platform` | Account-free platform behavior; packaging also needs clean tarball verification |
| Documentation or templates | Check relative links, referenced commands, Markdown syntax, and `git diff --check` | No application test run is required for prose-only changes |

`check:fast` is a broader iteration gate, not a replacement for `check`. `verify:live` and `test:e2e` exercise assembled behavior; use `verify:live:built` and `test:e2e:built` after a current build to avoid rebuilding the same candidate. Pixel baselines, authenticated runtime checks, routing-quality evaluation, and benchmarks answer separate questions and are not implied by green unit tests.

The Node test workers disable native Web Storage so jsdom owns isolated browser storage. This keeps UI tests consistent across supported Node versions without writing browser-like state to a host storage file.

## Fast UI loop

Run Storybook while editing components:

```bash
pnpm storybook
```

Open `http://127.0.0.1:6006`. The development server is loopback-only, and fails instead of silently selecting another port. Stories use local fixtures, so they do not need the Commonspace API. The testing panel can rerun the selected story's interactions and accessibility checks after an edit.

For agent-assisted UI work, use the installed Storybook MCP addon at `http://127.0.0.1:6006/mcp`. The project connection lives in `.codex/config.toml`. Follow the required [MCP discovery, test, preview, and pixel-review loop](../design/visual-verification.md#storybook-mcp-workflow); terminal tests below remain useful for CI and as an explicit fallback when MCP is unavailable.

For a focused terminal loop, pass a story-file filter:

```bash
pnpm test:storybook:watch -- Conversation
```

Use the representative screen suite for a quick check, then the full UI gate before handing off visible work:

```bash
pnpm test:storybook:smoke
pnpm check:ui
```

Storybook's Vitest suite checks rendering, interactions, and accessibility in a real browser. Pixel comparisons use `pnpm test:visual`.

Use the Light / Dark toolbar to inspect the actual rendering, including overlays. Follow [Visual verification](../design/visual-verification.md) for Storybook states, screenshot review, and baseline changes. Keep component permutations in Storybook and use `verify:live` for behavior that depends on the assembled application.

## Self-development hot reload

A stable supervisor watches `server/src` and `packages/shared/src`. After an edit, the running server keeps its agent processes and context endpoint alive until all accepted turns finish. Multiple edits during active work become one restart. The browser reconnects after the replacement server is healthy.

The server continues accepting work while waiting, so continuous activity can delay a reload. `SIGINT` and `SIGTERM` are explicit shutdowns: they cancel active work rather than wait for this idle boundary.

## CI and service verification

CI runs static/build checks, unit/integration tests, Storybook browser checks, integrated Playwright E2E, reviewed macOS visual baselines, and a Windows platform job. The aggregate `check` job succeeds only when all five jobs pass. The Windows job runs the focused `pnpm test:platform` suite, Storybook smoke, production browser flows, and npm build/install smoke; the complete unit/runtime suite remains on Linux. See [Windows validation](windows-validation.md) for PowerShell commands and evidence limits. The default branch requires the aggregate `check`; [Maintaining](maintaining.md#configure-github) owns the configuration and verification procedure.

CI and local browser checks install/use Playwright's managed Chromium unless `COMMONSPACE_USE_SYSTEM_CHROME=1` is set.

Workspace-scale measurements are opt-in and never part of the normal test gate:

```bash
pnpm benchmark:workspace
COMMONSPACE_BENCHMARK_SIZES=1000,10000,20000 pnpm benchmark:workspace
COMMONSPACE_BENCHMARK_REPETITIONS=5 pnpm benchmark:workspace
COMMONSPACE_BENCHMARK_SHAPES=dm pnpm benchmark:workspace
```

The benchmark runs the original long DM and a multi-Channel workspace at equal seeded message counts. The second shape has four Channels, three agents, three Projects, mixed Thread lengths, multi-Project messages, routing receipts/corrections, context, tool activity, pins, and real 4 KiB managed attachments. `COMMONSPACE_BENCHMARK_SHAPES` selects `dm`, `multi-channel`, or both (the default).

It discards one warm-up per shape, then runs three measured samples per size by default. The original initialization, acceptance/persistence, bootstrap, broad search, export, and import timings remain separate. Additional timings cover Project-filtered message search and context projection/compaction prompt preparation for the busiest Channel and its longest Thread. Payload/archive serialization contributes reported sizes, outside those operation timings. Workers are synthetic; acceptance uses explicit routing and reply completion is outside its timing. No providers or native sessions are invoked.

JSON includes the base commit and changed-file list, benchmark source hashes, machine/runtime details, seeded/measured/restored counts, raw samples, and min/median/max dispersion. Heap/RSS values are operation deltas, not peaks or retained memory. Run on an otherwise idle machine and retain the raw output with any performance claim. These service-level measurements do not cover browser rendering/reconnect, HTTP transfer, concurrent streaming, large attachments, or separate routing-resolution/reply writes; measure those before making architecture decisions about them.

Normal development does not register a background service. To exercise source-based macOS installation, use `pnpm service:install` with a committed `main` checkout. The service commands and managed paths are documented in [Operations](operations.md#installed-macos-service).

## npm packaging

Build and verify the same npm tarball used by the release workflow:

```bash
pnpm build:npm
pnpm verify:npm-package
```

`build:npm` bundles Commonspace-owned runtime code, copies the built UI, and writes one ignored tarball under `artifacts/npm/`. External packages remain ordinary npm dependencies. The verifier installs the tarball in a clean temporary prefix and runs it outside the source checkout without agent credentials. See [Installation](../start/install.md) and [Releasing](releasing.md).

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

Use the [adapter guide](../adapters/agent-adapters.md#verification-commands) for account-free fixtures and authenticated native-session checks. Run the checks relevant to the changed runtime; fixture results do not establish provider-backed compatibility.

Parser and service tests establish routing contracts; they do not measure model decomposition quality. To evaluate a configured OpenAI-compatible provider against representative cross-responsibility cases with exact constraint tokens and Project scopes, set `COMMONSPACE_ROUTING_BASE_URL`, `COMMONSPACE_ROUTING_MODEL`, and optional `COMMONSPACE_ROUTING_API_KEY`, then run:

```bash
pnpm verify:routing-quality
```

For the live Jev greeting-versus-project-continuation regression, set `TYPESAFE_API_KEY` and run `COMMONSPACE_ROUTING_EVAL=1 COMMONSPACE_ROUTING_JEV_MODEL=jev-1.13.0 pnpm test tests/live-jev-routing.spec.ts`. This calls the real TypeSafe endpoint with synthetic conversation history; normal test runs skip it.

This opt-in evaluation may call a remote model and incur provider cost. Record provider/model/version and results; do not turn a mocked JSON parser test into a routing-quality claim.

On macOS, `pnpm verify:notifications` checks whether the native notifier accepts a safe test alert. Use **Send test notification** in Workspace settings to check visible delivery and follow any operating-system guidance.

Use the [adapter proposal template](../adapters/agent-adapter-template.md) when adding a harness.
