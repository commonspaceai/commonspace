# Releasing

The release path is: verify a candidate → merge to `main` → tag the verified commit → publish a [GitHub Release](https://github.com/commonspaceai/commonspace/releases). Publishing that release triggers npm publication.

GitHub owns release notes and history; do not copy them into the repository or publish npm locally. First-time maintainers should check [repository setup](#repository-setup) before preparing a release.

Compatibility covers documented HTTP/MCP interfaces, CLI behavior, and the workspace archive format.

## Nightly builds

The [Nightly workflow](../../.github/workflows/nightly.yml) runs from `main` every day at 18:00 UTC (02:00 Manila time), subject to GitHub scheduling delays. Maintainers can also choose **Actions → Nightly → Run workflow** on `main`. It builds again even when the source commit has not changed. Each run uses one fixed commit and a unique `nightly-YYYY-MM-DD-<commit>-<run>-<attempt>` tag and npm package version.

Linux runs the complete repository checks and live flow, macOS runs the reviewed visual and messaging suites, and Windows runs portable and browser checks. The Linux-built npm tarball must pass clean-install and runtime smoke checks on both Linux and Windows. Compilation, packaging, or package smoke failures prevent publication.

When all checks pass, the workflow publishes an immutable dated prerelease and updates the notes on the rolling [recommended nightly](https://github.com/commonspaceai/commonspace/releases/tag/nightly-green). Follow the dated release link in those notes for the current tarball and source. The rolling tag itself stays on the commit where that page was first created. If checks fail but the package is verified, the workflow publishes a warned `nightly-broken` prerelease for debugging, leaves the recommendation unchanged, and marks the workflow failed. An older commit or older run of the same commit cannot replace a newer recommendation. The dated release contains the tarball, SHA-256 checksum, source metadata, results, and a link to the run logs; temporary Actions artifacts expire after one day.

Nightly tarballs are distributed through GitHub Releases. The release notes contain an exact `npm exec` command for that version. Back up workspace data before trying a nightly. The stable GitHub Release and npm trusted-publishing path below remains a separate, manual decision.

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
