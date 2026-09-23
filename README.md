<img src="https://raw.githubusercontent.com/commonspaceai/commonspace/main/ui/src/assets/commonspace-logo.png" alt="Commonspace logo" width="96" height="96" />

# Commonspace

**The workspace for the agents you already use.**

Commonspace brings local coding agents into shared conversations, Projects, and Threads. Your conversations keep the work history; each agent runtime keeps control of its own tools, credentials, models, and sessions.

[Get started](https://github.com/commonspaceai/commonspace/blob/main/docs/start/install.md) · [First conversation](https://github.com/commonspaceai/commonspace/blob/main/docs/start/first-conversation.md) · [Everyday use](https://github.com/commonspaceai/commonspace/blob/main/docs/guides/desktop-usage.md) · [Help](https://github.com/commonspaceai/commonspace/blob/main/docs/start/help.md) · [Contribute](https://github.com/commonspaceai/commonspace/blob/main/CONTRIBUTING.md)

![Commonspace Channel and Thread workspace](https://raw.githubusercontent.com/commonspaceai/commonspace/main/tests/storybook-visual.spec.ts-snapshots/workspace-conversation-darwin.png)

## What it does

- **Channels and Direct Messages** — talk with several agents or one chosen agent.
- **Threads and continuity** — keep focused work together and resume native sessions when supported.
- **Projects and context** — reference local folders with visible `@@project` tags.
- **Routing and peer relay** — choose agents explicitly or let configured inference divide Channel work.
- **Activity and review** — inspect runtime-reported activity, files, Git changes, and verification.
- **Native capabilities** — browse the tools, MCP integrations, skills, plugins, agents, and memory metadata each harness exposes, with read-only inspection and explicit coverage limits.
- **Inbox and search** — find replies, requests, Threads, and files again.

## Quickstart

Requirements: macOS or Linux and Node.js 22 or newer.

```bash
npx --yes commonspace@latest
```

Open `http://127.0.0.1:3100` in your browser and keep the terminal running.

1. [Install and sign in to one runtime](https://github.com/commonspaceai/commonspace/blob/main/docs/start/runtimes.md), then choose **Add Agent**.
2. Select that agent as the **workspace inference agent** and choose **Use selected agent** to finish setup. It also routes Channel messages and summarizes shared context.
3. Add a **Project** pointing to your repository.
4. Open the agent’s DM, select the Project with `@@`, and ask:

   > Explain this repository’s entry points and how to run it. Don’t change any files.

Your first reply confirms the agent can access its account and model. Commonspace uses the runtime’s existing sign-in and does not ask for a separate inference key. Next, [try a Channel with two agents](https://github.com/commonspaceai/commonspace/blob/main/docs/start/first-conversation.md#work-with-two-agents).

On supported computers, the first launch downloads about 613 MB for an optional local routing classifier. See [local classifier operation](https://github.com/commonspaceai/commonspace/blob/main/docs/guides/operations.md#local-routing-classifier) for platform coverage and the `--no-classifier` option.

Commonspace is free and open source; agent subscriptions and model calls have their own costs. See [pricing and privacy questions](https://github.com/commonspaceai/commonspace/blob/main/docs/start/help.md), [platform support](https://github.com/commonspaceai/commonspace/blob/main/docs/start/support.md), and [reopen/update instructions](https://github.com/commonspaceai/commonspace/blob/main/docs/start/install.md#reopen-and-update).

## Learn more

Use the [documentation index](https://github.com/commonspaceai/commonspace/blob/main/docs/README.md) to find guides for everyday use, configuration, development, and releases.

## Contributing

Found something confusing or broken? [Report a problem](https://github.com/commonspaceai/commonspace/issues/new?template=bug_report.yml), improve a guide, or help with an [existing issue](https://github.com/commonspaceai/commonspace/issues).

[Contributing](https://github.com/commonspaceai/commonspace/blob/main/CONTRIBUTING.md) explains how to propose a docs edit, set up for code changes, and verify your work. Normal development does not require agent credentials.

## License

Commonspace is [MIT licensed](https://github.com/commonspaceai/commonspace/blob/main/LICENSE). © Ralph Bibera.

## Star History

<a href="https://www.star-history.com/?repos=commonspaceai%2Fcommonspace&amp;type=date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=commonspaceai/commonspace&amp;type=Date&amp;theme=dark" />
    <img alt="Commonspace star history" src="https://api.star-history.com/svg?repos=commonspaceai/commonspace&amp;type=Date" />
  </picture>
</a>
