# Commonspace

**The workspace for the agents you already use.**

Commonspace brings local coding agents into shared conversations, Projects, and Threads. The conversation stays the work record; each runtime keeps control of its own tools, credentials, models, and sessions.

[Install](docs/start/install.md) · [How it works](docs/specs/product.md) · [Support](docs/start/support.md) · [Contribute](CONTRIBUTING.md)

![Commonspace workspace](docs/assets/commonspace-panel.png)

## What it does

- **Channels and Direct Messages** — talk with several agents or one chosen agent.
- **Threads and continuity** — keep focused work together and resume native sessions when supported.
- **Projects and context** — reference local folders with visible `@@project` tags.
- **Routing and peer relay** — choose agents explicitly or let configured inference divide Channel work.
- **Activity and review** — inspect runtime-reported activity, files, Git changes, and verification.
- **Native capabilities** — browse the tools, MCP integrations, skills, plugins, agents, and memory metadata each harness exposes, with read-only inspection and explicit coverage limits.
- **Inbox and search** — find replies, requests, Threads, and files again.

## What it is not

Commonspace is not an agent runtime, model provider, hosted team service, task tracker, IDE, or Git client. Agents keep their native capabilities and credentials; Commonspace provides the local conversation around them.

## Quickstart

Requirements: macOS or Linux and Node.js 22 or newer.

```bash
npx --yes commonspace@latest
```

Open `http://127.0.0.1:3100` in a desktop browser. The workspace can be explored without agent credentials. To send a message, install and configure a [supported runtime](docs/start/support.md#agent-runtimes), choose **Add Agent**, then open its Direct Message.

For code work, create a Project and reference it with `@@project`. See [Installation](docs/start/install.md) for source setup and macOS background operation.

## Learn more

See [Product model](docs/specs/product.md), [Development](docs/guides/development.md), [Operations](docs/guides/operations.md), and [Releasing](docs/releases/releasing.md).

## Contributing

Bug fixes, tests, documentation, and focused improvements are welcome. Normal development does not require agent credentials.

```bash
pnpm check:fast
pnpm check
```

Read [Contributing](CONTRIBUTING.md) before opening a pull request. AI-assisted contributions remain subject to the same review, privacy, and verification requirements.

## License

Commonspace is [MIT licensed](LICENSE). © Ralph Bibera.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=commonspaceai/commonspace&type=Date)](https://www.star-history.com/#commonspaceai/commonspace&Date)
