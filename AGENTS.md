# Working on Commonspace

Commonspace is a local-first workspace for conversations with coding agents. Start with the [Product specification](docs/specs/product-spec.md) for behavior, [Architecture](docs/guides/architecture.md) for ownership, and [Development](docs/guides/development.md) for commands.

## Engineering invariants

- Conversations are the work record. Preserve context, delivery, and session relationships.
- Resume the exact native session when continuing work. `/new` is a fresh-context boundary.
- Persist accepted messages before routing or execution. Failures must not erase the original request.
- Run independent native sessions concurrently; serialize calls to the same session.
- Keep credentials, native session data, host paths, and temporary capabilities private.
- Bind the server to loopback and preserve same-origin mutation guards.
- Invoke subprocesses with argument arrays and piped input, never shell command strings.
- Version saved-data changes, write atomically, and test migration and recovery.

Keep behavior in its owning package. Shared types belong in `packages/shared`; server behavior belongs in `server`; browser behavior belongs in `ui`; the browser uses shared contracts and `/api`.

When a shared contract changes, update consumers, validation, migrations, tests, and the owning documentation together. Use synthetic data; keep credentials, local state, sessions, and generated artifacts out of commits.

## UI workflow

Storybook and `@storybook/addon-mcp` are part of this project's UI stack. For component, styling, or interaction changes, use the Storybook MCP workflow in [Visual verification](docs/design/visual-verification.md#storybook-mcp-workflow): discover existing components and stories before implementing, use the running canvas while visually iterating, and obtain previews of the affected screens. The project connection is configured in `.codex/config.toml`; start `pnpm storybook` to serve it.

During visual exploration, keep the Storybook development server running and iterate on the production components through hot reload in `Workspace/Conversation`. That workspace uses the real app and client store with a stateful mock HTTP boundary; keep visual changes in shared components, and keep mock data/handlers under stories. Use separate prototypes only for explicitly requested alternatives. Open the canvas once and inspect the changed pixels. Do not run whole-project checks, builds, broad test suites, or repeated agent reviews between visual edits. Run focused interaction checks only when validating a settled interaction or diagnosing a concrete behavior bug; run integration gates when preparing production changes for release.

Settle the desktop design at 1440 × 960 first. Inspect actual rendered pixels and exercise the changed desktop flow, including hover, focus, and Light/Dark states. Do not expand a desktop design pass into mobile/tablet or responsive redesign unless explicitly requested; preserve existing behavior while the desktop composition is being established. MCP documentation, accessibility checks, and passing tests do not establish visual quality. If MCP is unavailable, report the concrete failure and use the documented CLI/browser fallback; do not silently skip the workflow or call a fallback an MCP run.

## Verify

Add a focused failing test for behavior changes. Use Storybook for isolated UI states and browser flows for assembled behavior.

```bash
pnpm check:fast
pnpm check
pnpm verify:live
git diff --check
```

For documentation-only changes, check links, commands, and Markdown syntax. See [Contributing](CONTRIBUTING.md) for change-specific verification.
