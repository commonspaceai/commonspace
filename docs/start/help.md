# Help and common questions

## Is Commonspace free?

Commonspace is open source under the MIT license. Agent subscriptions and model calls have their own pricing. Installing Commonspace does not include model access or credits.

## Can I use my existing agent subscription?

Authenticate in your native runtime. Commonspace uses that runtime’s existing account and configuration; eligible models and subscription access depend on the runtime and provider. The selected workspace inference agent uses the same harness sign-in for routing and shared-context compaction.

## What stays on my computer?

The server, workspace history, Projects, and native session references live locally. Agents can send prompts and context to model services through their native runtimes. “Local-first” does not mean all model processing is offline. The selected inference agent receives bounded message text, Agent and Project labels, shared context, and routing corrections through its harness.

## Which files can an agent access?

A Project selects local folders used for work. Add it with `@@` in your message so the context is explicit. Native tools, sandbox settings, and permission choices govern file and command access. A Project reference is not a security sandbox. Leave Full access off when you want the native permission prompts.

## The page will not open

Run `npx --yes commonspace@latest` and leave that terminal open. Use the address printed there, normally `http://127.0.0.1:3100`. If the port is occupied, stop the old Commonspace process or select another `COMMONSPACE_PORT`. Do not run two servers against the same data directory.

## My agent was found but cannot answer

Discovery is an installation check. Follow the [runtime setup steps](runtimes.md), confirm a native CLI conversation works, then retry the saved request. Check Inbox for permission requests or errors. A DM avoids automatic routing, so it is the simplest place to establish agent access.

## DMs work but Channel routing fails

Open Workspace settings and choose one of the added agents as the inference agent. Confirm that agent can answer through its native runtime, then retry. Configuration status does not prove model access; an actual routed Channel reply does. Use manual member selection on the failed request while repairing the harness.

## How do I restart without losing work?

Let active work finish, stop the terminal process with Ctrl+C, and [run Commonspace again](install.md#reopen-and-update) using the same data directory. Reopening a conversation continues its exact native session where supported. `/new` deliberately starts fresh context. Gemini currently blocks reload after restart; see [Gemini limits](runtimes.md#gemini-cli).

## Where do I report a problem?

[File a bug](https://github.com/commonspaceai/commonspace/issues/new?template=bug_report.yml) with the version, OS, Node version, expected behavior, and steps to reproduce. Remove credentials, private paths, transcripts, and session IDs. Report security issues through the [security policy](../../SECURITY.md).

For deeper troubleshooting, use [Operations](../guides/operations.md). To change Commonspace itself, start with [Contributing](../../CONTRIBUTING.md).
