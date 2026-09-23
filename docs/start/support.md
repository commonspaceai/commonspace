# Support matrix

Check your operating system under [Published package](#published-package), then choose an [agent runtime](#agent-runtimes). Contributors can use [Development environments](#development-environments) and [What the checks cover](#what-the-checks-cover) to understand the available validation. Commonspace runs in a desktop browser.

## Published package

The `commonspace` npm package requires Node.js 22 or newer. npm installs external runtime dependencies for the current computer; Commonspace does not publish separate operating-system archives.

| Computer                   | Published-package coverage                                                                                                | Background operation                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Apple Silicon or Intel Mac | Supported npm installation                                                                                                | Foreground package; source checkout can install a per-user service |
| Linux                      | Supported npm installation                                                                                                | Foreground package                                                 |
| Windows x64                | Candidate tarball verified on Windows Server 2025 x64; see [Windows evidence and limits](../guides/windows-validation.md) | Foreground only; no Windows service installer                      |

The release workflow installs one npm tarball in a clean Linux prefix, then validates that exact tarball on Windows before publication. It exercises the npm command, API, UI assets, saved-state restart, and graceful shutdown. Windows uses private IPC disconnect for automated shutdown; terminal Ctrl+C needs separate acceptance. macOS service behavior remains a separate source-based check. See workflow results and release notes for evidence about a particular version.

The optional local routing classifier uses the pinned ONNX native runtime on Apple Silicon, Linux, and Windows. That runtime has no Intel Mac binding; Intel Macs continue to use the configured inference Agent for routing.

Commonspace does not currently ship a desktop app wrapper. Follow [Installation](install.md) to run it in your browser.

## Development environments

| Requirement or tool | Current coverage |
| --- | --- |
| Node.js | Source requires Node 22.13+ within 22.x, or 24+. Node 22 is the CI baseline; see [package.json](../../package.json). |
| pnpm | Use version 10.34.5 and `pnpm install --frozen-lockfile`. |
| Git and Corepack | Source workflows need Git. Corepack can provide pnpm and is required by the macOS service installer. Published-package users need npm or `npx`. |
| macOS and Linux | Supported source-development environments. Linux runs the main CI checks; macOS also has service checks. |
| Windows x64 | CI uses Node 22 on `windows-2025` for types/builds, the focused platform suite, Storybook smoke, E2E, live browser verification, and npm packaging. This is not the full native-runtime suite; see [evidence and manual checks](../guides/windows-validation.md). |

During development, Vite serves the UI at `127.0.0.1:5173` and forwards API requests to the Express server at `127.0.0.1:3100`. Follow [Development setup](../guides/development.md#setup) for commands.

Start with [Contributing](../../CONTRIBUTING.md) for a fresh checkout and [Development](../guides/development.md) for day-to-day commands.

## Agent runtimes

Use the [runtime setup guide](runtimes.md) to install and sign in. All five runtimes below are built-in harnesses; tested versions and integration requirements are maintained in the [adapter guide](../adapters/agent-adapters.md).

| Runtime | Connection and current compatibility |
| --- | --- |
| Codex | Installed CLI through bundled `@agentclientprotocol/codex-acp`. |
| Claude Code | Installed CLI through bundled `@agentclientprotocol/claude-agent-acp`. |
| Hermes | Installed `hermes acp`, using existing native profiles. Verify with `hermes acp --check`; discovery uses `hermes profile list`. |
| Gemini CLI | Native `gemini --acp`. New and already-loaded sessions work. Reload after restart is blocked to preserve saved work; continue in Gemini CLI or use `/new` for fresh context. See [version limits and revalidation](../adapters/agent-adapters.md#gemini-revalidation-evidence). |
| OpenCode | Native `opencode acp`. |

Pi coding agent remains blocked because its bridge does not wire session-scoped MCP into Pi. See [Pi integration status](../adapters/agent-adapters.md#pi-integration-status).

## What the checks cover

The automated checks below do **not** need agent credentials. Passing a fixture or browser check does not establish native runtime support on every operating system.

| Check | Coverage |
| --- | --- |
| Unit and integration tests | State, API, and other application behavior. |
| Storybook browser tests | Isolated component and screen behavior. |
| Playwright E2E | Integrated production UI/API journeys: navigation, messages, settings, notifications, and restart-visible state. |
| Reviewed visual baselines | Selected Storybook states compared on macOS. Changed baselines fail until inspected and explicitly approved. |
| `pnpm verify:live` | Built UI and server working together in a desktop browser. Uses managed Chromium by default, with an optional system Chrome override. |
| `pnpm verify:npm-package` | Clean npm command execution, API/UI assets, shutdown, and saved-state restart outside the checkout, using paths with spaces and an isolated home. Windows shutdown uses IPC. |
| `pnpm test:platform` | Portable tool launchers, package staging, source watcher restart, directory resolution, standalone API/UI, and saved-state contracts. |
| `pnpm verify:service` | macOS service lifecycle in a temporary home, with launchctl and health responses substituted. |
| `pnpm verify:adapters` | Real Claude Code and OpenCode restart/resume; Gemini reload rejection with preserved work; fresh context, scoped MCP, and progress through local model API fixtures. |

These additional checks need a real local environment:

| Check | Prerequisite | Coverage |
| --- | --- | --- |
| Real Hermes, Codex, and Claude Code checks | Agent credentials. | Session start, exact session resumption, and permitted context/progress tools. |
| Real macOS service check | A local macOS user session. | Installation, startup, update, and rollback with the actual LaunchAgent. |

Normal contribution checks do not need provider credentials or agent session stores. Keep those outside the repository. See [Releasing](../guides/releasing.md) for the required integration checks.
