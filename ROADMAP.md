# Roadmap

This page lists current priorities and deferred work. It is not the product contract or release checklist; use the [Product specification](docs/specs/product-spec.md) and [Releasing](docs/guides/releasing.md) for those.

## Now

- Validate the release on clean supported machines, including npm installation, desktop browser behavior, and macOS service lifecycle.
- Maintain desktop usability and regression coverage for navigation, search, follow-up delivery, settings, accessibility, and Light/Dark/System.
- Keep the initial native-agent baseline stable: Codex, Claude Code, Gemini CLI, OpenCode, and Hermes.
- Validate native capability browsing against supported harness versions, including source coverage, unavailable states, and private metadata boundaries.

## Next

- Resolve Gemini CLI's late native-history replay before certifying full resume compatibility or expanding support. [Current evidence](docs/adapters/agent-adapters.md#gemini-revalidation-evidence) records the 0.43.0 replay defect and rejects 0.59.0 after a restart/resume failure.
- Add Pi coding agent after its transport passes the same native-session and scoped-MCP checks. The published bridge currently [does not wire scoped MCP](docs/adapters/agent-adapters.md#pi-integration-status).
- Measure larger synthetic workspaces before changing the current JSON persistence model.

## Later

- Desktop application wrapper over the same local service.
- Additional Project resource types beyond local folders.
- Relational transcript storage when measured scale justifies it.
- Generic plugin lifecycle after the native runtime interface is stable.
- Mobile and narrow-layout support after an explicit product decision.
