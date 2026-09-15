# Releasing

Publish a [GitHub Release](https://github.com/commonspaceai/commonspace/releases) to trigger npm publication. GitHub owns release notes and history; do not copy them into the repository or publish npm locally.

Compatibility covers documented HTTP/MCP interfaces, CLI behavior, and the workspace archive format.

## Prepare

1. Keep the same version in the root, `cli`, `packages/shared`, `server`, and `ui` manifests. Use a patch for compatible fixes, a minor for features or pre-1.0 breaking changes, and a major for breaking changes from 1.0 onward. Describe any migration. Saved-state and archive schema versions remain separate.
2. Verify the unchanged candidate with the [development prerequisites](development.md#setup):

   ```bash
   pnpm install --frozen-lockfile
   pnpm check
   pnpm verify:live:built
   pnpm package:npm
   pnpm verify:npm-package
   ```

3. Record the commit, version, CI links, and relevant [agent](../adapters/agent-adapters.md#verification-commands), [service](operations.md#installed-macos-service), and [Windows](windows-validation.md) results in the release task or PR. State why any relevant check was not run. Package smoke does not prove authenticated agent or interactive desktop behavior.
4. Push the reviewed commit to `main` and wait for its CI to pass. Check the intended tag with `node scripts/package-npm.mjs --check-tag v<version>`, then create and push that tag on the verified commit. Never move a published tag.

## Publish

Create and publish the GitHub Release for that tag. Use the tag as its title, such as **v0.0.4**. Notes need only **Improvements** or **Fixes** where relevant, a few short bullets, and a **Full changelog** compare link. Omit repeated headings and installation boilerplate.

The [Release workflow](../../.github/workflows/release.yml) checks the exact version, commit, and passing `main` CI; builds and tests one tarball on Linux and Windows; then publishes it through npm trusted publishing. Stable versions use `latest`; prereleases use `next`. Before finishing, it rechecks the tag and verifies npm's package identity and SHA-512 integrity against the tested tarball.

## Recovery

Rerun failed jobs after resolving the error. Manual dispatch from `main` supports a dry run of an existing tag or an npm retry for an **already-published GitHub Release**. It cannot create a release or replace its notes. An existing npm version skips publication and must still match the tested package. A newly published version may take up to five minutes to become visible; other registry errors or mismatches fail immediately.

Edit notes on GitHub to correct them. Do not republish a package or move its tag for a text correction.

## Repository setup

The npm trusted publisher must match `commonspaceai/commonspace`, `release.yml`, and the `npm-release` environment. Keep token-based npm publication disabled. The GitHub environment requires owner approval and allows `main` and `v*` tags. Set `NPM_RELEASE_ENABLED=true` only while npm ownership and trusted publishing are configured; update that configuration if ownership changes.
