# Operations

Use this guide to configure, inspect, update, back up, and recover a local Commonspace instance. [Installation](../start/install.md) covers the first launch. [Development](development.md) covers the source editing workflow.

Jump to [configuration](#runtime-configuration), [workspace inference](#workspace-inference), [macOS service](#installed-macos-service), [local data](#local-data), [troubleshooting](#common-failures), or [backup and rollback](#backup-and-rollback). See the [documentation index](../README.md) for other guides.

## Runtime

See [Installation](../start/install.md) for the published package and first launch.

To run production builds from source:

```bash
pnpm build
pnpm start
```

In a second terminal, start the built UI:

```bash
pnpm --filter @commonspace/ui preview
```

Open the preview URL printed by Vite. The source server binds to `127.0.0.1:3100` and serves the API and root health check. It does not serve UI assets unless `COMMONSPACE_UI_ROOT` is set. The npm command and installed macOS service set that directory automatically so the UI and API share one origin.

## Runtime configuration

The server reads these variables at startup. They apply to the foreground process in which they are set. The installed macOS service uses the environment written into its LaunchAgent and does not automatically inherit later shell changes.

### Server settings

| Variable | Default or behavior |
| --- | --- |
| `COMMONSPACE_PORT` | API port; defaults to `3100`. Accepts `0` for an operating-system-assigned port. |
| `COMMONSPACE_HOME` | Local state directory; defaults to `~/.commonspace`. Use a separate directory for development or verification. |
| `COMMONSPACE_UI_ROOT` | Built browser asset directory. The source server serves no UI when unset; npm/service launchers set it. |
| `COMMONSPACE_LOG_LEVEL` | Server log level; defaults to `info`. |
| `COMMONSPACE_OTLP_ENDPOINT` | Optional OTLP/HTTP collector origin on loopback, such as `http://127.0.0.1:4318`. Unset by default; remote hosts, paths, credentials, and query strings are rejected. |

### OpenTelemetry

When `COMMONSPACE_OTLP_ENDPOINT` is set, the server exports traces and named exception logs to the local collector's `/v1/traces` and `/v1/logs` endpoints. For example, start a local OTLP/HTTP collector on port `4318`, then run `COMMONSPACE_OTLP_ENDPOINT=http://127.0.0.1:4318 pnpm start`. Shutdown flushes pending records with a bounded timeout. The first failed export prints a generic warning that records may be missing; the server still shuts down normally.

The initial operation spans cover sent and edited message requests and logical Agent runs, with a child span for each Agent attempt. The message span's status describes the full send or edit request; `commonspace.message.accepted=true` records that the message was persisted even if later follow-up activation fails. Edit spans begin after input and source validation, then cover DM reset, persistence, and follow-up activation. Message fields include bounded conversation kind and delivery mode. Agent fields include adapter, session reuse, response length, and final outcome. Intentional Agent cancellation has a `cancelled` outcome without an error status; an inference deadline has a failed `timeout` outcome. A recovered missing-session attempt emits a `WARN` exception log; terminal failures emit an `ERROR` exception log. Logs produced by the server's Pino logger include trace and span IDs when a span is active. The saved Agent activity trace shown in the workspace is separate from OpenTelemetry.

Exported records omit message and response text, domain IDs, Project paths, native session IDs, credentials, raw exception messages, and stack traces. Exception records retain bounded error and cause types without setting `exception.message`. The configured resource identifies only `service.name=commonspace`. Keep the collector local and control its retention and forwarding separately.

### Agent executables

Each harness's executable and ACP override are listed together. For installation and sign-in, see [runtime setup](../start/runtimes.md).

#### Codex

| Variable | Default or behavior |
| --- | --- |
| `COMMONSPACE_CODEX_PATH` | Explicit Codex execution override; the ACP bridge uses its bundled compatible CLI by default. Discovery and capability inspection use `codex` unless overridden. |
| `COMMONSPACE_CODEX_ACP_PATH` | Overrides the Codex ACP bridge executable; the bundled bridge is used by default. |

#### Claude Code

| Variable | Default or behavior |
| --- | --- |
| `COMMONSPACE_CLAUDE_CODE_PATH` | Claude Code executable for discovery and the ACP bridge; defaults to `claude`. |
| `COMMONSPACE_CLAUDE_CODE_ACP_PATH` | Overrides the Claude ACP bridge executable; the bundled bridge is used by default. |

#### Hermes

| Variable | Default or behavior |
| --- | --- |
| `COMMONSPACE_HERMES_PATH` | Hermes discovery executable and default Hermes ACP executable; defaults to `hermes`. |
| `COMMONSPACE_HERMES_ACP_PATH` | Overrides the Hermes ACP executable; otherwise uses `COMMONSPACE_HERMES_PATH`. |

#### Gemini CLI

| Variable | Default or behavior |
| --- | --- |
| `COMMONSPACE_GEMINI_PATH` | Gemini CLI executable; defaults to `gemini`. |
| `COMMONSPACE_GEMINI_ACP_PATH` | Overrides the executable used with `--acp`; defaults to the Gemini CLI executable. Its ACP-reported version must also pass the supported-version check. |

The compatibility baseline accepts stable `>=0.39.1` and `<0.44.0` and tests `0.43.0`; [longer-history replay remains blocked](../adapters/agent-adapters.md#gemini-revalidation-evidence).

#### OpenCode

| Variable | Default or behavior |
| --- | --- |
| `COMMONSPACE_OPENCODE_PATH` | OpenCode executable; defaults to `opencode`. |
| `COMMONSPACE_OPENCODE_ACP_PATH` | Overrides the executable used with `acp`; defaults to the OpenCode executable. |

The native fixture verifies OpenCode `1.18.30`.

### Full access

Use `COMMONSPACE_AGENT_YOLO` to override the Agent's Full access preference at server startup:

| Value | Behavior |
| --- | --- |
| `1` | Enable Full access for all harnesses, including Hermes. |
| `codex`, `claude-code`, `hermes`, `gemini`, or `opencode` | Enable Full access only for agents using that harness. Choose one exact name. |
| Unset, empty, or `0` | Use each Agent's saved Full access preference. |

For example, `COMMONSPACE_AGENT_YOLO=hermes` overrides only Hermes agents. Other agents keep their saved preference. Unknown values stop startup with a configuration error. Replace the removed `COMMONSPACE_HERMES_YOLO=1` setting with `COMMONSPACE_AGENT_YOLO=hermes`.

Unsafe modes change harness permission behavior. They do not authenticate a harness or repair routing configuration.

The server override takes precedence over the Agent preference. Agent settings show the effective policy and disable the Full access control while the override applies. Saving settings does not verify credentials or native model access.

Turning effective Full access on or off:

- stops active work and interrupts already queued work for that agent;
- interrupts its pending permissions;
- closes cached ACP processes while keeping native session references.

The conversation records interrupted work. New requests use the updated setting.

## Workspace inference

To complete setup, add at least one Agent from an installed ACP harness, then select an added Agent for workspace inference. To change that selection later, open **Workspace settings → Intelligence**.

The selected Agent handles routing and shared-context compaction through its harness's existing sign-in. Commonspace stores no separate inference endpoint, model, or credential. DMs and Channel messages addressed to one Agent bypass routing; that does not remove the initial setup requirement.

The **Saved inference agent** label identifies the persisted choice. Saving validates that the Agent belongs to the workspace; it does not test native authentication or model access. Send a message to verify access for an actual request.

Workspace coordination defaults have their own save operation and can be changed even when inference is unconfigured. They control routing fan-out and shared-context memory only. Models and reasoning remain under each runtime and native session's control; Commonspace reflects reported metadata without converting it into a run setting.

### Saved settings and recovery

`routing.json` version 3 stores only the selected harness Agent ID. Malformed and unsupported versions are deleted at startup; older routing configurations are not migrated. Setup then requires a current selection. This does not delete the conversation record.

Routing saves are serialized and use an atomic private file write through `PUT /api/routing`. Workspace coordination defaults save independently through the `set-defaults` mutation.

## Local routing classifier

The npm launcher runs a pretrained [Laya weight-only INT8 ONNX](https://huggingface.co/inferenceprince/laya-onnx-int8) classifier in a Node side process. Python and Docker are not required.

### First launch and cache

- First launch downloads about 613 MB of checksum-verified model files into `COMMONSPACE_HOME/classifier` (normally `~/.commonspace/classifier`).
- The app starts while the model downloads and uses the inference Agent until the classifier is ready. Later launches reuse the cache.
- Intel Macs skip the model download and use the inference Agent because the pinned native runtime has no Intel Mac binding.

### Routing and fallback

Local routing handles complete standalone greetings such as `hi agentops` and `say hello all` with a compact Laya decision over the current roster. A unique display name or name word identifies the possible recipient, allowing spacing differences such as `hi agent ops`. Collective words (`all`, `everyone`, `everybody`, and `all agents`) allow omitted or repeated duplicate letters, such as `hello al`, when they do not collide with an Agent name and fit the workspace fan-out limit. Current direct addressing takes precedence over historical routing examples; this decision needs no conversation brief or responsibility descriptions. It grants no inferred Project access and preserves explicit Project scope. Added work, ambiguous names, exclusions, and peer-discussion requests continue through the full router.

Other local decisions use the newest message and the previous compact Channel or Thread brief. Local routing retains a sole eligible recipient or confirms independent delivery for explicitly selected participants. It does not choose a single winner from several candidates for general work: that score cannot establish the complete recipient set. The inference Agent selects all requested and needed recipients, including arbitrary subsets and peers with overlapping responsibilities. Dependent work and peer discussions also use the inference Agent to choose relay execution order. For a single named Project, a local decision distinguishes file work from a mere mention. Explicit Project scope remains fixed.

Outside standalone direct greetings, the inference Agent handles saved corrections, unclear or multiple work recipients, unclear Project scope, context-dependent requests with stale or oversized briefs, and non-Latin text. The local model accepts up to 512 tokens, including a 192-token instruction-and-option budget.

The worker handles one request at a time with a 750 ms deadline. Busy or unavailable workers fall back immediately. A worker that times out or returns an invalid result stays disabled until the next launch.

### Disable or reset the classifier

Use `commonspace --no-classifier` to disable it. Stopping Commonspace cancels downloads and closes the worker. To download the model again, stop Commonspace and delete its disposable `classifier` cache.

## Installed macOS service

The managed service requires Corepack, Git, the pinned pnpm version, and SSH repository access. It installs committed `main`, not uncommitted checkout edits. Stop any foreground Commonspace process so port `3100` is free, then run from a source checkout:

```bash
pnpm service:install
```

The installer clones source over SSH, installs dependencies, builds a staged release, and validates the LaunchAgent property list. It then atomically activates the release and starts the service. Installation succeeds only when `/api/health` passes and the LaunchAgent process owns the loopback listener; a foreground process cannot make a failed installation appear healthy.

State remains in `~/.commonspace`. One previous build is retained for recovery. Agent authentication is needed when running an agent, not when installing or opening the application.

### Manage the service

Run the command for the action you need:

| Command | Purpose |
| --- | --- |
| `~/.local/bin/commonspace status` | Inspect the service status. |
| `~/.local/bin/commonspace stop` | Stop the service and active work. |
| `~/.local/bin/commonspace start` | Start the installed release. |
| `~/.local/bin/commonspace restart` | Stop and restart the installed release. |
| `~/.local/bin/commonspace update` | Build and activate committed `main`. |
| `~/.local/bin/commonspace rollback` | Swap the current and previous application releases. Read [Backup and rollback](#backup-and-rollback) first. |

### Managed files

| Managed path | Contents |
| --- | --- |
| `~/Library/Application Support/Commonspace/current` | Active application release |
| `~/Library/Application Support/Commonspace/previous` | Rollback application release |
| `~/Library/LaunchAgents/dev.commonspace.service.plist` | LaunchAgent configuration |
| `~/.local/bin/commonspace` | Lifecycle command |
| `~/Library/Logs/Commonspace/service.log` | Standard service log |
| `~/Library/Logs/Commonspace/service.error.log` | Error log |

### Updates and rollback

An update clones `git@github.com:commonspaceai/commonspace.git` over SSH and builds committed `main` while the old process continues running. A staging failure leaves the current release in place. A failed activation health check restores and restarts the previous release.

`rollback` swaps the current and previous application releases. It does not reverse state migrations; read [Backup and rollback](#backup-and-rollback) before downgrading.

The npm package runs in the foreground on Linux. A managed Linux background service is not included.

## Local data

| Path | Contents |
| --- | --- |
| `~/.commonspace/state.json` | Current workspace state |
| `~/.commonspace/state.backup.json` | Previous valid state |
| `~/.commonspace/state.corrupt.json` | Last invalid primary retained during automatic recovery |
| `~/.commonspace/routing.json` | Selected workspace inference Agent ID |
| `~/.commonspace/classifier` | Disposable pinned ONNX classifier model cache |
| `~/.commonspace/workspace` | Managed directory for projectless work |
| `~/.commonspace/attachments` | Private image and general-file bytes |
| Harness-owned locations | Native credentials and transcripts |

`COMMONSPACE_HOME` changes the Commonspace data root. Startup enforces `0700` on this directory, and state writes use `0600` files and atomic replacement.

Agent Client Protocol (ACP) runs over local child-process input/output. Commonspace's Model Context Protocol (MCP) endpoint is authenticated and loopback-only. Its bearer capabilities exist only in memory and are never persisted.

## Export, import, and retention

Use export/import to transfer conversations into a clean workspace. Use a [full local backup](#backup-and-rollback) before a version downgrade; portable exports do not transfer native sessions.

### Export

Open **Workspace data** in Commonspace settings to export `commonspace-export.json`.

- The archive excludes credentials, native-session references, temporary capabilities, and known absolute paths from Commonspace-managed fields.
- It keeps conversation text and exact attachment bytes, which may contain sensitive author-supplied content. Treat the unencrypted archive as private data.

Export and import enforce the limits in the [workspace archive format](../specs/workspace-archive-format.md) before downloading or writing data.

### Import

1. Start with a new, empty workspace.
2. Choose the archive.
3. Map every exported Project root to an existing local directory.
4. Import and check the restored conversations and attachments.

Commonspace validates the entire archive before activating it. Native harness sessions are not transferred; the next agent turn starts new native continuity.

### Retention and attachment cleanup

Retention removes data from one Channel or Direct Message. Commonspace never expires conversation data in the background.

1. Finish or stop active work in that conversation.
2. Preview the affected messages, Threads, attachments, pins, and permissions.
3. Confirm the removal. If state changed after the preview, preview again first.

Message deletion and retention save private attachment cleanup IDs atomically with the conversation change. If physical cleanup fails, the conversation change remains committed and the error reports that cleanup is pending. Retry the deletion or retention, or restart Commonspace after restoring storage access; startup retries saved cleanup without blocking access to retained conversations. Pending IDs stay out of browser state and portable exports.

## Health checks

For a running instance:

```bash
curl http://127.0.0.1:3100/api/health
```

A healthy response is `{"status":"ok"}`. Adjust the port if configured differently. This checks server availability; it does not establish that an agent is authenticated or that a browser interaction works.

See [Development](development.md) for application checks and [Releasing](releasing.md) for package, service, and harness checks. ACP checks are opt-in and use locally authenticated harnesses and model access.

## OS notifications

Notifications are off by default. Enable them in settings and choose categories for replies/input requests, mentions, permissions, failures/timeouts, and sound. Saving these preferences does not depend on inference configuration or change durable Inbox items.

The service delivers only new Inbox events after its current baseline. Restart and archive import do not replay old alerts. Muting a session suppresses its native alert while preserving the Inbox record. Clicking an alert opens its exact validated conversation, Thread, and message on the loopback application origin.

Use **Send test notification** to check macOS delivery. When native delivery fails, Commonspace reports the failure and operating-system guidance while preserving the event in Inbox. The Agent result is unchanged.

## Common failures

### UI development cannot reach the API

Run `pnpm dev` from the repository root. Confirm that the API is on port `3100` and open the Vite UI on port `5173`. If using a custom API port, check the development proxy configuration as well.

### No supported agent appears

Run the affected runtime's version command in the same environment as Commonspace. Check the [supported runtimes](../start/support.md#agent-runtimes), then open **Add Agent** and request a scan. Discovery lists installed supported harnesses; selecting one adds it to the roster. Previously selected identities remain visible during temporary availability failures so their conversation history is preserved.

### Project path rejected

Use an absolute path to an existing directory. Commonspace resolves it through `realpath` before accepting it. Canonical roots stay server-private; browser responses show **Working folder** and **Reference folder N** labels, and file requests use root indexes plus relative paths.

### Agent authentication fails

Authenticate through the affected native runtime installation and retry. Commonspace uses the harness's supported credential store. Unsafe mode does not solve authentication.

### Routing inference fails

The Channel message is persisted before inference. If routing fails, the accepted message remains visible with a failed state and a durable Inbox item; Commonspace does not broadcast it to every agent.

1. Choose a working added Agent under **Workspace settings → Intelligence** and confirm that its native runtime is signed in.
2. Open the affected conversation or Thread from Inbox and expand the failed routing receipt.
3. Choose **Retry agent routing**, or select a Channel Agent and choose **Route**.

Invalid output, an unavailable harness, or an incompatible relay order leaves the request retryable. Recovery reuses the persisted message instead of adding a duplicate.

### A Project file is marked sensitive

Commonspace lists known credential-bearing files but does not preview their contents. This includes `.env*`, common credential/authentication/secret files, private keys, and certificate key containers. Inspect them outside Commonspace using a workflow appropriate for secrets.

### ACP bridge fails to start

Run the affected runtime's version or ACP check in the same environment as Commonspace. Check the executable overrides in [Runtime configuration](#runtime-configuration). A successful version check establishes that the executable is reachable; an ACP session check establishes that the integration can start.

### A native session cannot resume

Commonspace starts a replacement native session only when the provider explicitly reports the saved session missing. Authentication, transport, and other temporary failures preserve the saved session reference. Use `/new` when you deliberately want a hard context boundary.

### An agent misses Channel context

Check that the run uses ACP and that local `/api/mcp` requests are not returning `401`. Channel agents receive scoped Commonspace tools. `commonspace_handoff` exposes current peer IDs in its schema and queues one clean peer request; `commonspace_get_context` reads deeper shared room context on demand instead of repeating it inside every user message.

### A reply has no activity trace

Commonspace records only activity emitted by the native ACP runtime. A reply may legitimately have no activity row if the runtime reports only final text. Check the harness's ACP support before treating absent reasoning, plan, tool, or usage updates as a Commonspace rendering failure.

## Shutdown

Ctrl+C, `SIGINT`, and `SIGTERM` stop new sends, cancel and close ACP process groups, wait for background work and atomic writes, revoke MCP capabilities, and close HTTP connections.

During `pnpm dev`, watched backend edits use a different path: the existing server waits for accepted turns to finish and then replaces itself once. A crash or explicit terminal shutdown does not use that idle wait.

Closing the browser leaves an installed LaunchAgent and its turns running. `commonspace stop`, logout, or machine shutdown terminates the service. On the next start, interrupted work has an explicit interruption state.

## Backup and rollback

### Make a full local backup

Back up the whole Commonspace data directory before testing a version downgrade or changing state compatibility. Stop a foreground instance with Ctrl+C. For the installed macOS service, use:

```bash
~/.local/bin/commonspace stop
```

Then copy the data directory to a new backup location:

```bash
cp -R ~/.commonspace ~/commonspace-backup-YYYYMMDD
```

Replace `YYYYMMDD` with your backup date, and adjust the source if using `COMMONSPACE_HOME`. Choose a destination that does not already exist. The copy includes routing configuration and attachments; keep it private. Native harness stores remain separate and are not included.

### Automatic state recovery

On startup, the host migrates persisted workspaces into the format supported by the running release. Migration preserves conversations, native-session mappings, and routing history. Older corrections inherit their target assignment's Project scope, and workspaces without schedule data load with no scheduled messages.

Each write retains the previous valid primary as `state.backup.json`. On startup:

| State files | Result |
| --- | --- |
| Primary is valid | Load the primary. |
| Primary is invalid; backup is valid | Preserve the primary as `state.corrupt.json` and recover the backup. |
| Both are invalid | Stop without replacing either file. |

### Downgrade an application release

The automatic state backup protects against an invalid write; it is not a complete archive of earlier releases. Application rollback does not reverse migrations. Before starting an older build, restore a data backup compatible with that build, and keep a separate copy of the current data so the recovery attempt remains reversible.
