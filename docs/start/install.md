# Install Commonspace

Use the published npm package to run Commonspace in your browser. The usual path is: check Node.js, start Commonspace, and connect one signed-in agent. Source development and background service instructions are later on this page.

## Check your computer

Check Node.js:

```bash
node --version
```

The command must report version 22 or newer. macOS and Linux are supported. Windows users should use [Windows foreground setup](#windows-foreground-setup) and read its validation limits. See the [support matrix](support.md) for current platform and runtime coverage.

## Start Commonspace

Run the latest published version. npm installs the package and its runtime dependencies for your computer:

```bash
npx --yes commonspace@latest
```

Open `http://127.0.0.1:3100` in your desktop browser. Keep the terminal open while using the app. Press Ctrl+C to stop Commonspace and its active agent work.

On supported computers, the first launch downloads about 613 MB for the local classifier in the background. Intel Macs use the inference Agent without downloading the classifier. Add `--no-classifier` to skip it elsewhere; see [classifier operation](../guides/operations.md#local-routing-classifier) for cache and fallback behavior.

Workspace data is stored in `~/.commonspace` by default. Set `COMMONSPACE_HOME` to choose another data directory or `COMMONSPACE_PORT` to choose another loopback port. npm's package cache is not used for workspace data, credentials, or native agent sessions.

## Get your first answer

1. [Install and sign in to one agent runtime](runtimes.md), then choose **Add Agent** and select it.
2. Select that agent as the **workspace inference agent** and choose **Use selected agent** to finish setup. It routes Channel messages and summarizes shared context using the same runtime sign-in.
3. Add a **Project** pointing to a local repository folder.
4. Open the agent’s DM. Type `@@`, select your Project, and send:

   > Explain this repository’s entry points and how to run it. Don’t change any files.

Your first reply confirms the agent can access its account and model. Follow up with “Which file should I read first?” to continue the same native session. Workspace setup requires an inference selection, but DM messages always go directly to their chosen agent.

[Follow the full walkthrough](first-conversation.md), including a Channel with two agents.

## Reopen and update

Run the same command whenever you want to reopen Commonspace:

```bash
npx --yes commonspace@latest
```

Your saved conversations and Projects remain in `~/.commonspace`. To update, let active work finish, stop the old process with Ctrl+C, then run that command again. Check the startup version or run `npx --yes commonspace@latest --version`. See [GitHub releases](https://github.com/commonspaceai/commonspace/releases) for changes. Back up your Commonspace data directory before upgrading; native session backups belong to each runtime.

Closing the browser leaves the server running. Closing its terminal or pressing Ctrl+C stops it and active work. Use the same data directory when restarting, and run only one server against that directory.

To use an exact release instead of the latest, include its version:

```bash
npx --yes commonspace@0.0.6
```

These commands print package information without starting the app:

```bash
npx --yes commonspace@latest --version
npx --yes commonspace@latest --help
```

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

Open `http://127.0.0.1:3100`, keep the terminal open, and continue with [your first answer](#get-your-first-answer).

Commonspace does not install a Windows service. Read the [validation guide](../guides/windows-validation.md) for candidate tarball/source commands, console shutdown checks, and the remaining native integration checks. Windows application smoke coverage does not establish support for each agent runtime.

## Run from source

Contributors and maintainers can run the repository directly with Node.js 22.13+ or 24+:

```bash
git clone https://github.com/commonspaceai/commonspace.git
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

Start with the [FAQ and troubleshooting](help.md), [runtime setup](runtimes.md), or [file a bug](https://github.com/commonspaceai/commonspace/issues/new?template=bug_report.yml). Include the Commonspace version, OS, Node version, and reproduction steps. Keep credentials, transcripts, session IDs, and workspace data out of reports.

Use the [security policy](../../SECURITY.md) for vulnerabilities and [Contributing](../../CONTRIBUTING.md) for development. Commonspace is [MIT licensed](../../LICENSE).
