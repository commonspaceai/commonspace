# Agent adapter proposal: <Harness name>

Copy this template into a proposal or pull request. Replace every placeholder with evidence before marking the adapter supported.

## User outcome

- Installed native harness and identity users can add:
- Stable adapter ID and display label:
- Existing runtime behavior preserved:
- Explicitly excluded scope:

## Native integration evidence

| Contract | Evidence and limitations |
| --- | --- |
| Primary documentation and maintained ACP bridge | URL, exact package/version, license, supported platforms |
| Installation and authentication | Commands; credential ownership |
| Discovery and stable identity | Bounded commands, ID format, missing-runtime behavior |
| Runtime version compatibility | Exact tested versions, supported range, rejection/recovery for known regressions, revalidation on upgrade |
| New session and exact resume | `session/new`, `session/load`, restart evidence, explicit missing-session error |
| Permissions and Full access | Advertised native modes/options; normal default; policy changes and revocation during active or queued work |
| Model and reasoning controls | Advertised config IDs and values; unsupported-setting behavior |
| Emitted activity, tools, images, files | Observed capabilities; gaps |
| Read-only capability inventory | Native sources, profile/user scope, supported categories, empty/unavailable/error states, bounded extraction, and privacy evidence |
| Scoped Commonspace MCP | Context read, progress, host-private bearer capability |
| Cancellation and independent concurrency | Stop, timeout, reset, shutdown, independent sessions |

## Files and configuration

- Shared catalog entry:
- Server adapter module and registry entry:
- Identity validation and state migration:
- Executable/environment overrides and private-path redaction:
- Pinned production dependencies and archive packaging:
- Documentation and UI states updated:

## Verification record

| Check | Command, result, and exact versions |
| --- | --- |
| Discovery, rejection, persistence, privacy | |
| Same scope resume; new scope isolation; `/new` | |
| Permissions, controls, activity, stop | |
| Add Agent desktop and Storybook flow | |
| Full local checks and integrated browser/server | |
| Archive packaging and extracted-runtime check | |
| Real bridge/runtime with a local model fixture, no account | |
| Optional provider-backed native start and restart/resume | |
| Real scoped MCP context/progress | |

List unverified capabilities and actionable setup limitations. Synthetic ACP fixtures establish Commonspace policy. Real runtime checks with local model fixtures establish bridge/runtime behavior; provider-backed checks establish account and model compatibility only for the recorded versions and capabilities. Link the [adapter guide](agent-adapters.md) and relevant product requirements.
