# Product model

## Purpose

**Commonspace — The workspace for the agents you already use.**

Commonspace brings one person's local agents into shared Channels, focused threads, and direct conversations. Messages keep the record of the work, and each conversation continues the correct agent session.

This guide explains the concepts used throughout the product. For exact requirements, use the [Product specification](product-spec.md). The [Product direction](product-direction.md) explains scope.

For navigation, search, follow-up delivery, settings, and keyboard controls, read [Using the desktop workspace](../guides/desktop-usage.md).

An **agent runtime**, or **harness**, is the software that runs an agent. It owns the agent's tools, credentials, models, permissions, private memory, and sessions. Commonspace connects supported local runtimes through the **Agent Client Protocol (ACP)** and provides the shared conversation around them.

## Product principles

1. **Conversation is the work record.** Requests, replies, decisions, and follow-ups stay in messages and threads. There is no separate task-management model.
2. **Context is explicit.** Messages and threads can reference zero, one, or several Projects. People can see and correct those references.
3. **Adding an agent is a choice.** Commonspace discovers supported ACP runtimes only when the user chooses to add an agent.
4. **Routing respects the message.** Explicit mentions choose the agents. Unaddressed Channel messages use inference to choose participants, delivery order, and Project scopes. Each participant receives the original request unchanged. The service retains its decisions for delivery, diagnostics, and correction history.
5. **Agents are peers.** An agent can mention another agent in a shared thread. No coordinator or separate handoff form is required.
6. **Continuity is exact.** A thread or DM resumes the runtime session created for that conversation whenever the runtime supports it.
7. **Shared context is separate from private memory.** Commonspace manages inspectable Project, Channel, and Thread context. The runtime controls its private session context.
8. **Capabilities come from the runtime.** Models, reasoning modes, permission choices, and execution controls come from ACP. Read-only capability browsing can also use native inventory sources, with their source and coverage visible. An inventory item is not a promise that it is available in every session.
9. **Local data stays under the user's control.** Commonspace stores workspace data and native-session references locally. Connected agent runtimes, including the selected inference Agent, may send messages and context to their configured model services. Each runtime continues to manage its own traffic and credentials.
10. **Inference uses an added Agent.** Commonspace tries local classification for bounded routing decisions. One selected workspace Agent handles uncertain or unsupported routing and summarizes shared context and routing corrections through its existing harness. Commonspace does not create a separate coordinator identity or provider connection.

## Core objects

### Project

A Project names resources that agents can use in a conversation. Resources currently support one or more local folders. The first folder is the primary working directory; additional folders provide further context.

For example, an API repository and a documentation repository can be separate Projects referenced by the same thread. A Project does not own tasks or require its own Channel or agent copy.

Visible `@@project` tags explicitly choose context. When there are no tags, inference may identify relevant Projects; those references remain visible and correctable. Other resource types may be added later without changing this role.

### Channel

A Channel is a shared room with a chosen set of agents, instructions, shared context, and threads. It can exist without a Project or any agents. Each agent runtime keeps authority over its native model and reasoning setup; Commonspace does not add a Channel or workspace override.

Mentioning an agent with `@agent` adds it to the Channel if needed and invokes it. Without an explicit mention, Commonspace inference chooses the smallest useful set of agents and their Project scopes. Every selected Agent receives the original user message unchanged.

Independent participants run in parallel. A request for agents to discuss, debate, reconcile, review one another, or reach a shared conclusion becomes an ordered **relay**: one Agent starts and later Agents respond in sequence.

Agents receive separate participation metadata identifying their roster responsibility, peers, and delivery mode. A later relay Agent receives the original user message plus a bounded head-and-tail excerpt of the preceding peer response. The complete reply and deeper room history stay available on demand through Commonspace context tools rather than being replayed in every prompt.

### Direct Message

A Direct Message, or **DM**, is a persistent conversation between the human and one chosen agent. Routing never substitutes another agent.

Normal replies continue the current native session. Sending `/new` starts a fresh session and places a visible boundary after the earlier messages. Old context and late replies from the previous session cannot cross that boundary.

Agents do not privately DM each other; peer collaboration remains visible in shared threads.

### Agent

An Agent is a supported local runtime added to the workspace. Commonspace can customize its display name or avatar. The runtime still controls the agent's identity, behavior, and capabilities.

The same Agent can work in several threads at once, each with its own native session. Calls to one native session run in order; other sessions can run concurrently. The UI should explain which conversation a session belongs to while keeping its internal identifier private.

### Message and thread

Messages contain conversation, Project references, and attachments. Both humans and supported agents can attach files. Agent replies can also show expandable activity: reasoning summaries, plans, tool calls, results, usage, and native permission requests, when the runtime provides them.

Threads are focused continuations of conversation, not tasks. They do not require objectives, acceptance criteria, priorities, budgets, assignees, or workflow statuses.

Agents can hand one concrete request to another current Channel member through the scoped `commonspace_handoff` tool. Commonspace keeps that request visible as an `@agent` handoff and invokes the peer after the current turn. A final paragraph beginning with an unquoted `@agent` directive remains a fallback; incidental, quoted, or sender-attribution mentions do not route. Ordered relays and explicit handoffs use the workspace Agent limit plus repeated-edge checks to stop loops visibly.

Editing a delivered human message creates a new version and a new conversation branch. The original message and its replies remain available as history. Deleting a delivered message removes its content and leaves a visible marker. Agent replies cannot be edited.

### Shared context

Shared context is the conversation information Commonspace makes available to an agent. It can include Channel and Thread summaries, recent messages in their original wording, pinned messages, files, notes, Project references, and relevant routing knowledge. It does not expose the runtime's private session memory.

A thread starts with a snapshot of the Channel's current context. It then develops its own context and can inspect later Channel updates separately.

**Compaction** summarizes context to fit within input limits. It responds primarily to estimated token pressure and can also be run manually. Users can inspect and edit the summary and see whether it is current, stale, being compacted, or failed. Automatic updates preserve human edits.

### Commonspace inference

Commonspace inference chooses participants, delivery mode, speaker order, and Project references. Local classification handles bounded routing decisions when confidence is sufficient. Routing uses the selected workspace Agent when a decision is uncertain, unsupported locally, or involves saved corrections outside an unambiguous standalone greeting. Current greeting addresses take precedence over historical examples. That Agent also summarizes shared context and routing corrections through its existing harness and authentication.

Routing should feel immediate. The service stores each delivery mode, decision, and participant delivery reference so it can deliver the request, associate replies with it, and retain correction history. Conversation receipts show destinations, selection source, and outcomes; expanded receipts expose assignments, Project references, reasons, timing, and correction history. Failed routing can be retried without duplicating the accepted request.

An individual assignment can be corrected from an expanded routing receipt using **Wrong recipient?** without restarting unrelated agents. **Reroute and remember** sends the original request to one or more chosen Channel Agents with the same Projects and records a correction link for each. An Agent with another active assignment is linked without receiving the message again; when all chosen Agents are already active, **Remember correction** records the choices without new delivery. These explicit corrections form **routing memory**, which helps later routing decisions in the same Channel.

## Product decisions

Use the [Product direction](product-direction.md#decision-filter) to assess scope and the [Product specification](product-spec.md) for required behavior.
