# Commonspace documentation

Choose the path for what you want to do. New users can follow the first four guides in order.

## Use Commonspace

1. [Install Commonspace](start/install.md) — requirements, first launch, reopening, and updates.
2. [Set up an agent runtime](start/runtimes.md) — install and sign in to the agents you want to use.
3. [Your first useful conversation](start/first-conversation.md) — ask about a repository, then try a Channel with two agents.
4. [Using the desktop workspace](guides/desktop-usage.md) — navigation, follow-ups, search, settings, and keyboard controls.

## Configure or troubleshoot

- [Help and common questions](start/help.md) — common setup problems, pricing, and privacy questions.
- [Operations](guides/operations.md) — configuration, local data, background service, backups, and recovery.
- [Support matrix](start/support.md) — current platform and agent-runtime coverage.

## Understand the product

- [Product model](specs/product.md) — learn the concepts: Projects, Channels, DMs, Agents, and shared context.
- [Product direction](specs/product-direction.md) — understand the scope and decide whether a feature belongs.
- [Product specification](specs/product-spec.md) — look up required behavior and acceptance scenarios.
- [Roadmap](../ROADMAP.md) — see current release work and later plans.

## Contribute or change the code

Start with [Contributing](../CONTRIBUTING.md), follow [Development](guides/development.md) to set up and verify a change, and use [Architecture](guides/architecture.md) to find the owning package.

- **Change the UI:** [Design contract](../DESIGN.md) → [Design system](design/design-system.md) → [Visual verification](design/visual-verification.md).
- **Add or maintain an agent runtime:** [Adapter guide](adapters/agent-adapters.md) and [proposal template](adapters/agent-adapter-template.md).
- **Change shared-history retrieval:** [Retrieval contract](specs/context-retrieval.md) and [evaluation protocol](specs/context-retrieval-evaluation.md).
- **Change workspace portability:** [Workspace archive format](specs/workspace-archive-format.md).
- **Work with the local API:** [HTTP API reference](api/README.md) lists every endpoint, its request and response contracts, and transport rules. [Generate shared contract docs](guides/development.md#shared-contract-reference) for browsable HTML and JSON.

## Maintain and release

- [Maintaining Commonspace](guides/maintaining.md) — contribution review and repository controls.
- [Releasing](guides/releasing.md) — candidate verification and publishing.
- [Windows validation](guides/windows-validation.md) — platform evidence, reproduction commands, and remaining checks.
