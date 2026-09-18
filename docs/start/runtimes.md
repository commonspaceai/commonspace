# Set up an agent runtime

Commonspace connects to agents installed on the same computer. Install and sign in in your terminal, then choose **Add Agent** in Commonspace. Credentials and native sessions stay with each runtime.

Discovery checks whether the runtime can be found and is compatible. It does **not** confirm authentication, available credit, or model access. Send the [first DM](first-conversation.md#ask-about-your-code) to check those together.

## Codex

Follow the [Codex CLI installation and sign-in guide](https://developers.openai.com/codex/cli/). In the same terminal used to launch Commonspace:

```bash
codex --version
codex login status
```

If needed, run `codex login`. Choose **Add Agent → Codex** and add the discovered agent. Commonspace connects through its bundled Codex ACP bridge and uses the CLI’s native account and session settings.

## Claude Code

Follow [Claude Code’s quickstart](https://code.claude.com/docs/en/quickstart), including authentication:

```bash
claude --version
claude auth status
```

Choose **Add Agent → Claude Code**. Commonspace uses its bundled ACP bridge. A Claude subagent definition is not a separate Commonspace identity.

## Hermes

Follow the [Hermes quickstart](https://hermes-agent.nousresearch.com/docs/quickstart), including a working provider and model:

```bash
hermes --version
hermes acp --check
hermes profile list
```

Choose **Add Agent → Hermes** and select an existing profile. To use another Hermes identity, create and configure its profile in Hermes first.

## Gemini CLI

Follow the [Gemini authentication guide](https://geminicli.com/docs/get-started/authentication/) and check `gemini --version`. Commonspace currently accepts stable versions **>=0.39.1 and <0.44.0**, with **0.43.0** tested. Newer versions are withheld because of native session reload regressions; installing the latest Gemini release will not necessarily work here.

Choose **Add Agent → Gemini CLI**. New and already-loaded sessions work. Continuing a saved session after a Commonspace restart or runtime replacement is blocked to avoid corrupting replies. Continue in Gemini CLI, or send `/new` to start fresh context. Your old conversation stays saved. See the [compatibility evidence](../adapters/agent-adapters.md#gemini-revalidation-evidence).

## OpenCode

Follow the [OpenCode setup guide](https://opencode.ai/docs/), including connecting a provider and choosing a model. Check `opencode --version`, then choose **Add Agent → OpenCode**. Commonspace uses native `opencode acp`; version **1.18.30** is covered by the runtime fixture.

## Runtime not found or no reply

- Run the version command in the terminal that starts Commonspace. Restart Commonspace after installing a CLI or changing `PATH`.
- If it is already added, open its DM from the sidebar. For a custom installation path, see [runtime configuration](../guides/operations.md#runtime-configuration).
- If discovery succeeds but a message fails, confirm that the native CLI itself can answer using the intended model. Fix native sign-in, permissions, or model access, then retry in Commonspace.
- A previous successful reply is evidence from that run, not a guarantee that credentials or service access still work today.

See [platform support](support.md) for OS coverage. Adapter authors should use the [implementation guide](../adapters/agent-adapters.md).
