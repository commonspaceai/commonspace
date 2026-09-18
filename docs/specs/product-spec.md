# Commonspace product specification

This specification defines Commonspace’s current product requirements and their acceptance conditions. Requirement targets describe scope, not a claim that every check has passed. Use it when designing a change, implementing a feature, or reviewing a release.

Start with the [Product model](product.md) for an introduction to the concepts. The [Product direction](product-direction.md) explains scope, and the [Roadmap](../../ROADMAP.md) identifies release work and later plans.

For a first read, use the [Product model](product.md). [Functional requirements](#6-functional-requirements) are the normative reference, and [end-to-end acceptance scenarios](#end-to-end-acceptance-scenarios) cover complete user journeys. [Design](../../DESIGN.md) covers visual design and layout.

## 1. Product definition

Commonspace is an MIT-licensed, local-first workspace for one person working with several local agents. It connects the agents the user already has, shares conversation context, sends each agent the relevant request, and continues the correct agent session.

Conversation is the work record: requests, replies, decisions, and follow-ups stay in messages and threads. There is no separate task-management system.

An **agent runtime**, also called a **harness**, is the software that runs an agent and owns its tools, credentials, models, permissions, private memory, and sessions. Commonspace communicates with supported local runtimes through the **Agent Client Protocol (ACP)**. A **native session** is a conversation session owned by that runtime.

### Problem

Local agents usually run in separate terminals, tabs, and sessions. Working across them means repeatedly choosing an agent, restating Project context, passing messages between agents, and remembering where to continue. Parallel work is difficult to follow when its conversation is scattered.

Commonspace solves this by providing:

- Shared Channels and focused threads for agent collaboration.
- Persistent one-to-one DMs with exact agent continuity.
- Routing through a configured text provider or optional Jev judgments, with stored decisions and correction history.
- Visible Project references that identify the resources relevant to a conversation.
- Shared context that people can inspect and edit separately from private runtime context.
- Local persistence, search, unread state, attachments, activity, and recovery.

### Primary user

The intended user is one technical person who already uses supported local ACP runtimes. They want several agents to work across one or more codebases while keeping the conversation and results together.

### Core job to be done

> When I have work that may involve one or several local agents, let me state it once in the right conversation, keep the relevant Project and shared context visible, route only the necessary part to each agent, and preserve every continuation and result in one understandable record.

### Product promise

A user can open Commonspace, talk naturally in a Channel or DM, and trust that:

1. The right agent or agents receive the right bounded request.
2. Each conversation continues the correct native harness session.
3. Project, Channel, and Thread context remains visible and correctable.
4. Parallel work remains easy to follow without a required coordinator.
5. Local state and harness authority remain under the user's control.

## 2. Goals and exclusions

### Goals

| ID | Goal |
| --- | --- |
| G1 | Make one human effective with many reusable local agents. |
| G2 | Make Channels, DMs, messages, and threads the complete work record. |
| G3 | Route and decompose requests with visible, correctable inference. |
| G4 | Preserve exact native-session continuity while exposing safe shared context. |
| G5 | Let messages and threads reference zero, one, or many Projects. |
| G6 | Keep agent collaboration peer-to-peer and visible through mentions. |
| G7 | Surface normalized harness activity, results, and permission choices without replacing the harness. |
| G8 | Remain local-first, recoverable, portable, and fully open source. |

### Explicit non-goals

- Tasks, tickets, goals, objectives, priorities, assignees, workflows, kanban, budgets, or approval pipelines.
- Company simulation, org charts, agent employees, managers, captains, or a required coordinator agent.
- Multi-human accounts, roles, remote workspace sync, or hosted collaboration.
- Replacing agent runtimes, models, tools, credentials, private memory, or native sessions.
- Wrapping arbitrary unsupported CLIs. Commonspace supports known ACP harnesses through first-party integrations.
- Agent-created Channels, Projects, or workspace structure.
- A standalone agent-management dashboard or agent profile pages.
- A full Git client, terminal, execution manager, or raw harness debugger.
- Generic plugins or third-party extension lifecycle.
- Resource types beyond local folders, although the Project model must leave room for them later.
- Reactions, agent-suggested durable context, and automatic acceptance of agent-written memory.
- A relational transcript store before measured scale requires one.

## 3. Product principles

1. **Conversation is the work record.** Execution state belongs to messages and replies, not to a parallel task object.
2. **Runtimes own execution.** Commonspace connects supported local agents through ACP. Their runtimes own tools, credentials, and native sessions.
3. **Context is explicit.** People can inspect and correct Project references, shared context, routing decisions, and the state of context summaries.
4. **Native continuity is exact.** A thread or DM resumes its mapped native session whenever the harness supports it.
5. **Agents are peers.** A visible mention is the handoff. No coordinator is required.
6. **Inference is a service function.** One configured provider chooses agents, divides requests, identifies Projects, and summarizes shared context and routing corrections.
7. **Harness capabilities are authoritative.** Runtime controls come from ACP. Read-only capability browsing may also use native inventory commands or native configuration metadata, with the source and scope visible. Configured capabilities are not proof of availability in a particular session.
8. **Parallel by default.** Different native sessions may run concurrently. Only work targeting the same native session is serialized.
9. **Local authority.** Commonspace stores workspace data and native-session references locally. Connected runtimes control their own model-service traffic and credentials. Commonspace inference may also use an explicitly configured remote endpoint.
10. **Outcomes are honest.** Commonspace must not hide routing failures, rewrite delivered history, invent permissions, or imply that an interrupted run completed.

## 4. Conceptual model

For an unaddressed Channel message, Commonspace uses the message and its context to choose participants, delivery order, and Project scopes. Each assignment becomes a turn in the appropriate native session. Replies and activity return to the same thread.

```mermaid
flowchart TD
    M["Human Channel message"] --> I["Commonspace inference"]
    C["Shared context"] --> I
    P["Project references"] --> I
    I --> S["Original message + participant scope"]
    S --> N["Native ACP sessions"]
    N --> T["Replies and activity in one thread"]
```

| Object | Product meaning | Key rule |
| --- | --- | --- |
| Workspace | One local Commonspace installation and its durable state. | One human is the authority in the current product. |
| Agent | A supported local ACP runtime explicitly added to the workspace. | The same Agent is reused across Projects and conversations; Commonspace does not clone it per Project. |
| Project | A named context container with one or more resources. | Projects are references, not task owners. Local folders are the only current resource type. |
| Channel | A shared conversation with a chosen set of agents, instructions, and shared context. | A Channel may be projectless and does not permanently belong to one Project. Model and reasoning configuration is workspace-wide. |
| DM | A persistent conversation between the human and exactly one chosen Agent. | Smart routing never substitutes another Agent. |
| Message | Human, Agent, or system conversation content with references and attachments. | Accepted messages are persisted before inference or agent execution. |
| Thread | The focused continuation created by a Channel root message. | Each participating Agent has its own native session inside the Thread. |
| Project reference | A visible link from a message, participant delivery, or Thread to a Project. | References can be explicit or inferred and must be correctable. |
| Participant delivery | A selected Agent and its Project scope, linked to the original request. | The Agent receives the original user message unchanged, with separate responsibility metadata. |
| Native session | The opaque session owned by a harness for one Agent in one Thread or DM generation. | Its identifier remains host-private. |
| Shared context | Conversation information made available by Commonspace separately from the runtime's private session context. | Users can inspect, edit, and manually compact it. |
| Routing memory | Compacted knowledge derived from explicit routing corrections. | It influences later routing without altering historical decisions. |
| Attachment | A durable file associated with a specific message version. | Humans and supported harnesses can attach files. |
| Activity | Normalized ACP reasoning summaries, plans, tools, results, native context compaction, usage, permissions, and controls. | Raw terminal output remains in the harness. |

### Authority boundary

Agent settings provide an on-demand, read-only native capability browser for every supported adapter. Categories cover tools, MCP integrations, skills, plugins, native agents, and memory metadata. Each category identifies its source and reports available inventory, unavailable inspection, or a read failure separately. Empty inventory is distinct from unavailable inspection. Refresh does not run a model turn, change native configuration, or persist inventory in workspace data. Native credentials, launch arguments, server endpoints, host paths, and memory contents are excluded. A profile-level inventory must not imply that every item is enabled in every Project or native session.

| Commonspace owns | The harness owns |
| --- | --- |
| Workspace objects and appearance | Actual Agent behavior and identity |
| Conversation persistence and branches | Models and reasoning modes |
| Routing, decomposition, and routing memory | Tools and tool behavior |
| Project references and shared context | Native permission semantics |
| Native-session mapping | Native session internals and private compaction |
| Normalized ACP activity presentation | Runtime configuration and credentials |
| Search, unread state, notifications, export/import | Raw terminal and runtime debugging |

## 5. Primary experience

### 5.1 First run and Agent addition

1. The local Commonspace service starts and the browser or desktop client connects to it.
2. The workspace starts without silently importing every installed Agent.
3. When the user chooses **Add Agent**, Commonspace scans only for supported ACP harnesses.
4. The user explicitly selects the harness identity to add.
5. Commonspace may assign a local display name, emoji/avatar, and accent color without renaming or altering the harness identity or configuration.
6. The Agent becomes available for DMs, Channel membership, mentions, and routing.

### 5.2 Project setup

1. The user creates a Project with a name and one or more local folders.
2. The first folder is the primary working directory and later folders are additional context roots.
3. Commonspace canonicalizes and validates every folder locally.
4. Creating a Project does not create a Channel, task, or Project-specific Agent copy.
5. The Project is available as a visible reference in any Channel, Thread, or DM.

### 5.3 Unaddressed Channel message

1. The human sends a root message in a Channel, with zero or more explicit Project references.
2. Commonspace persists and displays the message immediately.
3. The message creates a Thread.
4. The inference layer resolves missing Project references, selects the smallest useful set of Agents and classifies delivery as parallel or relay.
5. A request for independent work uses parallel delivery. A request for Agents to discuss, debate, reconcile, review one another, or reach a shared conclusion uses an ordered relay with at least two assignments.
6. The service stores the routing mode, selected Agents, ordered participant deliveries, Project references, and routing reason. These records support delivery, associate replies with assignments, and retain diagnostics and corrections. Every routed human message shows a compact receipt naming the destination, selection source, and queued, running, completed, cancelled, or failed outcome; participants, reasons, Projects, timing, and reroutes remain expandable. A failed routing receipt lets the user retry inference or choose a Channel Agent manually without duplicating the persisted message.
7. Parallel assignments run concurrently. In a relay, only the first Agent starts; each later Agent receives a bounded head-and-tail excerpt of the preceding peer response plus the original user message. The complete reply remains available through on-demand context.
8. Calls to the same native session are serialized.
9. Replies, activity, results, and attention states appear under the same Thread.

### 5.4 Explicitly addressed Channel message

1. One or more explicit `@agent` mentions are authoritative.
2. A mentioned Agent that is not already a Channel member is added immediately and invoked.
3. When several Agents are mentioned, each receives the original message; routing may not replace them with different Agents.
4. Explicit Project references are authoritative for the message. Inference may assign a relevant subset to each participant delivery.

### 5.5 Thread continuation and peer handoff

A structured handoff that starts a planned relay participant includes the original user message, bounded preceding peer reply, and peer request. Standalone peer-directed handoffs retain their sender/request delivery; they are agent coordination rather than router-authored rewrites.


1. A human reply continues the exact native sessions already mapped to that Thread.
2. Project references inherit from the Thread unless the new message supplies visible `@@project` tags; there is no separate Channel/Thread Project picker.
3. A change affects the new message and future Thread defaults, never the context already delivered in earlier turns.
4. An Agent can call scoped `commonspace_handoff` once during an active Channel turn with one current peer ID and a concrete request.
5. Commonspace writes that request as a visible `@agent` handoff, adds the peer to the Thread if needed, and invokes it after the sending turn with only sender identity and the clean request. A final paragraph beginning with an unquoted `@agent` directive remains a fallback; quoted, incidental, or machine-added sender labels do not route.
6. Structured handoffs may return to an earlier speaker when the directed edge has not already run and the visible workspace Agent limit has capacity.
7. Self-handoffs, non-member targets, repeated directed edges, and excess relay turns are rejected or stopped with a visible outcome. This does not require a coordinator or task gate.

### 5.6 Direct Message

1. A DM always targets the selected Agent directly.
2. Project references may be explicit or inferred, but Agent selection does not run.
3. Every normal continuation resumes the current DM native session.
4. `/new` creates a visible generation boundary, cancels the old in-flight generation where possible, and starts a fresh native session.
5. Late replies from the old generation cannot cross into the new generation.

### 5.7 Context inspection and compaction

Compaction summarizes context so it fits within input limits. It does not delete the conversation transcript or alter the runtime's private memory.

1. The user can inspect the Project, Channel, and Thread context available to an Agent.
2. Channel context shows its summary, decisions, open questions, the source messages it covers, estimated token pressure, who wrote it, and its compaction state. Channel settings put readable pins first and keep optional channel guidance and memory editing under collapsed **Advanced context**, preserving existing saved context without requiring setup for ordinary conversation.
3. A new Thread snapshots the current Channel context and then develops its own Thread context.
4. Automatic compaction responds to estimated context/token pressure.
5. The user can trigger compaction manually and edit the stored summary, decisions, and questions.
6. User-written context remains authoritative and is not silently overwritten by automatic projection.
7. If new source messages make edited context incomplete, Commonspace marks it stale.
8. Channel timeline messages expose Pin/Unpin in the hover toolbar and message menu. These pins belong to the Channel even when a Thread is open; actions inside the Thread belong to that Thread. Pin lists show readable source content instead of internal message IDs.

### 5.8 Message correction

1. Editing a delivered human message creates a new message version and conversation branch from that point.
2. The original branch, replies, routing decision, and native sessions remain available as history.
3. The edited version can be routed again and receives new native-session continuations where required.
4. Deleting delivered content leaves a visible deletion marker and minimal delivery metadata.
5. Agent replies cannot be edited as if they were human-authored messages.

### 5.9 Files and permissions

1. A human can attach a normal local file to a message.
2. A supported Agent can attach a harness-generated file through normalized ACP artifact data.
3. Attachments remain bound to the exact message version that delivered them.
4. Known credential-bearing files are refused.
5. When a harness requests permission, Commonspace shows only the choices advertised by that harness.
6. The pending permission blocks only the affected native session and creates an attention item and notification.

### 5.10 Closing and reopening Commonspace

1. Closing the client does not stop the local service or active Agent sessions.
2. Reopening the client reconstructs the workspace from the service's durable state.
3. Restarting Commonspace or the machine resumes stored native sessions when the harness supports it.
4. A turn that was interrupted and cannot be resumed is marked interrupted or failed, never silently completed.

## 6. Functional requirements

Each row gives a stable requirement ID, its scope target, the required behavior, and the condition that proves it. Cite these IDs in implementation plans and reviews. Release records contain candidate-specific evidence.

| Target | Meaning |
| --- | --- |
| Current | Required product behavior. |
| Capability-dependent | Required only when the connected runtime advertises the relevant ACP capability. |
| Later | Deliberately outside the current product scope. |

### 6.1 Workspace and lifecycle

| ID | Target | Requirement | Acceptance condition |
| --- | --- | --- | --- |
| WRK-01 | Current | Run as a local service with browser clients over loopback. | The workspace remains usable without a hosted Commonspace account or cloud control plane. Startup distinguishes loading from an empty workspace, offers retry after connection failure, and preserves already loaded content during refresh. |
| WRK-02 | Current | Keep the service independent from the visible client. | Closing every client does not terminate an accepted or active turn. |
| WRK-03 | Current | Limit structural workspace mutations to the human. | Agents cannot create/delete Projects, Channels, DMs, or Agents through current context tools. |
| WRK-04 | Current | Restore durable state after service or machine restart. | Conversations, context, read state, and resumable native-session mappings survive restart. |
| WRK-05 | Current | Support a one-command local installation/update path. | A clean supported machine can install, start, stop, and update Commonspace without repository knowledge. |
| WRK-06 | Later | Offer a desktop application over the same service contract. | The desktop distribution does not fork the domain or persistence model. |
| WRK-07 | Current | Support desktop keyboard operation and persistent Light/Dark/System appearance. | Workspace settings receive focus, covered conversation controls are inert, and closing restores a usable focus target. Appearance applies immediately, survives browser reload, and System follows live OS changes, including native controls. |

### 6.2 Agents and harnesses

| ID | Target | Requirement | Acceptance condition |
| --- | --- | --- | --- |
| AGT-01 | Current | Add Agents only through an explicit user-initiated discovery flow. | Startup does not silently add Agents. Discovery returns compatible installed Codex, Claude Code, Gemini CLI, and OpenCode harnesses and existing Hermes profiles; Commonspace does not create native profiles or synthetic personas. |
| AGT-02 | Current | Support known ACP harnesses through first-party adapters. | Unsupported arbitrary CLIs are rejected rather than represented as partially functional Agents. |
| AGT-03 | Current | Reuse one Agent identity across Projects, Channels, DMs, and Threads. | No per-Project Agent clone or hidden Project-specific memory identity is created. |
| AGT-04 | Current | Allow workspace-local display name, avatar/emoji, and accent changes. | Native harness identity and configuration remain unchanged; Commonspace does not create synthetic personas or behavior profiles. |
| AGT-05 | Capability-dependent | Expose models, reasoning, steering, stopping, tools, and permissions only when advertised through ACP. | Configuration controls use ACP and do not synthesize unsupported choices. Discovery may read identity metadata through the supported harness CLI; Commonspace does not mutate native profile configuration. |
| AGT-06 | Current | Avoid standalone Agent profile/dashboard requirements. | Agent discovery and context remain available through addition, DMs, Channel membership, mentions, and session indicators. |

### 6.3 Projects and references

| ID | Target | Requirement | Acceptance condition |
| --- | --- | --- | --- |
| PRJ-01 | Current | Support Projects with one or more canonical local folders. | The first root becomes the primary working directory and remaining roots are delivered as additional working directories. |
| PRJ-02 | Current | Allow messages, participant deliveries, and Threads to reference zero, one, or many Projects. | Search, context, attribution, and execution recognize every reference, not only the first. |
| PRJ-03 | Current | Treat explicit Project references as authoritative. | Inference cannot silently remove or replace an explicit reference. |
| PRJ-04 | Current | Infer Project references when none are explicit. | Every inferred reference is marked as inferred and can be corrected before or after dispatch through a new branch/reroute. |
| PRJ-05 | Current | Assign Project references per participant delivery. | Selected Agents can have different relevant Project roots. |
| PRJ-06 | Current | Let Thread references evolve prospectively. | A reply can supply `@@project` context for that turn and future defaults without a separate Project picker or rewriting earlier deliveries. |
| PRJ-07 | Current | Keep projectless conversation genuinely projectless. | An Agent in a no-Project turn receives no Project filesystem roots and starts in a neutral configured working directory. |
| PRJ-08 | Later | Add non-folder Project resource kinds. | New resource kinds extend the Project resource contract without turning Projects into tasks. |

### 6.4 Channels, DMs, messages, and Threads

| ID | Target | Requirement | Acceptance condition |
| --- | --- | --- | --- |
| CON-01 | Current | Allow universal/projectless Channels with explicit Agent rosters. | Channel creation does not require a Project or Agent. |
| CON-02 | Current | Persist every accepted message before inference or execution. | A routing or harness failure cannot erase the human's request. |
| CON-03 | Current | Create one Thread from every Channel root message. | All participant deliveries, replies, handoffs, and activity remain navigable from that root. |
| CON-04 | Current | Map one native session per participating Agent per Thread. | The same Agent resumes the same Thread session and uses a different session in another Thread. |
| CON-05 | Current | Keep DMs bound to exactly one chosen Agent. | Unaddressed DM messages never trigger Agent selection. |
| CON-06 | Current | Enforce hard `/new` DM generation boundaries. | Old context and late in-flight replies cannot enter the new generation. |
| CON-07 | Current | Deliver one structured or visible Agent handoff to a current Channel peer in the same Thread. | The target receives only sender identity and the concrete request; the Thread retains a visible `@agent` handoff without a coordinator or private Agent DM. |
| CON-08 | Current | Run different native sessions concurrently and serialize only the same session. | A slow Agent does not block unrelated Agents or Threads. |
| CON-09 | Current | Bound pathological Agent-to-Agent cycles. | One handoff is accepted per active turn; self/non-member targets are rejected; the visible workspace Agent limit and repeated directed-edge checks stop cycles with a visible outcome. |
| CON-10 | Current | Preserve queued follow-ups while a native session is busy. | The user can inspect, reorder, remove, steer where supported, or stop-and-send queued input. A bounded tray shows delivery status and expandable message previews; compact icon actions have accessible names and tooltips in both DMs and Threads. Queue changes preserve keyboard focus, returning to the composer after the final removal. Unsupported delivery controls are absent. |
| CON-11 | Current | Apply one workspace model and reasoning configuration to every conversation. | Channels do not expose, persist, or apply per-Channel model or reasoning overrides. |

### 6.5 Commonspace inference, routing, and correction

| ID | Target | Requirement | Acceptance condition |
| --- | --- | --- | --- |
| INF-01 | Current | Configure a text provider for compaction, with optional Jev routing judgments in the same Workspace settings. | Jev chooses participants, mode, order, and Project relevance in one request; code validates the choices and dispatches the original user message without an assignment-writing call. Disabling Jev restores text-provider selection using the same metadata-only delivery contract. |
| INF-02 | Current | Route every unaddressed Channel message through inference. | There is no deterministic/no-inference fallback that silently guesses an Agent. |
| INF-03 | Current | Treat explicit Agent mentions as authoritative. | Inference may select delivery mode and Project scopes for mentioned Agents but cannot substitute unmentioned Agents or rewrite the request. |
| INF-04 | Current | Select the smallest useful Agent set and delivery mode. | One Agent is preferred when sufficient; independent responsibilities use parallel assignments; explicit peer-conversation intent uses an ordered relay with at least two speakers. |
| INF-05 | Current | Remove hidden product-wide Agent fan-out caps. | Explicit or inferred requests are not silently limited to two Agents; any safety ceiling is visible and user-controlled. |
| INF-06 | Current | Deliver the original request to each selected Agent. | A first or parallel native turn contains the original user message unchanged. Separate participation metadata supplies roster responsibility and selected peers. A later relay turn includes the original message and a bounded preceding peer reply; deeper context remains available through scoped tools. |
| INF-07 | Current | Make routing inspectable. | Delivery mode, selected Agents, ordered participant deliveries, Project references, reason, and confidence where available are stored with the source message. |
| INF-08 | Current | Support service-level participant rerouting and correction. | The service/API can redirect one assignment without resending unrelated assignments, and prior attempts remain stored. Inline conversation controls are deferred. |
| INF-09 | Current | Learn from explicit corrections. | Reroutes are stored as feedback and compacted into bounded routing knowledge used by later decisions. |
| INF-10 | Current | Fail visibly when inference is unavailable or invalid. | The message remains accepted and receives a retryable needs-attention state; Commonspace does not silently broadcast it. |
| INF-11 | Current | Target effectively immediate routing. | The routing stage targets sub-second completion where the configured provider permits and reports separately from harness execution time. |

Routing retrieves bounded public conversation passages through a local, ephemeral BM25 index. Existing Thread follow-ups retrieve within that Thread; new roots can retrieve within their Channel. Channel instructions, Thread starting context and current notes, pins, prior ownership, and recent messages accompany retrieved evidence. Retrieval excludes native sessions, host files, and private traces. Jev uses a two-second request deadline with no automatic transport retry; uncertain or incompatible consumed judgments fail visibly. Initial Choice confidence and Noul thresholds are conservative policy defaults requiring domain evaluation, rather than a guarantee of correctness.

### 6.6 Shared context and compaction

| ID | Target | Requirement | Acceptance condition |
| --- | --- | --- | --- |
| CTX-01 | Current | Maintain canonical Commonspace context separately from private native-session context. | Shared context can be inspected without exposing native session internals. |
| CTX-02 | Current | Store Channel summary, decisions, open questions, pins, source boundary, origin, estimated pressure, and compaction state. | The current representation has enough metadata to explain whether it is empty, current, stale, compacting, or failed. |
| CTX-03 | Current | Snapshot Channel context when a Thread begins. | Later Channel changes do not silently rewrite the Thread's inherited starting context. |
| CTX-04 | Current | Maintain Thread-specific context after the snapshot. | A Thread can compact its own history and still inspect newer Channel context separately. |
| CTX-05 | Current | Include recent verbatim messages alongside compacted context within bounded reads. | Agents can distinguish source conversation from inferred summaries. |
| CTX-06 | Current | Trigger automatic compaction primarily from context/token pressure. | A fixed message count alone is not the authoritative trigger. |
| CTX-07 | Current | Allow manual compaction and direct human editing. | A user can update the canonical summary, decisions, and questions without changing private harness memory. |
| CTX-08 | Current | Preserve human-authored context. | Automatic projection marks human context stale when needed and never silently replaces it. |
| CTX-09 | Current | Expose bounded context through scoped tools. | An Agent can read only the conversation and Project scope granted to its current native session. |
| CTX-10 | Later | Accept Agent-suggested durable context. | No Agent response can silently promote itself into canonical memory. |

Automatic Channel and Thread context refresh runs as tracked background work, coalescing repeated refreshes for one Thread. It does not hold the conversation delivery queue while awaiting inference. Idle and shutdown account for these jobs; newer human edits remain authoritative and newer messages update source coverage. Native session resumption and native compaction remain harness-owned.

### 6.7 Message versions, deletion, pins, and files

| ID | Target | Requirement | Acceptance condition |
| --- | --- | --- | --- |
| MSG-01 | Current | Edit delivered human messages through visible branching/versioning. | Editing creates a new branch and new downstream native turns; the old branch remains navigable. |
| MSG-02 | Current | Preserve deletion markers for delivered messages. | The transcript records that content was delivered even when its body is removed. |
| MSG-03 | Current | Keep Agent replies immutable as harness output. | A human cannot edit an Agent reply and misrepresent it as native output. |
| MSG-04 | Current | Pin messages, files, and human notes into shared context. | Pins identify their source, scope, and removal state and are available to scoped context reads. |
| FIL-01 | Current | Allow humans to attach general local files to messages. | Supported files persist, render or download safely, and reach the intended Agent session. |
| FIL-02 | Capability-dependent | Accept harness-generated files as Agent attachments. | A supported ACP artifact becomes a durable Commonspace attachment whose managed metadata omits its source host path. File contents remain unchanged. |
| FIL-03 | Current | Bind attachments to exact message versions. | Editing/branching does not silently move an attachment to another version. |
| FIL-04 | Current | Block known credential-bearing files. | Human files and harness artifacts validate proposed names; harness artifacts also validate source and canonical resolved filenames before bytes are copied. Symlinks cannot disguise a credential file or escape an allowed root. |
| FIL-05 | Current | Keep Project file/Git surfaces read-oriented. | Commonspace may show files, changes, diffs, and emitted verification but does not become a Git client or execution manager. |

### 6.8 Harness activity, controls, and outcomes

| ID | Target | Requirement | Acceptance condition |
| --- | --- | --- | --- |
| ACT-01 | Capability-dependent | Stream and persist normalized ACP reasoning summaries, plans, tool calls/results, native context-compaction lifecycle, usage, and model information. | Activity stays expandable and collapsed by default; raw terminal output is not synthesized into it. |
| ACT-02 | Capability-dependent | Render native permission requests with only harness-provided choices. | Selecting a choice returns that exact response to the affected harness session. |
| ACT-03 | Capability-dependent | Support native stop and steering controls. | Unsupported controls are absent, not disabled promises. |
| ACT-04 | Current | Bind results and evidence to the originating request and participant delivery. | Replies can expose changed files, Project/root attribution, activity, and harness-emitted validation evidence. |
| ACT-05 | Current | Surface run outcomes without overstating inference. | Completed execution, text-inferred possible input, confirmed native permissions, failed, silent, cancelled, timed out, and interrupted states remain distinguishable; trailing punctuation alone does not claim a blocked run. |
| ACT-06 | Current | Scope blocking to the affected native session. | A permission request or slow turn does not block the Channel or other Agent sessions. |

### 6.9 Inbox, search, and notifications

| ID | Target | Requirement | Acceptance condition |
| --- | --- | --- | --- |
| DSC-01 | Current | Track durable unread state for Agent replies and relevant system outcomes. | Read state survives restart and opens the exact conversation location. |
| DSC-02 | Current | Provide an attention-focused Inbox. | Replies, mentions, permission requests, needs-input outcomes, and failures can be filtered and navigated exactly. |
| DSC-03 | Current | Search messages, Threads, Channels, Agents, Projects, and attachments. | Projects are searchable destinations by name; matching replies target the exact message. Project filters match any referenced Project, not only the primary compatibility reference. Users can combine content types, inspect/remove active filters, and reset filters without clearing the query. Query controls remain fixed while results scroll; pending requests cannot activate stale results. Search errors offer retry with query and filters preserved, and progress/result counts are announced. |
| DSC-04 | Current | Support desktop notifications for replies, mentions, permissions, and failures. | Each notification identifies the event type and opens the exact message/activity. |
| DSC-05 | Current | Make notifications configurable without muting durable Inbox state. | Disabling OS notifications does not hide attention items inside Commonspace. |

### 6.10 Persistence, privacy, and portability

| ID | Target | Requirement | Acceptance condition |
| --- | --- | --- | --- |
| DAT-01 | Current | Persist versioned, sanitized state atomically with rollback recovery. | A partial/invalid write does not replace the previous valid state. |
| DAT-02 | Current | Keep Commonspace-managed credential, MCP capability, native-session, and absolute host-path fields private. | Browser, activity, search, and portable archive metadata omit these managed values. This guarantee does not cover sensitive information supplied in conversation text or attachment contents. |
| DAT-03 | Current | Provide an open, versioned export of workspace data and attachments with managed private fields omitted. | The archive format and supported size contract are documented and usable without Commonspace cloud services. A successful supported export fits the HTTP restoration workflow, preserves exact attachment bytes, and remains unencrypted private user data. |
| DAT-04 | Current | Validate imports and resolve local resource mappings explicitly. | Import cannot overwrite current state or assume that exported absolute paths exist; malformed or oversized input cannot partially activate state or leave copied attachment bytes. |
| DAT-05 | Current | Keep data indefinitely by default and provide explicit retention controls. | No fixed append/load window silently drops accepted messages; destructive cleanup is scoped, previewable, and does not silently rewrite delivered history. |
| DAT-06 | Current | Disclose configured inference data flow. | The user can see whether inference is local or remote and what categories of conversation/context may be sent. |
| DAT-07 | Later | Migrate transcripts to a relational store only after measured need. | The product model and export format do not depend on the current JSON persistence implementation. |

## 7. Context model

Commonspace assembles context for each request from the layers below. It must preserve where each piece came from so agents and people can distinguish the current instruction, human notes, source messages, and generated summaries.

| Layer | Scope | Contents | Lifecycle |
| --- | --- | --- | --- |
| Project context | Per Project reference | Resource identity, permitted roots, relevant files/changes when requested | Changes with Project resources and per-message references |
| Channel context | Per Channel | Summary, decisions, questions, pins, compacted history | Shared across Threads; editable and pressure-compacted |
| Thread snapshot | Per Thread | Channel context revision captured when the Thread begins | Immutable starting reference |
| Thread context | Per Thread | Thread summary, decisions, questions, pins, recent messages | Evolves and compacts independently |
| Routing memory | Workspace/Channel bounded | Compacted explicit reroute corrections | Updated only from correction events |
| Native context | Per Agent native session | Harness-owned private session state | Opaque and controlled by the harness |

### Context precedence

1. Current explicit human instruction.
2. Explicit Agent and Project references on the current message.
3. Human-edited Thread context and pins.
4. Human-edited Channel context and pins.
5. Recent verbatim conversation.
6. Automatically compacted Thread and Channel context.
7. Routing memory for routing only.

Inference output cannot override an explicit current-message reference. Automatically generated context must remain distinguishable from human-authored context.

### Compaction state

| State | Meaning |
| --- | --- |
| Empty | No meaningful compacted representation exists yet. |
| Current | The representation covers the recorded source boundary. |
| Stale | New source content exists beyond the representation or a human edit requires reconciliation. |
| Compacting | Inference is producing a replacement or merge. |
| Failed | The most recent compaction failed; the last valid representation remains available. |

## 8. Routing model

For each Channel root or newly routable follow-up, the inference layer produces a bounded decision containing:

- Resolved explicit and inferred Project references.
- Selected Agent IDs.
- Delivery mode: `parallel` or `relay`.
- One delivery reference per selected Agent; no rewritten task text.
- Project references relevant to each participant delivery.
- A concise routing reason.
- Confidence when the provider supplies a meaningful value.

The original human message remains the source record and stays visible. Delivery references contain Agent and Project metadata, never rewritten requests. Historical wording is retained as `legacySubRequest` for inspection and is never used for execution.

The routing response uses a bounded output budget sized for the visible maximum assignment count. Commonspace detects provider-reported truncation where available and may retry inference once. It validates the delivery mode and entire assignment set, including Agent IDs, count, and Project scopes, before dispatching any Agent work. `relay` requires at least two ordered assignments.

### Reroute semantics

- A service-level correction targets one participant delivery.
- The original assignment and any response remain retained in routing history.
- A correction changes the selected Agent and explicitly supplied Project scope; it cannot replace request text.
- The new Agent receives the original user message plus responsibility metadata and scoped shared context.
- The correction event becomes routing feedback.
- Feedback compaction may generalize patterns but cannot edit historical routing records.
- Stored correction history is inspectable in expanded routing receipts; inline reroute editing remains deferred from the conversation UI.

### Inference failure semantics

- Invalid, empty, timed-out, or unavailable inference does not broadcast the full message.
- The accepted source message remains visible with a routing-failed attention state.
- The user can retry inference, edit/branch the source, or explicitly address an Agent.
- Commonspace logs bounded diagnostics without storing provider secrets or raw sensitive payloads.

## 9. Conversation and execution states

These states explain what happened to a message or agent turn. They belong to the conversation and do not create a separate task workflow.

| State | Meaning |
| --- | --- |
| Accepted | The source message is durably stored. |
| Routing | Commonspace inference is resolving assignments/context. |
| Queued | Input is waiting for the same native session to become available. |
| Running | The harness accepted the native turn. |
| May need input | Completed reply text explicitly asks for information, but the runtime supplied no structured blocking state. |
| Needs input | A persisted confirmed input state requires the human. Native permissions use their separate exact permission state. |
| Completed | A normal Agent result was recorded. |
| Silent | The harness completed without a user-facing reply. |
| Failed | Routing or harness execution failed with an actionable reason. |
| Cancelled | The human or a hard boundary stopped the turn. |
| Timed out | A configured execution boundary elapsed. |
| Interrupted | The service stopped and the harness could not resume the in-flight turn. |

## 10. Safety, privacy, and reliability

### Local and network behavior

- Commonspace binds its service to loopback and guards mutations by origin.
- ACP runs locally between Commonspace and supported harness processes.
- Commonspace does not copy or manage harness credentials.
- Connected runtimes may send messages and context to their configured model services. Their network behavior remains under the runtime's control.
- Jev sends bounded routing state to TypeSafe; a user-configured OpenAI-compatible inference endpoint may also be remote. Commonspace must clearly disclose that routing/context data can leave the machine in this configuration.
- Inference receives only the bounded message, candidate metadata, Project labels/references, and relevant shared context required for its function. Project file contents are not included by default.

### Data handling

- Commonspace-managed native session references, absolute host paths, capabilities, and credential fields remain private to the service.
- Persisted activity and error data is bounded and sanitized.
- Attachments are stored locally with private metadata and served only through authorized loopback requests.
- Project previews, Git diffs, and attachments share one known credential-filename policy. Previews check requested and canonical names; Git diffs also check deleted paths and rename sources. Preview delivery and untracked text diffs read through the validated file descriptor. This does not scan or remove sensitive information from arbitrary conversation text or file contents.
- Git previews disable external diff programs, text converters, filesystem monitor commands, and configured clean/process/smudge filters without rewriting repository configuration. Filter-backed files are compared as stored on disk. The installed browser UI rejects framing by other pages.
- Portable exports omit managed credential, native-session, capability, and absolute-path fields. Conversation text and exact attachment bytes remain in the archive and may contain sensitive information supplied by their authors.

Workspace archives are unencrypted private user data. Removing Commonspace-managed metadata does not make their content safe to publish. See [Workspace archive format](workspace-archive-format.md#privacy-boundary) for the exact export boundary.

### Reliability invariants

- Once a message is accepted, later failure cannot erase it.
- Accepted messages are never evicted by an implicit count cap; bounds apply to derived context and activity, not the canonical transcript.
- `/new`, Agent removal, Channel removal, and shutdown are hard generation boundaries.
- Stale replies from cancelled or replaced generations cannot mutate the current conversation.
- Same-session calls are serialized; unrelated sessions remain concurrent.
- State changes are versioned, sanitized, migration-tested, and atomically persisted.
- A failed compaction keeps the last valid context.
- A failed inference decision never silently becomes an all-Agent broadcast.
- A routing retry completes and validates before dispatch, so it cannot duplicate Agent execution.
- A supported export is bounded before download to the size accepted by the documented HTTP import workflow.

## End-to-end acceptance scenarios

| ID | Scenario | Required result |
| --- | --- | --- |
| E2E-01 | Send a projectless unaddressed Channel message | It is persisted, routed by inference, dispatched to the smallest useful Agent set without Project filesystem access, and recorded in one Thread. |
| E2E-02 | Ask backend and frontend work spanning two Projects | Inference creates inspectable Original message + participant scope with the correct Project subset; sessions run concurrently and replies share one Thread. |
| E2E-03 | Mention an Agent not seated in a Channel | The Agent is added and invoked immediately without replacing explicit routing intent. |
| E2E-04 | Continue the same Agent in two Threads | Each Thread resumes its own native session and both may run concurrently. |
| E2E-05 | Use `/new` during an active DM | The old generation is cancelled or isolated, a visible boundary appears, and no late reply crosses into the new session. |
| E2E-06 | Reach Channel context pressure after a human edit | Context becomes stale, compaction preserves human-authored meaning, and state/source boundaries remain inspectable. |
| E2E-07 | Edit a delivered routed message | A new visible branch is routed independently while the original branch and native results remain intact. |
| E2E-08 | Call the service-level reroute for one bad assignment | Only that participant delivery is redirected; other Agents are not restarted, and the correction enters routing memory. Inline conversation controls remain deferred. |
| E2E-09 | Attach a normal file and receive an Agent file | Both attachments remain bound to their exact messages. Managed attachment metadata omits source host paths and credential fields; the file contents remain unchanged. |
| E2E-10 | Receive a permission request while the client is closed | The service keeps the request pending, other sessions continue, and reopening shows an exact attention item with harness-provided choices. |
| E2E-11 | Restart after a conversation exceeds the legacy 500-message boundary | Every accepted message and its context restore, resumable sessions continue exactly, and unrecoverable in-flight work is marked interrupted. |
| E2E-12 | Export and import into a clean workspace | Conversation data and exact attachment bytes import safely. Managed private fields are omitted from the archive, and local Project roots require explicit remapping. |
| E2E-13 | Open an added Agent's capabilities and refresh | Native metadata loads on demand with source, scope, and inspection time. Search reveals matching items; unavailable inspection differs from empty inventory. No native configuration, private memory content, or workspace data is changed. |

## Definition of done

The current product scope is complete when:

1. Every `Current` requirement above has automated contract/service coverage and a verified user-facing path.
2. Capability-dependent behavior is tested against each supported harness that advertises it.
3. All end-to-end acceptance scenarios pass on a clean supported machine.
4. Existing state versions migrate without dropping conversations, context, references, attachments, or read state, including transcripts beyond legacy count windows.
5. The browser client works at desktop sizes with keyboard-only operation and Light/Dark/System appearance. Narrow and mobile layouts are deferred.
6. The local service can be installed, started, stopped, updated, and recovered without repository knowledge.
7. Portable and browser-visible metadata omit Commonspace-managed credentials, absolute paths, native session IDs, and ephemeral capabilities. This guarantee does not imply that user-supplied text or files have been stripped of sensitive content.
8. Product documentation and the roadmap agree on current behavior.

## Deliberately deferred decisions

These decisions do not block current behavior and should be made only when their release slice begins:

- Desktop packaging technology.
- Additional ACP harnesses beyond the first-party supported set.
- Non-folder Project resource types.
- Relational persistence technology and migration timing.
- Plugin/extension architecture.
- Hosted or multi-human collaboration.

These are technical or later-scope choices, not unresolved current product behavior.
