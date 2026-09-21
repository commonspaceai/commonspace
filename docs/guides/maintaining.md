# Maintaining Commonspace

Maintainers review contributions, handle reports, and prepare releases. [CODEOWNERS](../../.github/CODEOWNERS) identifies the reviewers for each part of the repository.

## Handle issues and proposals

Look for related issues and pull requests before creating new work. For a bug, establish what happened, what should have happened, how to reproduce it, and which version is affected. Then identify the smallest part of the code responsible for the behavior.

For a feature, agree on the user problem and product fit before accepting a large implementation. Record product and architectural decisions in the relevant documentation so future contributors can find them.

Small fixes may arrive directly as pull requests. Do not require an issue that repeats a clear pull request description. Link related work and credit earlier contributors when work is continued or combined.

## Review a pull request

Use [Contributing](../../CONTRIBUTING.md) as the review standard. Resolve substantive feedback, check required CI, and review the complete diff before approval. Use conventional commit messages.

## Review workflows and dependencies

Treat workflow and dependency changes as executable code. Contribution workflows use the `pull_request` event and read-only default permissions. Do not expose provider credentials or run untrusted contribution code through a privileged event.

Review permission changes explicitly. Dependency updates do not authorize additional access or automatic merging. Review tools can help find problems, but the maintainer remains responsible for the decision.

Keep these repository controls enabled:

- require approval before workflows from every external contributor;
- allow GitHub-owned actions plus the explicitly selected `pnpm/action-setup`, and require full commit-SHA pins;
- keep the default workflow token read-only and prevent it from approving pull requests;
- use GitHub-hosted runners only for untrusted pull request code;
- keep secret scanning, push protection, Dependabot alerts, and Dependabot security updates enabled.

## Configure GitHub

The default branch requires the aggregate **Required CI gate** from GitHub Actions, an up-to-date branch, resolved review conversations, and one code-owner approval for contributors without the owner review allowance. New commits dismiss stale approvals. Force pushes and branch deletion are disabled for ordinary writers. Administrator enforcement remains disabled so the repository owner retains an emergency direct-push and force-push recovery path.

[`main-branch-protection.json`](../../.github/main-branch-protection.json) is the versioned configuration. An administrator can apply it from the repository root with an authenticated GitHub CLI:

```bash
gh api --method PUT repos/commonspaceai/commonspace/branches/main/protection \
  --input .github/main-branch-protection.json
gh api repos/commonspaceai/commonspace/branches/main/protection
```

The required check is bound to the GitHub Actions app, ID `15368`; another status publisher cannot satisfy it. Verify the returned settings after applying the file, including the required check, disabled administrator enforcement, review and conversation requirements, and force-push/deletion restrictions. The file alone does not enable protection.

The PR-review allowance names `ralphbibera`, the repository owner and current code owner. It permits owner-authored maintenance without an impossible self-approval. Separately, disabled administrator enforcement lets the owner bypass branch protection for deliberate recovery, including a force push. Do not use that escape hatch as the normal release path: validate the exact commit first and record why bypass was necessary. GitHub scopes the review allowance to the acting user, not the PR author, so review outside contributions through the normal PR path. Revisit the allowance and [CODEOWNERS](../../.github/CODEOWNERS) when the maintainer group changes.

When renaming a required check, migrate the live protection without an unverified gap. Push the exact candidate commit to a temporary branch, dispatch CI for that branch, and wait for the new check to pass:

```bash
git push origin HEAD:refs/heads/codex/ci-gate-migration
gh workflow run ci.yml --ref codex/ci-gate-migration
gh run list --workflow CI --branch codex/ci-gate-migration
```

Confirm that **Required CI gate** succeeded for the candidate SHA, apply `main-branch-protection.json`, then fast-forward `main` to that same SHA and verify its push-triggered CI run. Do not apply a renamed required context before it exists successfully on the candidate commit; the old context would no longer be satisfiable by the changed workflow.

Release tags and the npm environment have separate versioned policies. Install the tag ruleset once, then update it by the returned ruleset ID:

```bash
gh api --method POST repos/commonspaceai/commonspace/rulesets \
  --input .github/release-tag-ruleset.json
gh api repos/commonspaceai/commonspace/rulesets
gh api --method PUT repos/commonspaceai/commonspace/rulesets/<ruleset-id> \
  --input .github/release-tag-ruleset.json
```

The active ruleset prevents `v*` release tags from being changed or deleted. Apply and verify the npm release environment separately:

```bash
gh api --method PUT repos/commonspaceai/commonspace/environments/npm-release \
  --input .github/npm-release-environment.json
gh api repos/commonspaceai/commonspace/environments/npm-release
gh api repos/commonspaceai/commonspace/environments/npm-release/deployment-branch-policies
```

The environment requires owner approval. Self-review remains enabled while there is only one maintainer; add an independent reviewer and set `prevent_self_review` when the maintainer group grows. Its deployment-policy response must contain exactly the `main` branch and `v*` tag policies. If either is absent, create only the missing policy and fetch the list again:

```bash
gh api --method POST repos/commonspaceai/commonspace/environments/npm-release/deployment-branch-policies \
  --input .github/npm-release-main-policy.json
gh api --method POST repos/commonspaceai/commonspace/environments/npm-release/deployment-branch-policies \
  --input .github/npm-release-tag-policy.json
gh api repos/commonspaceai/commonspace/environments/npm-release/deployment-branch-policies
```

Remove any unexpected policy by its returned ID with `gh api --method DELETE repos/commonspaceai/commonspace/environments/npm-release/deployment-branch-policies/<policy-id>`, then verify the list again. The environment permits releases only from those two configured refs.

GitHub does not expose the environment's administrator-bypass switch through its REST or GraphQL update APIs. In **Settings → Environments → npm-release**, turn off **Allow administrators to bypass configured protection rules**, then verify that the environment API response contains `"can_admins_bypass": false`. Treat that manual control as part of release setup; the checked-in JSON intentionally contains only fields GitHub's API accepts.

Check the issue and pull request templates and reporting routes. The repository description, topics, and links should describe Commonspace accurately. Do not require checks that the repository does not run.

Use Linear for investigation and validation. Promote a finding to a GitHub issue only once its implementation scope and acceptance check are established; a clear, focused PR does not need a duplicate issue.

## Handle security and conduct reports

Follow [Security](../../SECURITY.md) and the [Code of Conduct](../../CODE_OF_CONDUCT.md). Arrange a confidential route before asking someone for sensitive details. Do not request workspace state or agent transcripts in ordinary issues.

Maintain working confidential reporting routes for security and conduct concerns, and keep the policies current. Do not promise response times or long-term version support that the maintainer group cannot provide.

Security fixes target `main` and the latest release. Document affected versions, the upgrade path, and any saved-data compatibility limits.

## Releases

Follow [Releasing](releasing.md) for versioning, verification, publication, notes, and trusted-publisher configuration.
