# Releasing

The release path is: verify a candidate → merge to `main` → tag the verified commit → publish a [GitHub Release](https://github.com/commonspaceai/commonspace/releases). Publishing that release triggers npm publication.

GitHub owns release notes and history; do not copy them into the repository or publish npm locally. First-time maintainers should check [repository setup](#repository-setup) before preparing a release.

Compatibility covers documented HTTP/MCP interfaces, CLI behavior, and the workspace archive format.

## Prepare

1. **Set the version.** Keep the same version in the root, `cli`, `packages/shared`, `server`, and `ui` manifests. Use a patch for compatible fixes, a minor for features or pre-1.0 breaking changes, and a major for breaking changes from 1.0 onward. Describe any migration. Saved-state and archive schema versions remain separate.
2. **Verify the candidate on macOS.** Run the complete release gate on the unchanged candidate:

   ```bash
   pnpm verify:release
   ```

   This installs the locked dependency graph and managed Chromium, then runs repository checks, reviewed visual baselines, messaging flows, assembled browser flows, live verification, and clean package installation. Windows compatibility remains an independent required CI job.

3. **Record the evidence.** Include the commit, version, CI links, and relevant [agent](../adapters/agent-adapters.md#verification-commands), [service](operations.md#installed-macos-service), and [Windows](windows-validation.md) results in the release task or PR. State why any relevant check was not run. Package smoke does not prove authenticated agent or interactive desktop behavior.
4. **Merge the verified candidate.** Push the candidate branch and merge it through protected `main` after **Required CI gate** passes. Wait for the exact merged commit's `main` CI run to pass as well.
5. **Check and push the tag.** Replace `<version>` with the release version in `node scripts/package-npm.mjs --check-tag v<version>`. After the check passes, create and push that tag on the verified commit. Never move a published tag.

## Publish

Create and publish the GitHub Release for that tag. Use the tag as its title. Notes need only **Improvements** or **Fixes** where relevant, a few short bullets, and a **Full changelog** compare link. Omit repeated headings and installation boilerplate.

The [Release workflow](../../.github/workflows/release.yml):

1. Checks the exact version, commit, and passing `main` CI.
2. Builds one tarball and tests it on Linux and Windows.
3. Publishes it through npm trusted publishing: stable versions use `latest`; prereleases use `next`.
4. Rechecks the tag and verifies npm's package identity and SHA-512 integrity against the tested tarball.

## Recovery

Rerun failed jobs after resolving the error. Manual dispatch from `main` supports two operations:

- A dry run of an existing tag.
- An npm retry for an **already-published GitHub Release**.

Manual dispatch cannot create a release or replace its notes. If the npm version already exists, the workflow skips publication and requires it to match the tested package. A newly published version may take up to five minutes to become visible; other registry errors or mismatches fail immediately.

Edit notes on GitHub to correct them. Do not republish a package or move its tag for a text correction.

## Repository setup

The npm trusted publisher must match `commonspaceai/commonspace`, `release.yml`, and the `npm-release` environment. Keep token-based npm publication disabled.

The GitHub environment requires owner approval and allows `main` and `v*` tags. Set `NPM_RELEASE_ENABLED=true` only while npm ownership and trusted publishing are configured; update that configuration if ownership changes. Follow [Maintaining → Configure GitHub](maintaining.md#configure-github) to apply and verify the repository policies.
