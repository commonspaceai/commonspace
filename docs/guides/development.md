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

### Focused iteration

During visual exploration, use the [Fast UI loop](#fast-ui-loop) below. For behavior changes, run the relevant test file while iterating. Use the change-specific requirements in [Contributing](../../CONTRIBUTING.md#verify) when the change is settled. Examples:

| Change                           | Focused check                                                                      | Evidence limit                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Server state or shared context   | `pnpm test tests/channel-context.spec.ts`                                          | Synthetic state transitions; use the test file that owns the changed behavior   |
| Routing contracts or dispatch    | `pnpm test tests/ai-router.spec.ts tests/commonspace-host.spec.ts`                 | Parsing and service mechanics, not live semantic routing quality                |
| UI component                     | `pnpm test:storybook:watch -- Conversation`                                        | Isolated interactions and accessibility; assembled behavior needs browser flows |
| ACP lifecycle                    | `pnpm test tests/acp-runtime.spec.ts`                                              | Protocol fixtures, not authenticated harness compatibility                      |
| Portable scripts or installation | `pnpm test:platform`                                                               | Account-free platform behavior; packaging also needs clean tarball verification |
| Documentation or templates       | Check relative links, referenced commands, Markdown syntax, and `git diff --check` | No application test run is required for prose-only changes                      |

The Node test workers disable native Web Storage so jsdom owns isolated browser storage. This keeps UI tests consistent across supported Node versions without writing browser-like state to a host storage file.

### Integration gates

Use these when preparing a settled change for handoff or release. They are not part of each visual edit:

| Command               | What it verifies                                                                                                                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check:fast`     | Formatting, lint, types, unit/integration tests, and representative Storybook browser tests for a broad code-iteration check                                                                                               |
| `pnpm check`          | The full local gate, including all Storybook browser tests and production application and Storybook builds                                                                                                 |
| `pnpm verify:live`    | A fresh production build and the integrated desktop browser flow through both separate development-style servers and the installed single-origin path                                                      |
| `pnpm check:ui`       | UI types, the complete Storybook browser suite, and the production UI build                                                                                                                                |
| `pnpm test:e2e`       | A production build followed by integrated Playwright application flows; use `test:e2e:built` after an already-current build                                                                                |
| `pnpm test:visual`    | Selected reviewed Storybook pixel baselines; changed images require inspection and explicit approval                                                                                                       |
| `pnpm verify:release` | The complete macOS release-candidate gate: locked install, managed browser, repository checks, visual and messaging suites, assembled browser flows, live verification, and clean npm-package installation |

The live verifier uses temporary workspace data and test runtimes. It proves production wiring without proving that an authenticated external agent works. Provider-backed harness checks are a separate opt-in step described below.

Use [Desktop usage](desktop-usage.md) for assembled flows and [Visual verification](../design/visual-verification.md) for rendered evidence.

`check:fast` is a broader iteration gate, not a replacement for `check`. `verify:live` and `test:e2e` exercise assembled behavior; use `verify:live:built` and `test:e2e:built` after a current build to avoid rebuilding the same candidate. Pixel baselines, authenticated runtime checks, routing-quality evaluation, and benchmarks answer separate questions and are not implied by green unit tests.

## Fast UI loop

Keep Storybook running while editing components:

```bash
pnpm storybook
```

Open `http://127.0.0.1:6006`. The development server is loopback-only, and fails instead of silently selecting another port. Stories use local fixtures, so they do not need the Commonspace API. Use **Workspace / Conversation** to explore the production app with a disposable mock workspace. Inspect changes through hot reload at 1440 × 960, including hover, focus, and Light/Dark states. Do not rebuild or run broad checks between visual edits.

For agent-assisted UI work, use the installed Storybook MCP addon at `http://127.0.0.1:6006/mcp`. The project connection lives in `.codex/config.toml`. Follow the required [MCP discovery, preview, and pixel-review loop](../design/visual-verification.md#storybook-mcp-workflow). Once an interaction is settled, run its focused story check. If MCP fails, follow that guide's recovery steps and record the failure before using a terminal fallback.

For a settled interaction, CI work, or the documented fallback, a terminal watcher accepts a story-file filter:

```bash
pnpm test:storybook:watch -- Conversation
```

This keeps Vitest, Vite, and Chromium alive between edits so related stories can
rerun without paying browser startup on every change. Press `q` to stop the
watcher. Browser-file parallelism is bounded by the host, with ceilings of four
workers locally and two in CI, to avoid making browser checks slower through
contention.

When the change is settled, the representative screen suite provides a quick integration check. `check:ui` adds UI types, the full Storybook suite, and a production UI build:

```bash
pnpm test:storybook:smoke
pnpm check:ui
```

These commands do not replace the change-specific handoff requirements in [Contributing](../../CONTRIBUTING.md#verify). Storybook's Vitest suite checks rendering, interactions, and accessibility in a real browser. Pixel comparisons use `pnpm test:visual`; visual acceptance still requires inspecting the images.

Use the Light / Dark toolbar to inspect the actual rendering, including overlays. Follow [Visual verification](../design/visual-verification.md) for Storybook states, screenshot review, and baseline changes. Keep component permutations in Storybook and use `verify:live` for behavior that depends on the assembled application.

## Self-development hot reload

A stable supervisor watches `server/src` and `packages/shared/src`. After an edit, the running server keeps its agent processes and context endpoint alive until all accepted turns finish. Multiple edits during active work become one restart. The browser reconnects after the replacement server is healthy.

The server continues accepting work while waiting, so continuous activity can delay a reload. `SIGINT` and `SIGTERM` are explicit shutdowns: they cancel active work rather than wait for this idle boundary.

## CI and service verification

CI starts quality/package, unit, Linux browser, macOS visual/messaging, and Windows runtime jobs independently. Only the small Linux-package-on-Windows job waits for the Linux tarball. The **Required CI gate** succeeds after all six component jobs pass and is the sole branch-protection context. The Windows runtime job runs `pnpm test:platform`, Storybook smoke, production browser flows, and live verification; the downstream package job installs the exact Linux-built tarball that a release would publish. The complete unit/runtime suite remains on Linux. See [Windows validation](windows-validation.md) for PowerShell commands and evidence limits. [Maintaining](maintaining.md#configure-github) owns the protected-branch configuration and verification procedure.

CI and local browser checks install/use Playwright's managed Chromium unless `COMMONSPACE_USE_SYSTEM_CHROME=1` is set.

### macOS service and notifications

Normal development does not register a background service. To exercise source-based macOS installation, use `pnpm service:install` with a committed `main` checkout. The service commands and managed paths are documented in [Operations](operations.md#installed-macos-service).

On macOS, `pnpm verify:notifications` checks whether the native notifier accepts a safe test alert. Use **Send test notification** in Workspace settings to check visible delivery and follow any operating-system guidance.

## Workspace benchmarks

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

Use the [adapter proposal template](../adapters/agent-adapter-template.md) when adding a harness. The [adapter guide](../adapters/agent-adapters.md#verification-commands) lists account-free fixtures and authenticated native-session checks. Run the checks relevant to the changed runtime; fixture results do not establish provider-backed compatibility.

Parser and service tests establish routing contracts; they do not measure model decomposition quality or harness latency. Evaluate those properties through an added test Agent using synthetic conversation history, record the runtime/model/version and results, and never turn a mocked JSON parser test into a routing-quality claim.

Run `pnpm evaluate:routing` to check six plain-language Frontend/Backend requests through the real Codex ACP router: independent work reaches both agents, dependent work follows the requested order in either direction, and a background mention does not add a recipient. The test compares exact recipients, delivery mode, relay order, and Project scope. It requires an authenticated Codex installation, reuses one ACP bridge with fresh sessions, and closes the bridge after the suite. Normal `pnpm test` skips these provider-backed cases.

### Local classifier evaluation

Build the worker and evaluate routing with the local model:

```bash
pnpm --filter commonspace build
pnpm evaluate:classifier
```

The evaluator runs the synthetic corpus sequentially, reports accepted routes, errors, and latency, and fails on an incorrect accepted route or zero accepted routes. It does not invoke the inference Agent. Pass an optional cache directory after `evaluate:classifier` to isolate model files. Validate model or prompt changes with fresh examples as well as the regression corpus.
