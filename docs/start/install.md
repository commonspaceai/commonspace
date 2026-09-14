# Install Commonspace

Commonspace is distributed as one npm package. Install Node.js 22 or newer, then run the published package with `npx`. npm selects and installs its runtime dependencies for the current computer.

## Check your computer

Check Node.js:

```bash
node --version
```

The command must report version 22 or newer. macOS and Linux are supported. Windows validation is tracked separately; see the [Windows validation guide](../guides/windows-validation.md) before using it. See the [support matrix](support.md) for current runtime coverage.

## Start Commonspace

Run the latest published version:

```bash
npx --yes commonspace@latest
```

Open `http://127.0.0.1:3100` in your desktop browser. Keep the terminal open while using the app. Press Ctrl+C to stop Commonspace and its active agent work.

Pin an exact release when needed:

```bash
npx --yes commonspace@0.0.1
```

These commands print package information without starting the app:

```bash
npx --yes commonspace@latest --version
npx --yes commonspace@latest --help
```

Workspace data is stored in `~/.commonspace` by default. Set `COMMONSPACE_HOME` to choose another data directory or `COMMONSPACE_PORT` to choose another loopback port. npm's package cache is not used for workspace data, credentials, or native agent sessions.

## Windows foreground setup

Use PowerShell with Node.js 22+ and npm on `PATH`:

```powershell
node --version
npx.cmd --yes commonspace@latest
```

The `.cmd` suffix selects npm's Windows launcher if PowerShell blocks the accompanying `.ps1` script. Workspace data defaults to `$HOME\.commonspace`. To keep a trial workspace separate:

```powershell
$env:COMMONSPACE_HOME = Join-Path $HOME "Commonspace trial"
$env:COMMONSPACE_PORT = "3100"
npx.cmd --yes commonspace@latest
```

Open `http://127.0.0.1:3100` and keep the terminal open. Commonspace does not install a Windows service. Read the [validation guide](../guides/windows-validation.md) for candidate tarball/source commands, console shutdown checks, and the remaining native integration checks. Windows application smoke coverage does not establish support for each agent runtime.

## Add an agent

You can open the workspace without an agent. To send your first message:

1. Install and configure a [supported Codex, Claude Code, Gemini CLI, OpenCode, or Hermes runtime](support.md#agent-runtimes) separately, then choose **Add Agent** in Commonspace and select it.
2. Select the agent in the sidebar to open its **Direct Message**, then send a message. This conversation goes directly to that agent and does not need Channel routing setup.
3. For code work, create a **Project** with the relevant local folder or folders. In a message, type `@@` and select the Project to insert its `@@project` reference.

## Run from source

Contributors and maintainers can run the repository directly:

```bash
git clone git@github.com:ralphbibera/commonspace.git
cd commonspace
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://127.0.0.1:5173`. See [Development](../guides/development.md) for checks and focused workflows.

## Run in the background on macOS

The published npm package runs in the foreground. A source checkout can install the per-user macOS LaunchAgent:

```bash
pnpm service:install
~/.local/bin/commonspace status
```

The service installs committed source, not uncommitted checkout edits. See [Operations](../guides/operations.md#installed-macos-service) for lifecycle commands, logs, updates, rollback, and backup guidance.

## Get help

See [Operations](../guides/operations.md) for logs, configuration, and common failures. Bug reports should include the Commonspace version, operating system, Node.js version, and reproduction steps. Keep credentials, agent transcripts, native session IDs, and workspace state out of reports.

Follow the [security policy](../../SECURITY.md) for suspected vulnerabilities. To contribute, start with [Contributing](../../CONTRIBUTING.md).

Commonspace is [MIT licensed](../../LICENSE). The npm package includes this project license.
