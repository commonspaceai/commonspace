# Add support for an agent harness

Use this guide to add a supported native harness to Commonspace. Start from the [adapter proposal template](agent-adapter-template.md), then use [Claude Code](../../server/src/adapters/claude-code.ts) as the smallest complete implementation.

An adapter connects an installed agent to the workspace. It discovers existing identities and translates Commonspace settings into that harness's ACP controls. Credentials, tools, models, native configuration, and transcripts remain owned by the harness. Adding an adapter does not create Commonspace personas or install a runtime for the user.

## Supported adapters

| Adapter ID | Discovery | ACP process | Native identity |
| --- | --- | --- | --- |
| `codex` | `codex --version` | Bundled `@agentclientprotocol/codex-acp` | Installed Codex harness |
| `hermes` | `hermes profile list`, optional `profile describe` | Installed `hermes [-p <profile>] acp` | Each existing Hermes profile |
| `claude-code` | `claude --version` | Bundled `@agentclientprotocol/claude-agent-acp` | Installed Claude Code harness |
| `gemini` | `gemini --version`, supported-version check | Installed `gemini --acp` | Installed Gemini CLI harness |
| `opencode` | `opencode --version` | Installed `opencode acp` | Installed OpenCode harness |

The built-in general-purpose harnesses are Codex, Hermes, Claude Code, Gemini CLI, and OpenCode. Pi coding agent is a follow-up: its adapter must pass the same scoped MCP and native-session checks before registration. See the [support matrix](../start/support.md#agent-runtimes) for version limits.

Discovery checks installation, not authentication or model access. Diagnostics report those separately as run readiness. Discovery is explicit: startup and bootstrap never launch a discovery command. The Add Agent flow sends both adapter and native ID, so matching IDs across harnesses cannot select a different runtime. Legacy ID-only requests are rejected when ambiguous. Existing roster IDs remain unique. The flow probes only the chosen harness; diagnostics and explicit addition without a cached candidate can probe the registered set.

## Ownership and format

```text
packages/shared/src/agent-adapters.ts   IDs, display metadata, runtime guard
server/src/adapters/
  types.ts                            NativeAgentAdapter contract
  index.ts                            Exhaustive built-in registry
  discovery.ts                        Bounded discovery subprocesses
  <adapter-id>.ts                      Harness discovery, launch, settings
docs/adapters/agent-adapter-template.md Proposal and verification record
```

The shared catalog contains browser-safe metadata only. The server registry is a `Record<AgentAdapterKind, NativeAgentAdapter>`: registering a shared ID without implementing its runtime fails type checking. The HTTP schema, Add Agent choices, diagnostics, runtime labels, and activity validator use that catalog. Arbitrary executable names from HTTP requests cannot register an adapter.

Every configured adapter implements these members:

| Member | Responsibility |
| --- | --- |
| `privatePaths` | List configured executable paths and argument paths for the host's redaction boundary. Never send them to the browser. |
| `discover()` | Return existing `CommonspaceAgentProfile` identities. Use bounded commands; do not authenticate, start a model turn, inspect credentials, or mutate native profiles. Throw installation failures; the host logs once and reports no candidates. |
| `inspectCapabilities(agent)` | Return browser-safe native inventory groups for the selected identity. Use bounded read-only sources; preserve source and scope, distinguish empty inventory from unsupported inspection and failure, and exclude native secrets, paths, endpoints, and memory contents. Never start a model turn or change native configuration. |
| `launch(agent, fullAccess, signal)` | Return executable, argument array, environment, and any `validateInitialization` compatibility check, synchronously or asynchronously. Honor cancellation during preflight checks and select the exact native identity. The optional check runs against ACP initialization before sending session references or MCP bindings. Never construct shell command strings. |
| `sessionSettings(input)` | Return native ACP mode, model, and config IDs. Leave unsupported settings absent. `AcpAgentProcess` applies controls only when the session advertises them. Model selection precedes model-dependent settings; finite choices are checked against refreshed options, while native model aliases remain available. |

The adapter does not implement its own message queue, subprocess pool, permission UI, transcript parser, or session persistence. `AcpAgentProcess` owns ACP framing, session setup, updates, cancellation, and process disposal. `CommonspaceHostService` owns durable acceptance, per-session serialization, independent concurrency, context scope, private session references, and recovery.

### Read-only capability sources

Open an added Agent's settings to browse and refresh inventory. This is user/profile metadata, not a promise of effective capability in every Project or session. Unsupported categories remain visible as unavailable; malformed or failed reads are shown separately from empty inventory.

| Harness | Inventory sources |
| --- | --- |
| Hermes | The documented default `hermes-acp` tool surface; profile-specific MCP, skill, plugin, agent, and memory inventory remains unavailable because native inventory commands can initialize files or execute plugin/provider hooks |
| Codex | Native MCP/plugin JSON listings and user skill folders, including system skill markers |
| Claude Code | Native plugin JSON, user agent-definition filenames, user skill folders, and global MCP configuration names without running MCP health checks; `claude agents` is not used because current versions list native sessions |
| Gemini CLI | User MCP settings and skill/extension folders with native file markers, including linked folders; no CLI initialization or MCP connections |
| OpenCode | Global MCP configuration names, including JSONC, and global skill folders; environment/project overrides are excluded |

Skill directory readers expose folder labels only when `SKILL.md` exists; they do not read prompts or establish that a skill is enabled. Native tool inventories are not universally available through ACP, so adapters without a safe tool source report that category as unavailable. Memory browsing is limited to native status metadata where supplied; private memory contents are never read into the browser. Inventory is not persisted or exported.

Resource directory scans inspect at most 2,000 entries per category. Gemini extension directories require a `gemini-extension.json` file. Claude Code's user agent inventory lists direct `.md` definition filenames; project, plugin, and built-in definitions are excluded. Missing directories return an empty inventory; unreadable markers, traversal failures, and oversized scans return an inspection error with no partial results. Marker directories do not count as files, and resource contents are never read.

## Implementation checklist

1. **Establish the native contract.** Verify the maintained bridge package and pinned version, installation/auth commands, identity discovery, `session/new`, exact `session/load`, cancellation, and MCP support against primary documentation and the shipped package. Record gaps in the proposal. An arbitrary text CLI is insufficient.
2. **Register metadata.** Add the stable ID and metadata to `AGENT_ADAPTER_KINDS` and `AGENT_ADAPTERS`. IDs become persisted data; do not rename released IDs without migration.
3. **Implement the adapter.** Add one server module and register its factory in `createAgentAdapters`. Prefer the existing ACP transport and bounded discovery helper. Preserve native configuration and auth. A built-in bridge belongs in `server/package.json` with an exact version and lockfile entry.
4. **Define identity validation.** Update `addDiscoveredAgent` in `server/src/state.ts` and `sanitizeAgents` in `server/src/service.ts`. Allow only identities discovery actually returns. Keep legacy identities loadable where history requires them. New persisted shapes or enum members require a state version and migration review, including trace and archive round trips.
5. **Wire private configuration.** Add typed path overrides in `AgentAdapterConfig`, map environment variables in `server/src/index.ts`, and document defaults in [Operations](../guides/operations.md#runtime-configuration). Add every configured private path to the adapter's redaction list. Do not expose command configuration in browser contracts.
6. **Verify without an account.** Exercise the real bridge and native runtime against a local model API fixture where the runtime supports one. Keep credentials and user configuration isolated. Synthetic ACP fixtures cover Commonspace policy but cannot establish real bridge compatibility. Include this check in normal CI; keep remote provider checks opt-in.
7. **Verify the complete flow.** Exercise explicit discovery and addition, absent installation, renamed display identity, DM and Thread continuity, service restart, `/new`, permissions, stop, emitted activity, privacy, and scoped MCP. Use existing shared lifecycle coverage for transport behavior and add focused cases for new policy.
8. **Synchronize documentation.** Update only affected canonical docs. Record release notes with the release.

## Session and capability rules

- Preserve opaque native session IDs for the same conversation scope. Resume the saved ID after restart; never use a runtime's “most recent conversation” shortcut.
- Start a different native session for a new Thread or DM generation. `/new` cancels old work and prevents stale replies from entering the replacement generation.
- Recover with a new session only for explicit missing-session errors. Authentication and transport failures retain the saved reference. Hermes has a documented compatibility path for a silent persisted session; new adapters must not inherit that exception.
- Pass only the new message or assigned request as the native turn. Deliver shared context through the scoped Commonspace MCP endpoint; never prepend the whole room transcript.
- HTTP and SSE MCP bindings require the corresponding advertised ACP capability. An unsupported transport fails before `session/new` or `session/load`; Commonspace does not send the binding or silently drop shared context. A compatibility failure retains the accepted request and saved session reference.
- Expose only emitted activity, supported controls, and native permission options. Do not invent tools, models, reasoning levels, or approval choices.
- Full access must be an explicit workspace choice or documented operator setting. Ordinary operation uses the adapter's native permission configuration. Permission requests block only their session. Changing effective access replaces cached processes while retaining native session references; either access change cancels that agent's active work and pending permissions. Queued work reads the current access policy before launch.
- No shell interpolation, credential copies, global native configuration writes, or native-session paths in bootstrap, activity, errors, or portable archives.

## Hermes setup

Install and configure [Hermes Agent](https://hermes-agent.nousresearch.com/docs/quickstart), then verify its dedicated ACP host surface without starting a model turn:

```bash
hermes --version
hermes acp --check
hermes profile list
```

In Commonspace, choose **Add Agent → Hermes**, then add the discovered native profile. Commonspace discovers identities with `hermes profile list` and invokes the selected profile as `hermes [-p <profile>] acp`; it does not copy credentials or rewrite Hermes configuration. The optional executable overrides are `COMMONSPACE_HERMES_PATH` for discovery and `COMMONSPACE_HERMES_ACP_PATH` for launch.

The Agent settings capability browser lists the documented default `hermes-acp` tool names as the supported integration surface. It deliberately does not run Hermes inventory commands: local dependencies, profile configuration, and session policy still determine whether a configured tool is available during a turn.

## Claude Code setup

Install and authenticate [Claude Code](https://code.claude.com/docs/en/quickstart) separately. Confirm `claude --version` and `claude auth status`, then choose **Add Agent → Claude Code → Add discovered agent Claude Code**. A custom executable uses an absolute path in `COMMONSPACE_CLAUDE_CODE_PATH`. Commonspace passes that executable to the bridge through `CLAUDE_CODE_EXECUTABLE`; the bridge uses native Claude authentication and configuration.

The adapter pins [`@agentclientprotocol/claude-agent-acp`](https://github.com/agentclientprotocol/claude-agent-acp) and launches its executable entry point with Node. This is the maintained successor to `@zed-industries/claude-code-acp`. The normal ACP mode is `default`; explicit Full access requests `bypassPermissions`. Model selection uses ACP `model`. Native effort levels `low`, `medium`, `high`, and `max` map to `effort`; other Commonspace reasoning values leave the native default intact. Controls still depend on the bridge's advertised capabilities.

One Claude Code identity is added. Claude subagent definitions, plugins, memory files, and credentials remain managed by Claude. Commonspace does not turn `.claude/agents` entries into separate workspace identities.

## Gemini CLI and OpenCode setup

[Gemini CLI](https://geminicli.com/docs/cli/acp-mode/) supplies ACP directly through `gemini --acp`. Commonspace's compatibility baseline accepts stable versions `>=0.39.1` and `<0.44.0` and tests `0.43.0`; this is not certification of safe longer-history replay, which remains blocked below. Discovery and each process launch recheck the CLI version. ACP initialization also checks the launched runtime's reported version, including when a separate ACP executable is configured. Missing, malformed, prerelease, and unsupported versions fail before session data is sent. Expand the range only after the real runtime fixtures, including the longer-history check, pass. The normal mode is `default`; Full access requests `yolo`. Model selection uses the advertised native model control. Reasoning settings remain native defaults.

[OpenCode](https://opencode.ai/docs/acp/) supplies ACP through `opencode acp`; version `1.18.29` is covered by the real runtime fixture. Its normal permissions come from native configuration. Explicit Full access sets `OPENCODE_PERMISSION` to `{"*":"allow"}` for the child process only. Native `build` and `plan` modes are agent choices, so Commonspace does not treat them as approval modes. Model and effort settings use advertised ACP config options.

Configure authentication and model access in each native runtime, then choose **Add Agent → Gemini CLI** or **Add Agent → OpenCode**. Each adds one native harness identity. Private executable overrides are `COMMONSPACE_GEMINI_PATH` and `COMMONSPACE_OPENCODE_PATH`; optional ACP executable overrides use `COMMONSPACE_GEMINI_ACP_PATH` and `COMMONSPACE_OPENCODE_ACP_PATH`. Commonspace does not copy credentials or rewrite native configuration.

### Gemini revalidation evidence

On September 14, 2026, the account-free one-turn fixture passed native restart/resume, fresh context, and scoped context/progress with `@google/gemini-cli` **0.43.0**. A longer-history check exposed a separate defect: after six native turns, old assistant replies were appended to the new resumed reply. A protocol capture confirmed that `session/load` responded before the remaining history updates. The [shipped `0.43.0` implementation](https://github.com/google-gemini/gemini-cli/blob/v0.43.0/packages/cli/src/acp/acpSessionManager.ts) calls asynchronous `streamHistory` without awaiting it; inspected `0.39.1` source has the same problem. Safe longer-history replay is therefore **not verified**. Commonspace does not fix this by sleeping for a guessed interval, deduplicating legitimate output, or replaying its own transcript.

Current stable **0.59.0**, temporarily admitted only in the verification branch, passed scoped MCP but failed `session/load` after a service restart with an ACP `Internal error`. The accepted continuation remained failed in the transcript. The temporary admission was removed; the version range has not expanded. Upstream also tracks [history restoration failures](https://github.com/google-gemini/gemini-cli/issues/27913) and [same-minute session reload failures](https://github.com/google-gemini/gemini-cli/issues/28693); those reports do not establish compatibility for a particular release.

For another candidate, install its exact version outside the repository, temporarily admit only that version in a verification branch, and run `pnpm verify:adapter:gemini` with `COMMONSPACE_TEST_GEMINI_PATH` set to its executable. Also run the longer-history regression:

```bash
COMMONSPACE_GEMINI_RESUME_STRESS=1 pnpm exec vitest run tests/native-agent-integration.spec.ts -t 'longer native history'
```

This opt-in regression records the known upstream blocker; it is not included in the passing baseline gate. Both test-only settings use isolated credentials and configuration and still pass through the production version checks. Keep a support expansion only when every real-runtime check passes, then pin the verified test dependency and update this record. Do not use a different claimed CLI version or bypass session loading to obtain a passing result.

## Pi integration status

Pi is not registered as a supported adapter. The ACP Registry's published [`pi-acp` 0.0.33](https://github.com/svkozak/pi-acp/tree/1bfcb394088ed879db8fd936b570bb626017f878) advertises HTTP and SSE MCP as unsupported. Its shipped implementation stores `mcpServers` on session creation/load but never wires them into Pi. Consequently it cannot deliver Commonspace's scoped context and progress tools. This was confirmed from the published package on September 14, 2026; native restart/resume through Commonspace has not been certified for Pi.

[Pi itself leaves MCP to extensions](https://pi.dev/). Installing an independent MCP extension is not evidence that ACP session bindings, bearer capabilities, reset isolation, and concurrent sessions work. A candidate bridge must pass those checks using the existing ACP transport and native Pi session authority before its adapter can be registered. Commonspace does not copy private Pi transcripts, replay conversation history as a resume substitute, or write a global MCP configuration to work around this blocker.

## Verification commands

Use [Development](../guides/development.md) for general checks. Adapter-specific checks:

```bash
pnpm verify:adapters
pnpm verify:adapter:claude-code
pnpm verify:adapter:gemini
pnpm verify:adapter:opencode
```

Provider-backed harness checks are opt-in and may consume model usage. Run them only with the relevant installed, authenticated runtime. They use a temporary Commonspace workspace:

```bash
pnpm verify:acp:claude-code
pnpm verify:acp:mcp:claude-code
```

The first check starts Claude, restarts the service, and verifies native recall using the saved session. The second verifies scoped Channel context and visible progress through MCP. Record the exact CLI/bridge versions and results; a passing synthetic ACP test does not establish real bridge compatibility.

### Account-free runtime verification

`pnpm verify:adapters` runs the pinned real Claude Code, Gemini CLI, and OpenCode runtimes against loopback Anthropic Messages and Gemini API fixtures. Run one harness with `pnpm verify:adapter:claude-code`, `pnpm verify:adapter:gemini`, or `pnpm verify:adapter:opencode`. Each child receives an explicit environment, synthetic credentials, and temporary native configuration/session directories. No login, provider key, or separately installed CLI is needed. Gemini CLI and OpenCode are development-only test dependencies; production uses the user's installed executables. These tests also run in `pnpm test` and `pnpm check`.

The fixture replaces only model responses. The real runtime stores and reloads native history, calls the real Commonspace MCP endpoint, receives permission choices, and posts progress through the real HTTP service. Tests assert exact session continuity after service restart, `/new` context isolation, scoped context without unrelated Channel data, and persisted progress. Capability checks exercise the real inventory sources without a model turn, expose only safe metadata, and preserve the seeded native resources and workspace data. Codex/Hermes inventory tests remain synthetic/source-based; these checks do not claim live capability validation for them. A separate shutdown regression verifies that the bridge can flush its native child before forced termination.

Fixture versions: `@agentclientprotocol/claude-agent-acp` 0.75.0 with bundled Claude Code 2.1.257, `@google/gemini-cli` 0.43.0, and `opencode-ai` 1.18.29. Gemini's longer-history replay limitation above prevents full compatibility certification. These checks do not prove remote model quality, account access, or compatibility with every separately installed CLI.

For actual conversations, Claude Code can also use a configured [Anthropic-compatible gateway](https://code.claude.com/docs/en/gateways). A gateway credential can replace subscription login; a functioning model backend is still required. Commonspace leaves that routing and authentication in the native environment.
