# Windows validation

This guide owns Windows installation and source-validation evidence. Commonspace's Windows path is a foreground Node.js service with a desktop browser. There is no Windows service installer or desktop wrapper.

## Evidence boundary

The Windows CI job targets **Windows Server 2025 x64, Node.js 22, and pnpm 10.34.5**, with PowerShell and managed Chromium. A passing run establishes only the checks listed below for that exact commit. It does not establish Windows ARM64, all Windows desktop versions, every agent runtime, native dialogs/notifications, or console Ctrl+C.

Run these checks in native Windows PowerShell. WSL executes the Linux path and does not establish native Windows coverage.

Baseline verified on **2026-09-14** at commit `26dafa4d31bb2f5fa750082ae9e24dd4bacb4980`: [CI run 34850693783](https://github.com/commonspaceai/commonspace/actions/runs/34850693783) passed on Windows Server 2025 x64 with Node.js **22.23.2**. It passed 25 platform tests, 5 Storybook smoke tests, 17 E2E flows, live browser verification, and both npm tarball smokes. Both package runs reported saved-state restart and IPC shutdown completion. The implementation and full local gate were also checked on macOS. The run built candidate tarballs from that checkout; record registry or release artifact identity separately when checking a published release. Record a fresh run for each release candidate.

Interactive Windows desktop acceptance and authenticated Windows agent checks are **Not run — no interactive Windows desktop or configured Windows agent accounts were available for this validation**. Use the manual checks below to close those gaps.

| Automated check | Evidence |
| --- | --- |
| Frozen dependency install, types and production build | The source dependency graph and generated application build on the runner. |
| `pnpm test:platform` | Tool arguments survive spaces and shell punctuation; Windows npm resolution and environment isolation; package staging; watched-source restart; Git directory resolution; standalone API/UI and state contracts. |
| `pnpm test:storybook:smoke` | Representative component/screen interactions in Chromium. |
| `pnpm test:e2e:built` and `pnpm verify:live:built` | Production browser/API flows with synthetic runtimes, including separate development-style serving and single-origin serving. |
| `pnpm package:npm` and `pnpm verify:npm-package` | Locally built tarball installs outside the checkout; npm launches `--help`/`--version`; API and UI assets work; accepted state survives a restart. Homes and installation paths contain spaces. |
| Linux-built tarball on Windows | CI also installs its Linux build on Windows; the release `windows-package` job checks the exact artifact before publication. |

The full `pnpm test` suite includes native runtime fixtures and platform-specific executable/symlink fixtures; it is not replaced by the focused Windows suite. Full unit coverage runs on Linux. Runtime and credential-backed compatibility stays subject to the [adapter guide](../adapters/agent-adapters.md) and per-runtime acceptance.

## Reproduce source checks

Install Git and Node.js 22 with npm. In PowerShell, select a clean candidate checkout; include a space in the checkout path when validating path handling. Use the exact commit being assessed:

```powershell
git clone https://github.com/commonspaceai/commonspace.git "Commonspace validation"
Set-Location "Commonspace validation"
git checkout <candidate-commit>
node --version
npm.cmd install --global pnpm@10.34.5
pnpm.cmd --version
pnpm.cmd install --frozen-lockfile
pnpm.cmd typecheck
pnpm.cmd test:platform
pnpm.cmd exec playwright install chromium
pnpm.cmd test:storybook:smoke
pnpm.cmd build
pnpm.cmd test:e2e:built
pnpm.cmd verify:live:built
pnpm.cmd package:npm
pnpm.cmd verify:npm-package
git diff --check
```

Replace `<candidate-commit>` before running that line. Run each command separately and stop on a nonzero exit code (`$LASTEXITCODE`). The `.cmd` suffix avoids PowerShell's script execution-policy handling of npm/pnpm's `.ps1` shims; no execution-policy change is required. Existing Corepack users may use the repository-pinned pnpm instead of installing it globally.

`verify:npm-package` defaults to the archive matching `cli/package.json`. To verify a downloaded release artifact, keep a checkout of the same release commit and pass its absolute tarball path:

```powershell
node scripts/verify-npm-package.mjs "C:\Downloads\commonspace-<version>.tgz"
```

This verifier needs Node/npm but no source dependencies or model credentials. It installs with `--ignore-scripts`, matching the release smoke, and uses an isolated runtime home without inheriting provider credentials. Its JSON result reports OS, architecture, Node version, package path, and shutdown method. Keep the output alongside the candidate's exact commit and Actions URL.

## Check a real Windows desktop

Use a fresh temporary workspace and a synthetic Project. Do not point tests at an existing agent transcript or production workspace. Start source development with:

```powershell
$env:COMMONSPACE_HOME = Join-Path $env:TEMP "Commonspace Windows trial"
pnpm.cmd dev
```

Open `http://127.0.0.1:5173`. For the installed package, use the same isolated home with the [foreground npm command](../start/install.md#windows-foreground-setup) and open port 3100. Record each result independently:

1. Create a Channel and a Project whose folder includes spaces and non-ASCII characters. Refresh/restart and confirm their state restores. Check nested Git folder resolution, attachments, and export/import with explicit Project remapping.
2. In source mode, edit a server source file while a synthetic turn is active. Verify the accepted turn finishes before the supervisor restarts, then verify browser reconnection. The focused suite covers the watcher protocol; this step checks the assembled `pnpm dev` process tree.
3. Press Ctrl+C in the original source/package terminal. Confirm the listener is gone and the terminal returns. Restart using the same home and confirm accepted data remains. Repeat with active agent work only when that runtime is available, checking for orphaned processes.
4. Use the folder picker to select a directory and cancel it. Exercise **Send test notification** with Windows desktop notifications enabled. Headless CI does not verify either native desktop interaction.
5. For every claimed supported Windows runtime, record its executable/install method, version, authentication availability, discovery, first reply, exact native-session resume after restart, `/new`, cancellation, and advertised permission/MCP behavior. Use the focused commands in the adapter guide only when the runtime and model access are available. Application smoke supplies no runtime support evidence.

Windows process-directed `SIGINT`/`SIGTERM` forcibly terminate a Node child; terminal Ctrl+C has different behavior. The package smoke therefore disconnects its private parent/child IPC channel to exercise Commonspace's existing graceful close handler. It does not add an HTTP shutdown endpoint. See [Node's signal documentation](https://nodejs.org/docs/latest-v22.x/api/process.html#signal-events).

## Record failures and remaining work

Use the [candidate acceptance template](../releases/release-acceptance-template.md). Record the exact commit/version, Windows edition/build and architecture, Node/npm/pnpm/browser versions, command, exit code, observed result, and a sanitized log or CI link. CI uploads browser failure artifacts for seven days. A rerun of a different commit does not validate the candidate.

Use `Not run — <reason>` for unavailable Windows hardware/runner, interactive desktop session, installed runtime, provider credentials/model access, or npm ownership/publishing credentials. Publication is separate from validating a local tarball. Keep unverified rows open; do not label unavailable evidence as passing or silently defer it. A missing Windows service installer is current product scope, not a foreground-validation failure.
