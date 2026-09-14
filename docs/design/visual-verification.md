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

## Storybook visual lab

Use Storybook for isolated component and screen states:

```bash
pnpm storybook
pnpm test:storybook
pnpm build-storybook
pnpm test:visual
```

Run these as separate steps according to the check you need. The Storybook development server opens at `http://127.0.0.1:6006`. The visual test command builds Storybook and serves that exact static output on an isolated loopback server.

Stories under `ui/src/stories` use production tokens with local fixture stores and fetchers. They do not require the Commonspace API. Storybook `play` functions test interactions and accessibility in Chromium. The separate `tests/storybook-visual.spec.ts` suite compares selected canvases with approved PNG baselines under `tests/storybook-visual.spec.ts-snapshots`.

The development server also exposes the Components Manifest and an MCP endpoint at `http://localhost:6006/mcp`. These help an agent inspect component APIs, stories, and test feedback. They do not establish visual acceptance.

Do not use `--update-snapshots` as an ordinary verification step. Inspect the affected state, decide whether the change is correct, and update only an accepted baseline.

Dedicated stories cover primitives, workspace startup, routing, sorting, follow-up delivery, search, permissions, and runtime activity. Use Storybook for isolated states; use the live verifier for assembled UI/API behavior.

For desktop recovery changes, include `CommonspaceSearch/RetryPreservesSearch`, `RunDelivery/KeyboardQueueUpdates`, and the assembled settings/theme checks in `tests/e2e/workspace.spec.ts`. Verify that settings exclude covered controls from keyboard navigation, Escape closes the nearest overlay, queue mutation recovers focus, and System reacts to a live color-scheme change after reload. These automated checks complement inspection of Light and Dark screenshots; they do not establish screen-reader or additional-browser acceptance without that review.

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

For each finding, keep its evidence, fix the smallest owning component, rerun the focused journey, and inspect the changed state with adjacent states again. Before accepting a server or visible end-to-end change, run `pnpm check` and `pnpm verify:live` as described in [Development](../guides/development.md#development-workflow).

A baseline is useful only after review. Do not approve a changed image simply because it matches the current implementation.
