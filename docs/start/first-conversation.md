# Your first useful conversation

Start with [installation](install.md) and one [signed-in runtime](runtimes.md). Use a repository you know so you can check the answer.

## Ask about your code

1. Choose **Add Agent**, pick your runtime, then add the discovered identity. Leave Full access off to keep native permission prompts.
2. Choose that added agent as the workspace inference agent. It handles routing and shared-context compaction through the same harness sign-in.
3. Choose **Add Project**, name it, and select its local repository folder.
4. Open the agent’s DM. Type `@@` and select the Project from the suggestions. Keep the visible Project reference in your message.
5. Send: **Explain this repository’s entry points and how to run it. Don’t change any files.**
6. Check the reply against your code. Follow up: **Which file should I read first, and why?**

A successful reply confirms this agent could run with its current account and model. Installation alone does not. Approve only the native permission requests needed for your task. If the turn fails, fix the cause shown in the conversation and use its retry action; your accepted request stays saved.

Ordinary follow-ups continue the exact native session. Use `/new` only when you want fresh context. Gemini has [restart limitations](runtimes.md#gemini-cli).

## Work with two agents

1. Add a second configured runtime or a second existing Hermes profile. Commonspace uses native identities; it does not create extra personas for a single CLI identity.
2. Create a **Channel**, such as `code-review`, and add both agents as members. Use distinct workspace names in agent settings, such as “Implementation” and “Review,” so you can tell them apart.
3. First address a member explicitly: type `@`, select that agent, add your `@@` Project reference, and ask: **Explain this repository’s test setup. Don’t change files.** An explicit single-agent request needs no automatic routing setup.
4. To let Commonspace select agents, open **Workspace settings** and choose an added agent for inference. Configuration status does not establish login or model access; the routed request below checks that in practice.
5. Add your `@@` Project reference, then send without an `@agent` mention: **Review the architecture and test coverage of this Project. Identify the three most useful improvements. Don’t change files.**

Open the resulting Thread and its routing receipt to see which agents received the request and whether delivery succeeded. Each chosen agent receives your original message. Replies and follow-ups stay with that Thread. Automatic routing can choose one agent when the work only needs one.

For a discussion with a clear order, try: **Have Implementation propose a testing improvement, then have Review review the proposal. Keep this to one pass and don’t change files.** Use your agents’ actual workspace names.

If automatic routing fails, the original message remains saved. Use its retry action after fixing inference settings, or select a Channel member manually. A successful DM establishes that agent’s normal access; it does not prove that a separate inference turn returns valid routing output.

## Prompts to reuse

Add the relevant `@@` Project reference to each prompt.

- **Understand:** “Map the main modules and show where a request enters the app. Don’t change files.”
- **Diagnose:** “Reproduce this error, explain its cause, and propose the smallest fix before editing: [error].”
- **Review:** “Review the current diff for behavior regressions. Give file references and reproduction steps.”
- **Plan:** “Suggest three small improvements to onboarding. Order them by user impact and explain how to verify each.”

Use [Inbox and search](../guides/desktop-usage.md#find-and-return-to-work) to return to replies, requests, and failures. [Help](help.md) covers common setup problems.
