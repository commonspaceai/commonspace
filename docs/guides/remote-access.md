# Use Commonspace from another device

Connect a computer or phone browser to one running Mac through Tailscale Serve. The Mac keeps the conversations, project files, Agents, and native sessions. The browser presents that workspace.

These steps use the current source implementation. They do not establish availability in an older published package. Start with [Development setup](development.md#setup) and [runtime sign-in](../start/runtimes.md).

## Prepare the Mac

1. Install Tailscale on the Mac and viewing device, and sign both in as the same person.
2. Enable MagicDNS and HTTPS for the tailnet using [Tailscale Serve setup](https://tailscale.com/docs/features/tailscale-serve.md).
3. Find the Mac's exact HTTPS name and your Tailscale login. Replace the example values below with those values.
4. Keep the Mac powered on and awake while work runs. A client can disconnect or shut down while the host stays available.

Use an untagged viewing device. Serve does not provide user identity headers for traffic from tagged devices, so Commonspace rejects it.

## Start the host with private access

If a host is already running for this workspace, stop it before applying new startup configuration. Use **Stop Hosting** in Electron or the installed service's stop command.

From the source checkout, start Electron with the private origin and owner:

```bash
COMMONSPACE_REMOTE_ORIGIN=https://commonspace.tail123456.ts.net \
COMMONSPACE_REMOTE_OWNER_LOGIN=you@example.com \
pnpm start
```

The local client uses `http://127.0.0.1:47321`. The private browser listener uses `127.0.0.1:47322`; it accepts only requests with the configured Tailscale identity and HTTPS Host.

In another terminal on the Mac, configure the private Serve proxy:

```bash
tailscale serve --bg http://127.0.0.1:47322
tailscale serve status
```

The reported HTTPS origin must match `COMMONSPACE_REMOTE_ORIGIN` exactly. Open that URL in the viewing device's browser with Tailscale connected. The browser loads the same workspace. There is no mobile app installation.

If you configure `COMMONSPACE_REMOTE_PORT`, use that same nonzero port in the Serve target. Both Commonspace listeners stay on loopback. Tailscale terminates HTTPS and supplies the owner identity.

For a foreground host without Electron, build with `pnpm build`, then use the same environment variables with `pnpm start:web`. Keep that terminal running.

## Keep the installed Mac service configured

The source service installs committed code. Use a revision containing the current remote contract before running these commands.

To install with private access:

```bash
node scripts/commonspace-service.mjs install --source . \
	--remote-origin https://commonspace.tail123456.ts.net \
	--remote-owner-login you@example.com
```

To configure an installed source service during an update:

```bash
~/.local/bin/commonspace update \
	--remote-origin https://commonspace.tail123456.ts.net \
	--remote-owner-login you@example.com
```

Updates without remote flags retain the saved configuration. The LaunchAgent starts at user login. It does not keep a sleeping Mac available or start before that user logs in. See [Service operations](operations.md#installed-macos-service) for logs, stop, restart, update, and rollback.

Closing a window or choosing **Quit Commonspace** leaves the host running. **Stop Hosting** stops it. Relaunching Electron attaches to the verified host for the same `COMMONSPACE_HOME`.

## Work on host projects

1. Choose **Add Project**, then **GitHub repository**.
2. Enter a GitHub HTTPS or SSH repository URL, a Project name, and an optional branch.
3. Choose **Import repository**. The host clones and registers the checkout before opening its Project view.
4. Inspect **Files** and **Changes**, then reference the Project in a conversation with `@@`.

Private repository authentication must already work in Git on the host. Imports do not prompt for credentials. Imports skip automatic submodule and LFS retrieval. Agents can perform any additional checkout preparation on the host.

Use Agent conversations to request edits, verification, commits, pushes, and pull requests. Commonspace displays the host's files and diffs. It has no separate Git shipping controls or phone-side repository copy.

## Reconnect or remove access

Reconnect Tailscale and reload the workspace after losing connectivity. Retry an unchanged failed send through the existing recovery flow. The host reuses the original acceptance instead of starting the request twice. Editing the draft creates a new submission.

Remove a viewing device through Tailscale to revoke its network access. Other Tailscale identities are rejected by Commonspace, including shared-device visitors whose login differs from the configured owner.

To disable the installed service's browser listener during an update:

```bash
~/.local/bin/commonspace update --disable-remote
```

For a source-launched host, stop it and relaunch without the remote variables. Remove the corresponding Serve route if it is no longer needed.

## Check the connection

- For a rejected request, check the exact owner login, HTTPS origin, and Serve target port. Tagged viewing devices do not supply user identity.
- If the host is unavailable, check that the Mac is awake and hosting. Closing a foreground host terminal stops that process.
- Native folder selection and editor launch are available only on the host. GitHub import, Project browsing, and Agent conversations use the shared browser API.

Release acceptance still needs a real Tailscale connection, phone browser, device removal, and Mac login or reboot test. Local fixtures and native Electron smoke do not certify those external steps. A separate Expo app remains [deferred](../../ROADMAP.md#later).
