# Operations

Use this guide to configure, inspect, update, back up, and recover a local Commonspace instance. [Installation](../start/install.md) covers the first launch. [Development](development.md) covers the source editing workflow.

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

| Variable | Default or behavior |
| --- | --- |
| `COMMONSPACE_PORT` | API port; defaults to `3100`. Accepts `0` for an operating-system-assigned port. |
| `COMMONSPACE_HOME` | Local state directory; defaults to `~/.commonspace`. Use a separate directory for development or verification. |
| `COMMONSPACE_UI_ROOT` | Built browser asset directory. The source server serves no UI when unset; npm/service launchers set it. |
| `COMMONSPACE_LOG_LEVEL` | Server log level; defaults to `info`. |
| `COMMONSPACE_HERMES_PATH` | Hermes discovery executable and default Hermes ACP executable; defaults to `hermes`. |
| `COMMONSPACE_CODEX_PATH` | Explicit Codex execution override; the ACP bridge uses its bundled compatible CLI by default. Discovery and capability inspection use `codex` unless overridden. |
| `COMMONSPACE_HERMES_ACP_PATH` | Overrides the Hermes ACP executable; otherwise uses `COMMONSPACE_HERMES_PATH`. |
| `COMMONSPACE_CODEX_ACP_PATH` | Overrides the Codex ACP bridge executable; the bundled bridge is used by default. |
| `COMMONSPACE_CLAUDE_CODE_PATH` | Claude Code executable for discovery and the ACP bridge; defaults to `claude`. |
| `COMMONSPACE_CLAUDE_CODE_ACP_PATH` | Overrides the Claude ACP bridge executable; the bundled bridge is used by default. |
| `COMMONSPACE_GEMINI_PATH` | Gemini CLI executable; defaults to `gemini`. Baseline accepts stable `>=0.39.1` and `<0.44.0` and tests `0.43.0`; [longer-history replay remains blocked](../adapters/agent-adapters.md#gemini-revalidation-evidence). |
| `COMMONSPACE_GEMINI_ACP_PATH` | Overrides the executable used with `--acp`; defaults to the Gemini CLI executable. Its ACP-reported version must also pass the supported-version check. |
| `COMMONSPACE_OPENCODE_PATH` | OpenCode executable; defaults to `opencode`. Native fixture verifies `1.18.30`. |
| `COMMONSPACE_OPENCODE_ACP_PATH` | Overrides the executable used with `acp`; defaults to the OpenCode executable. |
| `COMMONSPACE_HERMES_YOLO=1` | Explicitly enables Hermes unsafe mode. |
| `COMMONSPACE_AGENT_YOLO=1` | Explicitly enables Full access for Codex, Claude Code, Gemini CLI, and OpenCode. |

Unsafe modes change harness permission behavior. They do not authenticate a harness or repair routing configuration.

Agent Full access changes replace cached ACP processes while keeping native session references. Either effective access change also stops that agent's active work and cancels its pending permissions; queued work uses the latest setting. An operator-level unsafe environment flag takes precedence over the Agent preference. Agent settings show that effective policy and disable the control while the server override applies. Saving agent settings does not verify credentials or native model access.

A new workspace requires two choices: add at least one Agent from an installed ACP harness, then select one added Agent for workspace inference. The selected Agent performs unaddressed Channel routing and shared-context compaction through its harness's existing sign-in. Commonspace stores no separate inference endpoint, model, or credential.

The **Saved inference agent** label identifies the persisted choice. Saving validates that the Agent belongs to the workspace; it does not test native authentication or model access. A malformed or unsupported `routing.json` is deleted at startup and setup remains incomplete until the user makes a current selection.

Agent run settings have their own save operation and can be changed even when inference is unconfigured. A blank workspace model and **Use native session settings** reasoning leave model and reasoning under native control; resumed sessions retain their current native settings. Discovery labels are metadata, not implicit model overrides. An explicitly selected model, reasoning, or permission mode must be supported by the runtime; unsupported settings fail before sending the prompt. Clearing an override does not reset a native session or restore its earlier values. Existing saved reasoning choices are preserved when upgrading; newly created workspaces default to native reasoning.

Routing configuration version 3 stores only the selected harness Agent ID. No older routing configuration is migrated. Routing saves are serialized and use an atomic private file write through `PUT /api/routing`; Agent run defaults save independently through the `set-defaults` mutation.

## Installed macOS service

The managed service currently installs from committed source. Stop any foreground Commonspace process so port `3100` is free, then run from a source checkout:

```bash
pnpm service:install
```

The installer clones committed source over SSH, installs dependencies, builds a staged release, validates the LaunchAgent property list, atomically activates it, starts the service, and requires `/api/health` to pass. It also checks that the LaunchAgent process owns the loopback listener, so an existing foreground process cannot make a failed installation appear healthy. State remains in `~/.commonspace`. One previous build is retained for recovery. Agent authentication is needed when running an agent, not when installing or opening the application.

After installation:

```bash
~/.local/bin/commonspace status
~/.local/bin/commonspace stop
~/.local/bin/commonspace start
~/.local/bin/commonspace restart
~/.local/bin/commonspace update
~/.local/bin/commonspace rollback
```

| Managed path | Contents |
| --- | --- |
| `~/Library/Application Support/Commonspace/current` | Active application release |
| `~/Library/Application Support/Commonspace/previous` | Rollback application release |
| `~/Library/LaunchAgents/dev.commonspace.service.plist` | LaunchAgent configuration |
| `~/.local/bin/commonspace` | Lifecycle command |
| `~/Library/Logs/Commonspace/service.log` | Standard service log |
| `~/Library/Logs/Commonspace/service.error.log` | Error log |

An update clones and builds the configured source while the old process continues running. A staging failure leaves the current release in place. A failed activation health check restores and restarts the previous release.

`rollback` swaps the current and previous application releases. It does not reverse state migrations; read [Backup and rollback](#backup-and-rollback) before downgrading.

This path requires Corepack, Git, the pinned pnpm version, and SSH repository access. It installs committed `main`, not uncommitted checkout edits. `~/.local/bin/commonspace update` clones `git@github.com:commonspaceai/commonspace.git` over SSH and builds `main` again.

The npm package runs in the foreground on Linux. A managed Linux background service is not included.

## Local data

| Path | Contents |
| --- | --- |
| `~/.commonspace/state.json` | Current workspace state |
| `~/.commonspace/state.backup.json` | Previous valid state |
| `~/.commonspace/state.corrupt.json` | Last invalid primary retained during automatic recovery |
| `~/.commonspace/routing.json` | Selected workspace inference Agent ID |
| `~/.commonspace/workspace` | Managed directory for projectless work |
| `~/.commonspace/attachments` | Private image and general-file bytes |
| Harness-owned locations | Native credentials and transcripts |

`COMMONSPACE_HOME` changes the Commonspace data root. Startup enforces `0700` on this directory, and state writes use `0600` files and atomic replacement.

Agent Client Protocol (ACP) runs over local child-process input/output. Commonspace's Model Context Protocol (MCP) endpoint is authenticated and loopback-only. Its bearer capabilities exist only in memory and are never persisted.

## Export, import, and retention

Open **Workspace data** in Commonspace settings to export `commonspace-export.json`. The archive excludes credentials, native-session references, temporary capabilities, and known absolute paths from Commonspace-managed fields. It keeps conversation text and exact attachment bytes, which may contain sensitive author-supplied content. Treat the unencrypted archive as private data. See [Workspace archive format](../specs/workspace-archive-format.md) for the contract.

Export and import enforce the limits in the [workspace archive format](../specs/workspace-archive-format.md) before downloading or writing data.

To import:

1. Start with a new, empty workspace.
2. Choose the archive.
3. Map every exported Project root to an existing local directory.
4. Import and check the restored conversations and attachments.

Commonspace validates the entire archive before activating it. Native harness sessions are not transferred; the next agent turn starts new native continuity.

Retention removes data from one Channel or Direct Message. Preview the affected messages, Threads, attachments, pins, and permissions before confirming. A state change after preview requires a new preview. Active work must finish or be stopped first. Commonspace never expires conversation data in the background.

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

Choose a working added Agent under **Workspace settings → Intelligence** and confirm that its native runtime is signed in. Invalid output, an unavailable harness, or an incompatible relay order leaves the request retryable. Open the affected conversation or Thread from Inbox, expand the failed routing receipt, then choose **Retry agent routing** or select a Channel Agent and choose **Route**. Recovery reuses the persisted message instead of adding a duplicate.

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

Back up the whole Commonspace data directory before testing a version downgrade or changing state compatibility. Stop the service first, or use Ctrl+C for a foreground instance. Choose a new backup directory so an earlier backup is not overwritten:

```bash
~/.local/bin/commonspace stop
cp -R ~/.commonspace ~/commonspace-backup-YYYYMMDD
```

Replace `YYYYMMDD` with your backup date, and adjust the source if using `COMMONSPACE_HOME`. The copy includes routing configuration and attachments; keep it private. Native harness stores remain separate and are not included.

The current internal state version is 30 and migrates versions 1–29 on startup. Each write retains the previous valid primary as `state.backup.json`. If the primary is invalid and the backup is valid, startup preserves the primary as `state.corrupt.json` and recovers the backup. If both are invalid, startup stops without replacing them.

The automatic state backup protects against an invalid write; it is not a complete archive of earlier releases. Application rollback does not reverse migrations. Before starting an older build, restore a data backup compatible with that build, and keep a separate copy of the current data so the recovery attempt remains reversible.
