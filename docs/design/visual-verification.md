# Visual verification

Use this guide to review a desktop UI change from interaction through rendered appearance. Automated checks can establish that a control works, but visual acceptance also requires inspecting what the user sees.

Review against the Commonspace [design contract](../../DESIGN.md). Keep desktop as the active target, and check both Light and Dark appearance when a change affects colors or surfaces.

## Three checks

A UI change needs evidence for three different questions:

| Check | Question | Evidence |
| --- | --- | --- |
| Journey | Can the user reach the intended state? | A real browser completes the relevant actions. |
| Mechanics | Does the interaction remain usable? | Focus, overflow, clipping, overlays, and transitions behave correctly. |
| Appearance | Does the rendered state meet the design contract? | The actual pixels have been inspected and any required fixes resolved. |

A screenshot path, DOM snapshot, or passing behavior test alone does not satisfy the appearance check. If the pixels could not be reviewed, record that check as unavailable.

## Storybook visual lab

The connected workshop is **Workspace / Conversation** (`?path=/story/workspace--conversation`). It renders `CommonspaceApp` and `CommonspaceClientStore`, exactly as the live app does. `workspace-mock-api.ts` supplies disposable MSW responses; navigation, sends, unread/saved state, creation forms, and settings use the real components. Edit those shared components and inspect hot reload. Reload the story to reset the mock workspace. Unsupported native operations return a visible preview error instead of reaching a local service. There is no separate prototype UI to port or maintain.

Choose a Storybook command for the current stage:

| Stage | Command |
| --- | --- |
| Explore and inspect through hot reload | `pnpm storybook` |
| Check settled interactions and accessibility | `pnpm test:storybook` or a focused story-file filter |
| Verify the static Storybook build | `pnpm build-storybook` |
| Compare reviewed pixel baselines | `pnpm test:visual` |

Keep the development server running at `http://127.0.0.1:6006` during visual exploration. Use hot reload between edits; full suites and builds belong to integration checks. The visual test command builds Storybook and serves that exact static output on an isolated loopback server.

Stories under `ui/src/stories` use production tokens with local fixture stores and fetchers. They do not require the Commonspace API. Storybook `play` functions test interactions and accessibility in Chromium. The separate `tests/storybook-visual.spec.ts` suite compares selected canvases with approved PNG baselines under `tests/storybook-visual.spec.ts-snapshots`.

The development server also exposes the Components Manifest and an MCP endpoint at `http://127.0.0.1:6006/mcp`. The addon is already installed and registered in `ui/.storybook/main.ts`; do not reinstall it during normal iteration. `.codex/config.toml` supplies the project-scoped Codex connection. MCP runs only in the development server, not the static Storybook build or isolated CLI test configuration.

### Storybook MCP workflow

Use this loop for UI work:

1. Complete [startup and connection recovery](#startup-and-connection-recovery) below. Start or reuse the development server and establish an actual MCP connection before editing UI.
2. Call `docs-list` with `withStoryIds: true`. Use `docs-show` for the relevant component and `docs-show-story` for specific states. Reuse existing production components and patterns; inspect source to confirm ownership and implementation before editing.
3. Before adding or changing stories, call `get-storybook-story-instructions`. Keep fixtures synthetic and exercise observable user behavior.
4. While exploring visual composition, use the running canvas and hot reload; do not run tests or rebuild after each visual edit. Once an interaction is settled, call `test-run` for its affected story IDs. Full suites belong to production integration, not the visual sketch loop.
5. Call `stories-preview` for the changed screens. Open the returned URLs, inspect their actual pixels, and exercise the affected flow. Establish the desktop composition at 1440 × 960 first, including meaningful hover/focus and Light/Dark states. Mobile/tablet and responsive redesign belong to a separately requested pass after the desktop design is settled. Return useful preview links with the result.

MCP supplies component contracts, story discovery, previews, interaction results, and accessibility feedback. It does not judge composition or certify visual quality. Follow the pixel review protocol below as a separate required step.

Missing native tools alone do not justify skipping MCP. Use the direct SDK connection below in the same agent session. If startup, the direct connection, or a needed tool still fails after the relevant recovery steps, record the concrete command/request error and use `pnpm test:storybook -- <story-file-filter>` and browser inspection for that failed check. Continue using the MCP tools that work. Do not claim non-MCP fallback checks ran through MCP. Keep Storybook's manager open when using tools that depend on its testing channel.

Do not use `--update-snapshots` as an ordinary verification step. Inspect the affected state, decide whether the change is correct, and update only an accepted baseline.

### Startup and connection recovery

The agent owns startup; do not ask the user to run Storybook. Run commands from the current repository root, with the shell prefix required by the working environment (the examples use `rtk proxy`).

1. Check the development server with `rtk proxy curl --fail --silent --show-error --max-time 5 http://127.0.0.1:6006/index.json`. Confirm the index contains this project's `workspace--conversation` story and the listening process's working directory belongs to the current checkout. Identify an unexpected listener before reusing or stopping it. Do not silently switch ports: `.codex/config.toml` points at 6006.
2. If no server is running, launch `rtk proxy pnpm storybook` in a persistent terminal/exec session. Keep the process alive, inspect its startup output, and repeat the index check when it reports ready. Fix startup errors before proceeding; neither a static build nor the isolated test configuration exposes MCP. Reuse a healthy server instead of starting a duplicate.
3. Discover the client's deferred tools. In Codex code mode, search `ALL_TOOLS` for names containing `storybook`, read the matching tool's schema, then call it through `tools`. For example, call `await tools.mcp__storybook__docs_list({ withStoryIds: true })`. Absence from the initially displayed tool list does not establish that it is unavailable.
4. If native tools are missing or their connection is stale, connect directly with the installed MCP SDK below. This performs the MCP handshake and tool calls against the same endpoint without requiring a new agent session. Keep using this connection path for documentation, previews, and focused tests as needed.

From the repository root, this command lists tool names and input schemas, then calls `docs-list`:

```bash
rtk proxy node --input-type=module <<'JS'
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const client = new Client({ name: 'commonspace-storybook', version: '1.0.0' });
try {
  await client.connect(new StreamableHTTPClientTransport(
    new URL('http://127.0.0.1:6006/mcp'),
  ));
  const { tools } = await client.listTools();
  console.log(JSON.stringify(tools.map(({ name, inputSchema }) => ({ name, inputSchema })), null, 2));
  const result = await client.callTool({
    name: 'docs-list',
    arguments: { withStoryIds: true },
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.isError) process.exitCode = 1;
} finally {
  await client.close();
}
JS
```

For subsequent calls, replace the `callTool` request using the returned tool schema; omit the tool listing once discovered. For example, `stories-preview` accepts `{ stories: [{ storyId: 'workspace--conversation' }] }`. Tool names on the wire use hyphens (`docs-list`, `test-run`), while native Codex tool identifiers use underscores. This is actual MCP over Streamable HTTP, not a browser fallback. The SDK is already a root development dependency; no installation or additional server configuration is needed after the normal repository setup.

Open the returned manager URL (`/?path=/story/...`), not only `iframe.html`, before calling `test-run`. If it reports a missing testing channel, load the manager and retry the focused call. A plain GET to `/mcp` is not a readiness check: use the SDK handshake and `listTools`/`callTool` to diagnose protocol failures. Report the actual failure and which recovery steps ran, rather than saying only that tools were not exposed.

### Shared-component review

Start at **Review / Component System / Shared patterns**. It renders production buttons, filters, agent identities, and counters together, then links to real screens. This is the entry point for comparing the same pattern across contexts, not a substitute for checking those contexts.

With the Storybook development server running, capture the declared review catalog:

```bash
pnpm review:ui
```

This captures the current source served at `http://127.0.0.1:6006` in Light and Dark at `1440 × 960` and `1180 × 820`. It writes PNGs and `review.json` under `artifacts/ui-review/<run>/`. Readiness selectors identify the intended state; page and console errors fail the capture. The manifest marks every visual inspection **pending**, even when capture succeeds. It does not run or certify the separate interaction test suite, compare approved baselines, or certify release readiness.

Open the images and record concrete findings using the protocol below. Check the same identity, control, and grouping across screens before approving a shared change. The catalog is a representative desktop set, not complete state coverage; separately exercise hover, keyboard focus, menus, empty states, and narrow-pane behavior affected by the change. In particular, the thread must be checked at the width where it changes from side by side to a right-side overlay.

Dedicated stories cover primitives, workspace startup, routing, sorting, follow-up delivery, search, permissions, and runtime activity. Use Storybook for isolated states; use the live verifier for assembled UI/API behavior.

For desktop recovery changes, include `CommonspaceSearch/RetryPreservesSearch`, `RunDelivery/KeyboardQueueUpdates`, and the assembled settings/theme checks in `tests/e2e/workspace.spec.ts`. Verify that settings exclude covered controls from keyboard navigation, Escape closes the nearest overlay, queue mutation recovers focus, and System reacts to a live color-scheme change after reload. These automated checks complement inspection of Light and Dark screenshots; they do not establish screen-reader or additional-browser acceptance without that review.

## What the live verifier captures

Run the production browser check from the repository root:

```bash
pnpm verify:live
```

The verifier starts temporary production server/UI processes and uses a desktop viewport of `1180 × 820`. Its output includes `experienceAudit.artifactDir`, which points to an evidence directory under:

```text
artifacts/experience-audit/<run>/
```

| File | Contents |
| --- | --- |
| `audit.json` | Ordered actions, captured states, and check status |
| State PNG files | Before-and-after screenshots |
| State JSON files | Screenshot path, accessible structure, focus target, overlay bounds, viewport, overflow observations, and hovered element |
| `trace.zip` | Playwright screenshots, DOM snapshots, and action trace |
| Failure evidence | The state and screenshot reached when an expected action fails |

The current captured journey includes search hover/focus/open/query/keyboard states, Channel menus and navigation, composer focus and Project suggestions, Workspace settings, Light/Dark transitions, and the installed-server mount. This is a useful starting set, not complete coverage of every product state.

## Visual review protocol

Review each meaningful state in action order:

1. Run the focused Storybook or live journey and record its evidence directory.
2. For live evidence, read `audit.json` for the state order and exact PNG paths.
3. Open each meaningful after-state image. Compare it with the preceding state when reviewing hover, focus, selection, or an opened overlay.
4. Check layout, spacing, borders, hierarchy, readable content, and state clarity against the design contract. Evaluate colors by their semantic roles and contrast in the active appearance mode.
5. Record a verdict with the state, action, affected region, expected result, observed result, severity, and evidence path.
6. Accept the appearance only after all required states have been seen and all must-fix findings are resolved.

For an AI-assisted review, open the actual image with an image-capable tool. Review a small set at a time so that the relevant before-and-after states remain available together.

A useful finding identifies an observable problem:

```json
{
  "state": "search-open-after",
  "action": "click global search",
  "region": "type-filter row",
  "severity": "must-fix",
  "expected": "one scannable filter group with a clear selected state",
  "observed": "one filter wraps onto a separate row and has no visible selected state",
  "evidence": "artifacts/experience-audit/<run>/030-search-open-after.png"
}
```

Avoid findings such as “looks bad” or “needs polish” without naming the region and the visible reason.

## Mechanics checks that belong in code

Automate behavior that can be checked deterministically:

- Find the intended control by its accessible name and reach the expected next state.
- Confirm menus, dialogs, listboxes, and suggestions open and close correctly.
- Check that focus moves to the intended target and remains visible.
- Keep overlays inside the viewport and anchored to their trigger.
- Reject unexpected horizontal overflow and clipped text in important containers.
- Verify that hover controls become visible before use.
- Check appearance changes and restoration.
- Detect page errors, console errors, and failed requests.

These checks protect usability and provide evidence for review. Pixel inspection still decides whether the result communicates clearly.

## State matrix

Use this matrix when selecting acceptance states. Every row needs resting, hover, keyboard focus, open/selected, and applicable empty, dense, loading, or error states.

Use Storybook's Light / Dark toolbar for ordinary content and portaled overlays. Inspect the compact sorting menu, queued-message tray, startup retry, and long dialogs at desktop and narrow-pane widths.

| Surface | Examples to inspect |
| --- | --- |
| Shell and sidebar | Active destination, unread state, dense navigation, open menus |
| Inbox | Empty Inbox, filtered results, selected item, failure or input request |
| Channels and DMs | Empty conversation, active reply, Thread, unread boundary |
| Composer | Focus, slash commands, references, attachments, sending state |
| Search | Empty query, results, filters, keyboard selection, no results |
| Threads | Selected continuation, dense list, exact-reply navigation |
| Projects | File tree, preview, changes, diff, empty or rejected content |
| Settings | Open/close, appearance changes, saved settings, confirmation dialogs |
| Agent activity | Collapsed and expanded activity, permission choices, attachments |

The live verifier covers only part of this matrix. Record missing coverage explicitly instead of counting an uncaptured state as passed.

## Iteration loop

For each finding, keep its evidence, fix the smallest owning component, and inspect the changed state with adjacent states through hot reload. Rerun a focused interaction check when the fix changes behavior or the interaction is settled.

Once the change is ready for integration, run the change-specific checks in [Contributing](../../CONTRIBUTING.md#verify). A server or visible end-to-end change needs `pnpm check` followed by `pnpm verify:live:built`; see [Development](../guides/development.md#verification-commands). Do not repeat broad gates or agent reviews between visual edits.

A baseline is useful only after review. Do not approve a changed image simply because it matches the current implementation.
