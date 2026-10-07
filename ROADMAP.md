# Roadmap

This page lists current priorities and deferred work. It is not the product contract or release checklist; use the [Product specification](docs/specs/product-spec.md) and [Releasing](docs/guides/releasing.md) for those.

## Now

- Verify the single-Mac release candidate over the existing host and React client. Window close and Quit leave the host running; Stop Hosting ends it. Reopen, independent CLI attachment, and native-session continuity use the same workspace.
- Validate private browser access through Tailscale Serve on a real phone and a Mac kept awake. Include owner rejection, device removal, reconnect, permission responses, lost-send recovery, and service restart.
- Verify GitHub import, host checkout browsing, failed-import recovery, and agent-led commit, push, and pull-request work.
- Validate the release on a clean Mac, including npm installation, desktop browser behavior, and macOS service lifecycle.
- Maintain desktop usability and regression coverage for navigation, search, follow-up delivery, settings, accessibility, and Light/Dark/System.
- Keep the initial native-agent baseline stable: Codex, Claude Code, Gemini CLI, OpenCode, and Hermes.
- Validate native capability browsing against supported harness versions, including source coverage, unavailable states, and private metadata boundaries.

## Release milestones

The source implementation includes the host, private browser boundary, retry-safe sends, and GitHub import. These milestones define the remaining release acceptance.

| Milestone | User outcome | Dependencies | Acceptance | Explicit deferrals |
| --- | --- | --- | --- | --- |
| Mac host | Quit and reopen Electron while work stays on one Mac. | Existing conversation state and native-session mappings. | Native launch, same-host relaunch, independent CLI attachment, explicit stop, and restart preserve accepted work. | Signed installers, other Electron platforms, and multiple hosts. |
| Private browser | Continue work from another computer or phone. | Mac host and Tailscale Serve. | Real HTTPS tailnet access accepts only the owner; removed devices lose access; reconnect and unchanged send retries preserve one acceptance and its session. | Public hosting, Commonspace accounts, shared-user permissions, and Expo. |
| Host projects | Import GitHub and review the same checkout the Agents use. | Mac host, Git authentication, and private browser access. | Selected branch, failed import, shutdown during clone, file previews, and diffs preserve existing data. Agents can perform reviewed shipping work. | Git management UI, client-side repository copies, automatic submodule or LFS retrieval. |
| Mac distribution | Install and recover the workspace on a clean Mac. | Host, browser, and Project acceptance. | Signed installation, update, rollback guidance, and launch-at-login behavior have recorded native evidence. | Linux and Windows Electron distribution and cloud fleet management. |

## Next

- Package the Electron app for Mac, including installation, signing, updates, and host recovery.
- Complete any browser usability fixes found during real phone acceptance of Agent activity, permission responses, conversations, files, and diffs.
- Benchmark local classification and harness-backed routing for quality and latency. Local classification, retrieval, original-message multi-agent delivery, and background compaction are implemented; held-out quality and message-to-dispatch p95 remain unverified.
- Resolve Gemini CLI's late native-history replay before certifying full resume compatibility or expanding support. [Current evidence](docs/adapters/agent-adapters.md#gemini-revalidation-evidence) records the 0.43.0 replay defect and rejects 0.59.0 after a restart/resume failure.
- Add Pi coding agent after its transport passes the same native-session and scoped-MCP checks. The published bridge currently [does not wire scoped MCP](docs/adapters/agent-adapters.md#pi-integration-status).
- Measure larger synthetic workspaces before changing the current JSON persistence model.

## Later

- Build a separate Expo mobile app after the Mac host and private browser access are stable. Define native authentication, device revocation, reconnect, and mobile release checks before implementation. Expo is deferred and is not part of the current release.
- Additional execution hosts, shared-user access, and Electron distribution beyond Mac.
- Additional Project resource types beyond local folders and imported GitHub checkouts.
- Relational transcript storage when measured scale justifies it.
- Generic plugin lifecycle after the native runtime interface is stable.

The first release serves one person using one running Mac. Browser access is the phone client for this release. See [Product direction](docs/specs/product-direction.md#host-and-clients) for the boundary and [Private browser access](docs/guides/remote-access.md) for source setup. Source implementation does not imply a published release or completed real-device acceptance.
