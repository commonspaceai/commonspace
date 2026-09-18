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

## Verify

Add a focused failing test for behavior changes. Use Storybook for isolated UI states and browser flows for assembled behavior.

```bash
pnpm check:fast
pnpm check
pnpm verify:live
git diff --check
```

For documentation-only changes, check links, commands, and Markdown syntax. See [Contributing](CONTRIBUTING.md) for change-specific verification.
