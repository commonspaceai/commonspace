# Commonspace product direction

Commonspace is an Electron workspace for one person working with agent runtimes on a user-controlled host. A host is the computer or server that runs Commonspace, the agents, and the project files. This page defines the product boundary. Read the [Product model](product.md) for concepts, the [Product specification](product-spec.md) for exact behavior, and the [Roadmap](../../ROADMAP.md) for delivery stages.

## Positioning

**The workspace for the agents you already use.**

Commonspace puts several coding agents around one visible conversation. Conversation is the work record. Commonspace supplies shared context, routing, continuity, and review around the runtimes. The Electron app is the primary client. Private browser access lets the same person check agent work and continue conversations from another device.

An **agent runtime**, or **harness**, is software on the host that runs an agent. It owns the agent's tools, credentials, models, permissions, private context, and native sessions. Commonspace connects supported runtimes through the **Agent Client Protocol (ACP)**. Read-only capability browsing also uses native inventory sources, with explicit provenance and coverage limits. Native configuration and memory contents remain private.

## Commonspace owns

- Projects and visible Project references.
- Channels, Direct Messages, messages, and Threads.
- Agent membership, workspace presentation, and conversation state.
- Routing, shared context, native-session mapping, and continuity.
- Attachments, search, Inbox state, notifications, and workspace export/import.
- Desktop lifecycle and private browser connections to the same host.
- Local folder references and GitHub repository import by cloning onto the host.

## The harness owns

- Native identity and execution behavior.
- Models, reasoning modes, tools, and permission semantics.
- Native session internals, private context, and transcripts.
- Runtime-specific configuration, credentials, and raw debug output.

Commonspace must not invent a runtime capability, copy private runtime data, or turn a harness feature into a new product object without an explicit product decision.

## Host and clients

One running Mac owns workspace state, project files, agent processes, and exact native-session mappings. Every connected client presents that host's workspace. Closing a window or choosing **Quit Commonspace** leaves agent work running. **Stop Hosting** explicitly stops the host. Electron can reopen the same host or attach to an independently started source host.

Local folders remain Project resources. GitHub import clones a selected repository onto the host and registers that checkout as a Project folder. Agents, file previews, and Git inspection use the host checkout through the existing Project model. Commit, push, and pull-request work stays in agent conversations.

Remote browser access uses Tailscale Serve over HTTPS and accepts only the configured owner's identity. The first release uses one always-on Mac, including when the viewing device is a phone. Clients use the host API and do not maintain independent transcript copies or mirror arbitrary host files.

## Delivery stages

The current implementation is a source-launch Electron preview over the existing service and React client. The published npm package remains available in a desktop browser. Signed Mac installers and automatic updates are planned.

The source host supports private browser access and GitHub import. Both listeners remain loopback-only; Tailscale supplies HTTPS, network access, and device removal. Commonspace checks owner identity, Host, and browser origin. Lost send responses can be retried without another accepted message or Agent run. Real tailnet, phone, and reboot acceptance still need to be recorded for a release candidate.

## Product boundary

- Electron is the primary desktop client. The browser client uses the same workspace and service contract.
- Agent addition is explicit. Commonspace supports only first-party integrations for known ACP runtimes; see the [support matrix](../start/support.md).
- Agents are peers in shared conversations. There is no coordinator, org chart, task hierarchy, or separate handoff system.
- Projects provide context; they do not own tasks, Channels, or agent copies.
- Mobile access uses the shared web client connected to the same host. A separate Expo app is deferred to the [Roadmap](../../ROADMAP.md#later).
- Local-first means the user controls the host and its data. Remote access does not require a hosted Commonspace account or cloud control plane.
- Commonspace is not a hosted team service, model provider, IDE, or full Git client.

Shared access for additional people and multiple execution hosts are outside the first release. The current direction assumes one person connecting across devices to one Mac.

## Decision filter

A feature belongs when it improves conversation, routing, shared context, session continuity, discoverability, trust, or access to one person's agents across devices.

Before adding one, identify the user problem, the existing Commonspace object that owns it, and the behavior that proves it solved. Changes to this boundary require an explicit product decision.
