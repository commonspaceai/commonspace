# Architecture

Commonspace is a local service with a browser UI. The server owns durable conversation state and connects to supported agent harnesses; the browser presents that state through shared API contracts. This guide explains where behavior belongs and which boundaries a change must preserve.

Read the [Product model](../specs/product.md) for the domain and [Development](development.md) for setup and verification.

## Shape

The pnpm workspace has four packages:

| Package | Responsibility |
| --- | --- |
| `packages/shared` | Domain contracts and pure helpers used by both server and UI |
| `server` | Express API, persistence, routing, context, and local agent execution |
| `ui` | Vite/React browser application |
| `cli` | npm command, packaged server startup, and bundled UI location |

The product consists of Projects, Channels, Direct Messages, Agents, messages, Threads, and their shared context. Keep feature logic near its owner and use `packages/shared` as the single source for cross-process types.

Two protocols connect agent work to the workspace. Agent Client Protocol (ACP) carries native session requests, responses, activity, and permission choices over local child-process input/output. Model Context Protocol (MCP) exposes scoped Commonspace context and progress tools over authenticated loopback HTTP.

`server/src/context-history.ts` owns the derived history tree and exact passage provenance. Scoped MCP history tools reuse the local inverted passage index in `routing-retrieval.ts`; `service.ts` revalidates scope before every read and bounds its process-local index cache. Retrieval does not rewrite shared summaries or native prompt history. [Shared history retrieval](../specs/context-retrieval.md) defines freshness, authorization, and cost limits.

`semantic-history.ts` owns scope-local vector reconciliation and keyword/semantic rank fusion. `local-history-embeddings.ts` owns the lazy CPU worker, pinned public model download, bounded inference queue, and shutdown. Conversation text stays local. The host revalidates scope and source revision after inference; unavailable inference returns explicitly marked lexical results.

## Where changes belong

| Change | Primary owner | Update together |
| --- | --- | --- |
| Cross-process type, API shape, or pure helper | `packages/shared` | Server, UI, tests, and documentation |
| State transition, migration, persistence, or routing | `server/src/state.ts` or `server/src/service.ts` | Shared contracts, regression tests, and operations docs |
| Harness-generated file validation and copying | `server/src/file-attachments.ts` | Credential-name, allowed-root, symlink, byte-limit, and ACP attachment tests |
| Portable archive size policy | `server/src/workspace-portability.ts` | HTTP import limits, portability tests, and archive-format docs |
| HTTP validation or response status | `server/src/app.ts` | Shared request types and API tests |
| ACP process or native-session lifecycle | `server/src/acp-runtime.ts` and `server/src/service.ts` | Harness tests and security documentation |
| Scoped MCP behavior | `server/src/commonspace-mcp.ts` | Shared contracts, ACP tests, and context documentation |
| Browser state or API coordination | `ui/src/commonspace-store.ts` | Shared contracts and client tests |
| Desktop UI and interaction | `ui/src` and `ui/src/stories` | Storybook states, accessibility checks, and integrated browser flows |

A coordinator can call another feature's capability, but should not duplicate its rules or state.

Native capability browsing uses `GET /api/agents/:agentId/capabilities` for an added agent. The shared `HarnessCapabilityInventory` contract contains only display metadata. Each adapter owns native inventory extraction; the service applies host redaction, and the endpoint is same-origin with `Cache-Control: no-store`. Inspection is lazy and separate from bootstrap, saved agent profiles, and portable exports. Per-category failures do not erase categories that were successfully inspected. The browser owns loading, refresh, and unavailable states; it has no native capability editing controls.

## Request path

A typical Channel send follows this sequence:

1. The UI sends a request to `/api/send`.
2. The server validates the request and persists the accepted message and any new Thread.
3. For an unaddressed message, inference selects participants, mode, order, and Project scopes. Explicit `@agent` mentions remain authoritative.
4. The server sends each assignment to its native session. Different sessions may run concurrently; work for the same session is serialized.
5. ACP updates provide activity, permissions, and replies. Durable outcomes are persisted, and revision events tell the browser to refresh.

A routing or execution failure after acceptance leaves the source message in history. The browser displays the resulting attention state instead of losing the user's request.

In development and preview, Vite forwards `/api` to `127.0.0.1:3100`. Production browser assets are built into `ui/dist`. The npm CLI serves its packaged `ui-dist`; the source-based macOS service serves `ui/dist`. Both use Express so the UI and API share one loopback origin.

### Browser routes

The URL is authoritative on direct loads and browser back/forward navigation:

| Route | Destination |
| --- | --- |
| `/` | Inbox |
| `/inbox/sessions` | Inbox session view |
| `/threads` | Threads |
| `/projects`, `/channels`, `/agents` | Directories |
| `/projects/:id` | Project, with encoded file detail when selected |
| `/channels/:id` | Channel, with Thread and message detail when selected |
| `/agents/:id` | Direct Message with the Agent |

Unknown or stale detail routes return to Inbox instead of restoring unrelated saved state. Each route transition clears transient Settings state. Express serves the application entry point for non-API deep links. Legacy notification query links are accepted once and replaced with their canonical conversation route.

### API groups

The HTTP boundary is implemented in [`server/src/app.ts`](../../server/src/app.ts). The following groups locate the main capabilities; request and response shapes live in `packages/shared`.

| Capability | Endpoints |
| --- | --- |
| Health and state | `GET /api/health`, `GET /api/bootstrap`, `GET /api/diagnostics`, `GET /api/events` |
| Conversation | `POST /api/send`, `POST /api/mutate`, `POST /api/stop`, `POST /api/reroute`, `POST /api/routing/retry` |
| Message history | `POST /api/messages/:messageId/edit`, `POST /api/messages/:messageId/delete` |
| Context | `GET` and `PUT /api/channels/:channelId/context`, `GET` and `PUT /api/threads/:threadId/context`; `POST` to either path with `/compact` |
| Routing configuration | `GET` and `PUT /api/routing` |
| Pins and permissions | `POST /api/pins`, `POST /api/pins/:pinId/remove`, `POST /api/permissions/:permissionId/respond` |
| Projects | `GET /api/projects/:projectId/files`, `/file`, `/changes`, `/diff` |
| Attachments | `GET /api/attachments/:attachmentId`, `GET /api/files/:fileId` |
| Workspace data | `GET /api/export`, `POST /api/import`, `POST /api/retention/preview`, `POST /api/retention/apply` |
| Local discovery | `POST /api/discover-agents`, `POST /api/select-directory` |
| Agent context tools | `POST /api/mcp`, restricted to bearer-scoped ACP clients |

Routing configuration has one shared variant: the ID of an added harness Agent. Current requests and version-3 saved files reject unknown fields; unsupported saved files are removed instead of migrated. Commonspace owns no inference credential fields. Settings saves retain their pending state and submitted draft across closing and reopening the panel, and disable edits until the request settles.

Server-sent events carry durable state revisions, routing configuration invalidations, and separate temporary activity updates. Routing saves refresh other tabs without changing the workspace revision. The browser also refreshes on reconnect and queues invalidations received during an active refresh. It rejects older state revisions so a slower response cannot replace newer state.

## Server

`server/src/service.ts` coordinates the workspace's durable behavior:

- It validates and persists messages, versions, branches, deletion markers, pins, permissions, and conversation outcomes.
- It maintains Channel context, immutable starting snapshots for Threads, independently editable Thread context, and automatic Channel briefs after completed turns, pressure-triggered Thread compaction, and explicit refresh. Source projections track coverage only; inference produces semantic summaries, decisions, and unresolved questions.
- It resolves zero, one, or many Project references per message and Thread. Canonical roots stay private; browser responses use folder labels and root indexes.
- It stores native-session mappings, resumes exact sessions, and recovers sessions only when a harness explicitly reports them missing.
- It accepts work immediately, coordinates independent sessions concurrently, and serializes work targeting the same native session.
- It retains routing assignments and corrections, binds replies to those assignments, and preserves prior attempts.
- It stores bounded image and general-file attachments, rejects known credential-bearing source, resolved, and display names before reading bytes, and imports harness artifacts only from permitted canonical roots. Harness files are opened without following the final symlink, rechecked by canonical path and file identity, then read through the same descriptor with a validated-size-plus-one ceiling so replacement or growth cannot bypass limits.
- It exposes storage checks, harness discovery and recorded run history, inference data-flow information, notifications, portable archives, and explicit retention. Recorded replies or failures describe conversation history; they do not verify current harness model access or authentication.

`server/src/app.ts` owns HTTP limits, loopback and same-origin guards, event framing, status codes, health checks, security headers, and optional static UI delivery. `server/src/acp-runtime.ts` owns the ACP client and subprocess lifecycle. `server/src/commonspace-mcp.ts` owns temporary capabilities and scoped tools. `server/src/index.ts` owns configuration, startup, signals, and graceful shutdown.

### Package and service lifecycle

`cli/src/index.ts` is the published npm entry point. Its build bundles Commonspace-owned server and shared code, packages the built UI, and leaves external runtime libraries as ordinary npm dependencies.

`scripts/commonspace-service.mjs` manages the source-installed macOS service. It stages committed source builds in owner-only storage, writes the LaunchAgent atomically, requires a successful health check before accepting an update, and keeps one rollback release. It invokes external commands with argument arrays.

Workspace state lives outside the release directories. Switching application versions never replaces user data, and rolling back application code does not reverse a state migration. See [Operations](operations.md#backup-and-rollback).

### Development lifecycle

`server/src/dev-supervisor.ts` watches for backend changes and requests a restart through child-process messages. The running server keeps its ACP processes and MCP endpoint alive until every accepted turn finishes. Multiple edits become one replacement at the next all-idle boundary. Explicit process signals still cancel active work and shut down.

## Shared contracts

`packages/shared` defines the state and API shapes consumed by the server and UI. Internal state may contain host-private native-session references; browser snapshots remove them. A shared contract change must update every affected consumer, validation or migration rule, test, and document in the same change.

Messages and Threads use zero-to-many Project references. A singular compatibility field remains for older consumers, but new browser state must not invent a Project fallback from it.

## Agent runtimes

Hermes runs through its installed `hermes acp` harness. Discovery reads its existing native profiles; each selected profile has a reusable workspace Agent identity and retains its own native configuration. Codex uses its bridge’s compatible bundled CLI unless explicitly overridden; Claude Code uses its bundled ACP bridge with the installed CLI. Gemini CLI uses native `--acp`; OpenCode uses native `acp`. Gemini compatibility is checked during discovery and launch because later native versions have observed session-resume regressions. Its adapter also rejects native session reloads before saved-session data or prompts are sent, because accepted versions can replay history after the load response. Rejection preserves the session mapping and accepted message; it never substitutes a fresh native session. Adapter discovery, launch, and settings policy live in `server/src/adapters`; the shared catalog drives registration, validation, and UI labels. See [Adding an agent adapter](../adapters/agent-adapters.md). Each Thread or DM generation keeps its own native session. Discovery never creates or rewrites native profiles.

A native Channel turn receives the original newly delivered message, a separate participation metadata block, and ACP resource links for attached files. Shared room context is available through scoped MCP tools on demand instead of being replayed inside every user message. Channel MCP scopes expose current peer IDs through the `commonspace_handoff` schema. A structured handoff records one concrete request during the active run; after that run finishes, the service appends a visible `@agent` handoff and delivers only sender identity plus the request. When a structured handoff starts a planned relay participant, delivery also preserves the original user message and a bounded preceding peer reply. Later inferred relay turns receive a bounded head-and-tail excerpt of the preceding peer response plus the original user message; the full reply remains available through scoped context.

Each active Agent native-session scope has one long-lived ACP process. Inference separately reuses three kinds of process lane: Channel routing, Channel context, and Thread context. Thread follow-up routing uses its Channel routing lane; routing-memory and shared Channel compaction use the Channel context lane; each Thread owns its context lane. Every inference judgment still creates a fresh native session, so process reuse never makes private native history authoritative. Commonspace drops ephemeral client-side session bookkeeping after each judgment and periodically rotates a busy lane, bounding both host and native-process lifetime state even though ACP has no session-close method. It also closes processes on reset, removal or retention of their scope, inference-Agent replacement, shutdown, or stale-session recovery. Delayed launches revalidate their lane before entering the process cache. Graceful closure lets the bridge flush and stop its native child before bounded forced termination; an intentional transport close must not trigger the protocol-error kill path. `/new` is a hard context boundary: cancellation and generation checks prevent an old reply from entering the replacement conversation.

Resumption uses the saved opaque native-session reference through ACP `session/load`. ACP frames and responses are bounded. Activity, reasoning summaries, plans, tool calls, native context-compaction lifecycle, usage, artifact links, and permission requests come from the harness. Commonspace normalizes those updates without synthesizing missing output or permission choices. A pending permission blocks only its own session. Native turn cancellation covers reset, Channel or Agent removal, timeout, and shutdown.

## UI

`ui/src/main.tsx` mounts React and shared styles. `CommonspaceApp` composes the desktop navigation and conversation surfaces. The URL determines the startup destination: `/` opens Inbox, and unknown or stale detail routes return there. The shell has no separate Workspace landing page or Agent-runs dashboard.

`CommonspaceClientStore` owns bootstrap state, selection, sends, mutations, and revision refreshes. The browser communicates with the server only through shared contracts and `/api`.

Sidebar sort preferences belong to `ui/src/sidebar-preferences.ts` and persist in browser storage. `ui/src/channel-sorting.ts` orders Channels without changing conversation data. Pinned and unpinned Channels remain separate groups when sorting or reordering.

`useCommonspaceTheme` owns the browser-local Light/Dark/System preference and resolves native browser control appearance. Workspace settings remain a sidebar-owned pane; the shell makes the covered working area inert while it is open. `RunDelivery` owns queue preview and keyboard-focus recovery. `CommonspaceSearch` owns request cancellation, query/filter state, and retry; it does not mutate the workspace. Shared search targets include direct Project navigation and exact matching message IDs. These targets are transient API responses and do not change the saved-data version.

Project scope is inferred unless the user supplies visible `@@project` references. Composers do not have separate Project pickers for roots, Threads, branches, or reroutes. [Design](../../DESIGN.md) describes the current visual treatment.

## Persistence

The current internal state version is 32, defined by `COMMONSPACE_STATE_VERSION`. Versions 1–31 migrate during load through structural validation and sanitization.

Persisted state includes the roster, appearance, workspace coordination defaults, host-private native sessions, bounded activity, Inbox read/unread/saved state, notification preferences, attachments, routing decisions and memory, Project references, Channel/Thread context, pins, message versions, deletion markers, permissions, and execution state. Native model and reasoning settings are not Commonspace state.

Migration preserves conversation history while supplying explicit defaults for older shapes. Older routing receives deterministic delivery references. Version 30 migrates prior assignment wording to optional `legacySubRequest`, retaining IDs, scopes, corrections, replies, and private native sessions. Historical wording is never used for delivery and is cleared with deleted content. Older Threads receive an empty inherited snapshot and current memory derived from their transcript, rather than an invented historical snapshot. Workspaces without pin, permission, or notification fields receive empty history and opt-in notification defaults. Loaded pending permissions become interrupted because their native requests do not survive a process restart.

### Durability and privacy

Accepted messages, branches, routing attempts, pin removal records, and permission outcomes have no implicit count limit. Bounds apply to derived context and activity, not to the canonical conversation record.

Deleting delivered content removes its body, routing wording, attachment metadata and bytes, traces, and automatic projections while retaining delivery and branch metadata. Attachment bytes and the managed projectless workspace use owner-only storage.

State writes use a `0600` temporary file followed by atomic rename. The prior valid state is kept as `state.backup.json`. If the primary is invalid and the backup is valid, startup preserves the invalid file as `state.corrupt.json` and restores the backup. Bounded traces redact host details before persistence. Browser snapshots remove MCP capabilities, source file URIs, and native-session references.

### Notifications and archives

Native alerts are derived from new durable Inbox items after persistence. Existing items become the baseline at startup and import, so historical alerts are not replayed. Notification categories are independent of Inbox read state. Delivery failure cannot fail the originating Agent result.

Execution completion and attention evidence stay separate. Text-only explicit requests derive one **May need input** item without changing the confirmed completed run state. Native permission records take precedence and derive one exact permission item; punctuation alone is never blocking evidence.

Notification links identify conversations, Threads, and messages by their workspace IDs. The client accepts them only when they match current state on the loopback origin.

Portable archive version 1 is independent of internal state version 32. Export contains sanitized workspace records and exact attachment bytes, replaces Project roots with counts, and omits native sessions. Import requires an empty workspace and explicit existing local roots, and validates all structure, mapping, attachment, and size constraints before writes. Retention requires an owner-triggered, revision-bound preview for one inactive conversation. See [Workspace archive format](../specs/workspace-archive-format.md) for the contract.

## Routing inference

Inference classifies each unaddressed Channel message after durable acceptance. It stores `parallel` or `relay`, plus one delivery ID and Project subset per selected harness. Parallel assignments may run concurrently. Relay assignments remain ordered: only the first starts from the human request, then each later Agent receives a bounded excerpt of the preceding peer response plus the original human message. The original human message and complete peer replies remain canonical records available through scoped context.

During an active Channel run, `commonspace_handoff` may register one target and request against that run ID. The service validates the target against current Channel membership, waits for the sender to finish, persists a visible handoff, seats the peer in the Thread if needed, then invokes it. Structured handoffs and relay mentions may return to a prior speaker only on a new directed edge. The visible workspace Agent limit bounds total turns; repeated edges or excess turns produce one durable system outcome instead of another invocation.

For a new root without `@@project` tags, inference may select from all configured Projects. The message and Thread retain the union of the selected references. Explicit valid tags constrain the available set, including replacing inherited scope on an edited branch. Explicit `@agent` addressing always remains authoritative.

A service-level correction can replace the Agent of one participant delivery. The target Agent must already belong to the Channel, with an explicitly supplied Project subset. Commonspace retains both attempts, binds replies to their assignment IDs, and does not restart unrelated Agents. Corrections contribute to bounded per-Channel routing memory without rewriting historical decisions.

Routing stores its own start time, resolution time, and duration separately from harness execution. Compact conversation receipts show destinations, selection source, and outcomes; expanding a receipt reveals stored assignments, Project references, reasons, timings, and correction history. Inline correction of resolved assignments remains deferred. A failed decision marks the accepted source failed, creates a durable retryable Inbox item, and exposes controls to retry inference or select a Channel Agent manually without duplicating the original message; it never silently broadcasts the message.

Commonspace selects one added Agent as the workspace inference Agent. That Agent's ACP harness performs participant selection, Project relevance, routing-memory compaction, and shared-context compaction through the runtime's existing authentication. Commonspace does not implement a second provider connection. Project relevance requires requested work on that Project; standalone greetings and social replies do not inherit filesystem scope merely from historical Project mentions. One judgment selects participants, order, mode, and Project scopes for single-owner, parallel, and relay delivery; no assignment-authoring call follows. All selected Agents receive the accepted original request. Channel turns add a separate ACP text block with roster responsibility, selected peers, and mode. Shared instructions, notes, pins, and evidence remain available through scoped MCP context, and later relay turns include a bounded preceding peer reply. Routing output budgets scale within a fixed bound according to the visible Agent fan-out limit. ACP prompts state the budget and enforce a scaled character ceiling. Invalid output may receive one bounded retry. The complete decision is validated before dispatch. Routing roots and Thread follow-ups reuse their Channel's routing process lane, but each attempt uses a fresh native inference session. Channel and Thread compaction likewise reuse only their process lanes; normal Agent execution resumes its exact existing Thread session. There is no deterministic provider mode.

Routing context retrieval lives in `server/src/routing-retrieval.ts`: a per-Channel ephemeral inverted BM25 index reconciles edited and deleted canonical messages and chunks long text. The assembler adds source IDs to bounded passages, scopes follow-ups to their Thread, and includes instructions, context notes, pins, and prior ownership. It never indexes native sessions, host files, or activity traces. `service.ts` tracks and coalesces automatic context refresh outside the delivery queue. Memory locks, source reconciliation, human-edit precedence, idle tracking, and shutdown cancellation preserve context continuity. Private `routing.json` version 3 stores only the selected harness Agent ID. Unsupported files are removed instead of migrated, and setup remains incomplete until a valid added Agent is selected. `routing-configuration.ts` owns validation and persistence. Inference configuration and workspace coordination defaults save independently. State version 32 does not persist model or reasoning controls; adapters leave runtime configuration untouched.
