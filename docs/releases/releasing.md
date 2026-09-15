# Releasing Commonspace

Commonspace follows an npm-first release model. One `commonspace` package contains the bundled Commonspace CLI/server code and built browser UI. External npm dependencies remain ordinary package dependencies and are installed by npm. GitHub Releases contain the tag and release notes, not duplicate platform archives.

## Choose the version

Commonspace follows [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html), starting at `0.0.1`. Keep one identical version in the root, `cli`, `packages/shared`, `server`, and `ui` package manifests.

Compatibility covers documented HTTP and MCP interfaces, CLI behavior, and the workspace archive format. The internal saved-state schema has a separate version and requires its own migration and recovery coverage.

| Change | Version update |
| --- | --- |
| Compatible bug or security fix | Increment the patch version. |
| Compatible feature or deprecation | Increment the minor version and reset the patch to zero. |
| Breaking change before `1.0.0` | Increment the minor version, reset the patch to zero, and include migration notes. |
| Breaking change from `1.0.0` onward | Increment the major version, reset minor and patch to zero, and include migration notes. |

Use a prerelease suffix for candidates, such as `0.0.2-rc.1`. Git tags add only `v` and must match exactly. The release workflow publishes prereleases under npm's `next` tag and stable versions under `latest`.

Update the version and release notes through the normal contribution workflow. Release only a reviewed commit. Never move an existing release tag.

## Build and check locally

Use a clean checkout with Git, Corepack, Node.js 22, and the pinned pnpm version:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm verify:live
pnpm build:npm
pnpm verify:npm-package
```

`build:npm` builds all workspaces, bundles Commonspace-owned server and shared code into `cli/dist/index.js`, copies the built UI, and writes `artifacts/npm/commonspace-<version>.tgz` through `npm pack`.

`verify:npm-package` installs that tarball into a clean temporary prefix using npm. It checks npm command launchers, starts the installed package outside the source checkout in paths containing spaces, requests the API and browser assets, and verifies shutdown and saved-state restart. Windows uses private IPC disconnect for graceful shutdown; a real terminal is required to verify Ctrl+C. It does not connect a real agent.

The npm tarball contains only:

| File or directory | Purpose |
| --- | --- |
| `dist/index.js` and source map | Commonspace CLI plus bundled Commonspace-owned server/shared code |
| `ui-dist` | Built browser application |
| `package.json` | CLI metadata and ordinary external runtime dependencies |
| `README.md` | Package overview and setup |
| `LICENSE` | Commonspace's MIT license |

The package does not vendor `node_modules`, platform archives, checksum sidecars, release manifests, or copied dependency-license files. npm owns dependency selection, integrity metadata, installation, and cache behavior.

## Check real integrations

Before publishing, record results from the supported environment:

| Check | What it proves |
| --- | --- |
| `pnpm verify:service` on macOS | Source-based clone, build, update, rollback, and LaunchAgent configuration in a temporary home |
| `pnpm verify:acp` | Authenticated Hermes, Codex, and Claude Code installations can start and resume exact native sessions |
| `pnpm verify:adapters` | Pinned Claude Code, Gemini CLI, and OpenCode runtimes work against local model fixtures without provider credentials |
| `pnpm verify:acp:mcp` | Authenticated agents can read permitted context, post progress, and return a reply |

Keep credentials and transcripts local. Copy the [candidate acceptance template](release-acceptance-template.md) and record the exact commit, package version, commands, results, evidence, and every check not run with its exact reason. A clean npm-package smoke does not establish provider-backed compatibility.

## Publish

The `commonspace` npm name has prior unpublished registry history, so do not assume this repository controls it. Before enabling publication, confirm the intended npm owner can reclaim and publish that name; otherwise choose a new package name in `cli/package.json` and update user-facing commands. For a new package, bootstrap once from the locally verified tarball with maintainer npm authentication and two-factor approval. Do not store that credential in the repository.

After the package exists, configure npm trusted publishing for `commonspaceai/commonspace`, `release.yml`, and the `npm-release` GitHub environment; then disable token-based package publication. If repository ownership changes, update the npm trusted publisher to match the new owner before publishing again. Create the repository variable `NPM_RELEASE_ENABLED=true` only after those controls are live. Non-dry runs fail closed while the variable is absent.

Create the exact version tag on a reviewed `main` commit and push it, then create and publish a GitHub Release for that tag. The `published` release event starts the Release workflow automatically. The workflow also supports manual dispatch for dry-run and recovery; leave `dry_run` enabled first for that path.

The workflow:

1. Resolves the tag, requires its commit to belong to `main`, and checks all workspace versions.
2. Runs the complete local checks and integrated live verifier.
3. Builds one npm tarball and installs it into a clean Linux prefix, then downloads that same artifact into the Windows job for runtime smoke testing. Publication requires both jobs to pass.
4. Previews `npm publish` during a dry run.
5. After an approved non-dry run, rechecks the remote tag commit and publishes with npm provenance.
6. For a published GitHub Release, leaves the existing release in place; for manual dispatch, creates the GitHub Release after publishing.

The first `commonspace` package version needs a one-time maintainer-authenticated bootstrap because npm trusted-publisher configuration requires the package to exist. Publish the verified `0.0.1` tarball once with npm 2FA, then configure the GitHub Actions trusted publisher. If the published GitHub Release event sees that exact version already present, the workflow skips a duplicate npm publish and completes the GitHub-side release automation. Future versions use the published-release trigger end to end.

Normal CI builds the CLI, server, shared package, and UI through `pnpm build`; its Windows job also builds and installs a candidate tarball on every pull request. The release workflow additionally proves that the exact Linux-built artifact destined for npm runs on Windows. Record the [Windows automated and manual checks](../guides/windows-validation.md) separately; a passing smoke does not establish native agent, folder-dialog, notification, or console-interrupt behavior.

If npm publication succeeds but GitHub Release creation fails, create the GitHub Release for the existing tag manually. Never republish or move the tag to repair release notes.
