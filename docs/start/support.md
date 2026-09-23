# Support matrix

Use this page to choose a published package or development environment. Commonspace runs in a desktop browser. The tables distinguish automated checks from integrations that need a separate local test.

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

| Requirement or tool | Current coverage                                                                                                                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Node.js             | Node 22 is the CI baseline. Source requires Node 22.13+ within 22.x, or 24+; see [package.json](../../package.json) and [Development setup](../guides/development.md#setup).                                                                                             |
| pnpm                | Use version 10.34.5 and `pnpm install --frozen-lockfile`.                                                                                                                                                                                                                |
| macOS and Linux     | Supported source-development environments. Linux runs the main CI checks; macOS also has service checks.                                                                                                                                                                 |
| Windows x64         | CI targets Node 22 on `windows-2025`: types/builds, the focused platform suite, Storybook smoke, E2E, live browser verification, and npm packaging. See [actual evidence and manual checks](../guides/windows-validation.md); this is not the full native-runtime suite. |
| Git and Corepack    | Git is needed for source workflows. Corepack can provide pnpm and is required by the macOS service installer. Published-package users need npm or `npx`.                                                                                                                 |
| Vite                | Serves the development UI at `127.0.0.1:5173` and forwards API requests to the local server.                                                                                                                                                                             |
| Express             | Serves the local API at `127.0.0.1:3100`.                                                                                                                                                                                                                                |

Start with [Contributing](../../CONTRIBUTING.md) for a fresh checkout and [Development](../guides/development.md) for day-to-day commands.

## Agent runtimes

| Runtime     | Connection and current compatibility                                                                                                                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex       | Installed CLI through bundled `@agentclientprotocol/codex-acp`.                                                                                                                                                                                                                 |
| Claude Code | Installed CLI through bundled `@agentclientprotocol/claude-agent-acp`.                                                                                                                                                                                                          |
| Gemini CLI  | Native `gemini --acp`. New and already-loaded sessions work; reload after restart is blocked to preserve saved work. Continue in Gemini CLI or use `/new` for fresh context. See [version limits and revalidation](../adapters/agent-adapters.md#gemini-revalidation-evidence). |
| OpenCode    | Native `opencode acp`.                                                                                                                                                                                                                                                          |
| Hermes      | Installed `hermes acp`, using existing native profiles. Verify with `hermes acp --check`; Commonspace discovers profiles with `hermes profile list`.                                                                                                                            |

Codex, Hermes, Claude Code, Gemini CLI, and OpenCode are built-in harnesses. Pi coding agent remains blocked: its bridge does not wire session-scoped MCP into Pi. See the [adapter guide](../adapters/agent-adapters.md#pi-integration-status) for Pi's requirements and [Gemini revalidation evidence](../adapters/agent-adapters.md#gemini-revalidation-evidence). Use the [runtime setup guide](runtimes.md) to install and sign in. The adapter guide owns tested versions and integration requirements.

## What the checks cover

| Check                                      | Credentials needed                            | Coverage                                                                                                                                                                     |
| ------------------------------------------ | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit and integration tests                 | No.                                           | Commonspace's state, API, and other application behavior.                                                                                                                    |
| Storybook browser tests                    | No.                                           | Isolated component and screen behavior.                                                                                                                                      |
| Playwright E2E                             | No.                                           | Integrated production UI/API journeys, including navigation, messages, settings, notifications, and restart-visible state.                                                   |
| Reviewed visual baselines                  | No.                                           | Selected Storybook states compared on macOS; changed baselines fail until inspected and explicitly approved.                                                                 |
| `pnpm verify:live`                         | No.                                           | The built UI and server working together in a desktop browser. Uses managed Chromium by default, with an optional system Chrome override.                                    |
| `pnpm verify:npm-package`                  | No.                                           | Clean npm command execution, API/UI assets, shutdown, and saved-state restart outside the checkout, using paths with spaces and an isolated home. Windows shutdown uses IPC. |
| `pnpm test:platform`                       | No.                                           | Portable tool launchers, package staging, source watcher restart, directory resolution, standalone API/UI, and saved-state contracts.                                        |
| `pnpm verify:service`                      | No agent credentials.                         | The macOS source-based service lifecycle in a temporary home, with launchctl and health responses substituted.                                                               |
| `pnpm verify:adapters`                     | No.                                           | Real Claude Code and OpenCode restart/resume; Gemini reload rejection with preserved work; fresh context, scoped MCP and progress through local model API fixtures.          |
| Real Hermes, Codex, and Claude Code checks | Yes.                                          | Agent session start, exact session resumption, and permitted context/progress tools.                                                                                         |
| Real macOS service check                   | A local macOS user session.                   | Installation, startup, update, and rollback with the actual LaunchAgent.                                                                                                     |

Normal contribution checks do not need provider credentials or agent session stores. Keep those outside the repository. See [Releasing](../guides/releasing.md) for the required integration checks.
