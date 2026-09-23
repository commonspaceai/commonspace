# Using the desktop workspace

New here? Follow [your first conversation](../start/first-conversation.md) to finish setup and get a reply. After setup, Commonspace opens to **Inbox** at `/`. Use this guide to find work, send follow-ups, and change workspace settings.

## Find and return to work

Use the sidebar to open Channels, agent DMs, Projects, and Threads.

| Destination | Use it to |
| --- | --- |
| **Inbox** | Return to replies, mentions, permission requests, possible input requests, and failures. An item opens its conversation at the exact message. Inbox unread state is separate from OS notifications. |
| **Channels** | Work with a group of agents. Replies open in a Thread, with the Channel kept as the navigation anchor. |
| **Direct Messages** | Continue a conversation with one chosen agent. |
| **Threads** | Find focused conversations from your Channels. |
| **Projects** | View local files and Git changes alongside conversation context. |

Collection heading menus sort Projects, Channels, and Agents. **Custom** ordering keeps pinned and unpinned groups separate. These preferences are saved in the current browser.

The URL records your selected destination. Browser **Back**, **Forward**, and reloading a detail link return to that location. Unknown or stale links return to Inbox, including when a destination disappears during a refresh. Clicking workspace branding does not navigate.

### Search

1. Open global search with the top-bar button or **Command+K / Control+K**.
2. Type a query. Narrow it with result types or a Project filter; you can combine filters.
3. Select a result to open it. Projects match by name, and replies open at the exact message in their Thread or DM.

A Project filter matches any Project referenced by a result. **Clear filters** removes restrictions and keeps your query.

| Key | Action |
| --- | --- |
| **Up / Down** | Select a result. |
| **Enter** | Open the selected result. |
| **Escape** | Close search and return focus to where you opened it. |

Only the results scroll, so the query, filters, count, and keyboard hints stay available. While search is loading, old results cannot be opened. If search fails, **Try again** keeps your query and filters.

## Send and follow up

Choose the conversation and context before sending:

- **DM:** always sends to that DM's agent.
- **Channel with one `@agent` mention:** sends directly to the selected agent.
- **Channel with several `@agent` mentions:** keeps those recipients. Routing decides whether they work in parallel or pass replies along in order.
- **Channel without an agent mention:** uses automatic routing to select agents. The local classifier handles supported decisions when confident; the workspace inference agent handles the rest.
- **`@@project` reference:** explicitly selects Project context. Keep the visible reference in your message.

**Enter** sends and **Shift+Enter** adds a line. Use arrow keys and **Tab** to choose mention suggestions. Ordinary follow-ups continue the mapped native session. Send `/new` in a DM when you want fresh context; the conversation shows a visible boundary.

### Send while an agent is working

| Control | What happens |
| --- | --- |
| **Queue** | Waits for the current run before sending the follow-up. Available in active DMs and Thread composers. |
| **Interrupt and send** | Stops the active DM run, then sends the next message. |
| **Stop current run** | Stops that run and retains queued follow-ups. Threads provide stop controls in each active agent's activity. |

Independent native sessions can run concurrently. Live steering and a Thread-wide **Interrupt and send** action are unavailable in the current UI; unsupported controls are omitted.

The **Sending** tray holds messages Commonspace has not yet accepted. If sending fails, use **Restore** to recover the draft and attachments. Once accepted, follow-ups waiting on an active session appear in **Up next**. Expand an entry to read it, move it earlier or later, or remove it. Removing the last queued message returns keyboard focus to the composer; other queue changes keep a usable focus target.

### Inspect or correct routing

Open a message's routing receipt to see the destination agents, how they were selected, and the delivery outcome. Expanded details include assignments, Project references, reasons, timing, and correction history.

- **Routing failed:** retry or select a Channel member manually. The accepted message stays saved and is not duplicated.
- **Wrong recipient:** expand **Wrong recipient?**, choose another Channel member, and select **Reroute and remember**. It sends the original message with the same Projects and uses the correction to guide later routing in that Channel.
- **The chosen agent already received the message:** the action becomes **Remember correction**, which saves the feedback without sending it again.

Recipient correction is available after routing has selected recipients, when the Channel has at least two agents. It preserves the original request and previous delivery history.

## Settings and appearance

Open **Workspace settings** from the sidebar. The sidebar stays available while you work in settings. **Close settings** or **Escape** returns to the conversation; if an overlay such as search is open, Escape closes that first. Navigating to another destination also closes settings. Keyboard focus enters the settings pane, and Tab skips conversation controls hidden behind it.

### What each setting controls

| Setting | Purpose and saving behavior |
| --- | --- |
| **Inference** | Selects one added agent for routing and shared-context summaries. Workspace setup requires this selection; DMs and single-agent Channel mentions bypass automatic routing. Configuration status confirms setup, not model access. |
| **Agent run defaults** | Sets defaults for agent runs and has its own save action. |
| **Notifications** | Controls notification preferences and has a separate save action. |
| **Appearance** | Choose **Light**, **Dark**, or **System**. Changes apply immediately and are saved in this browser without a save action. |

A failed save keeps your selection available for correction or retry. An actual agent reply establishes model access for that request.

Light is the default appearance. System follows operating-system changes while the app is open, including native controls and scrollbars. Reduced-motion preferences suppress interface animations and smooth scrolling.

Open Channel and agent settings from their headers or action menus. Open Project settings from the Project view. Native capability browsing is read-only; it distinguishes an unavailable inspection from an empty inventory.

## Recovery and limits

If startup cannot reach the service, check that Commonspace is running locally, then use **Retry**. A failed refresh keeps already loaded content visible and shows an actionable error. New requests and updates require the local server; closing the browser does not stop an accepted agent turn.

Desktop browsers are the current target. Mobile layouts, a desktop wrapper, generic plugins, and additional Project resource types remain deferred. Use the [support matrix](../start/support.md) for runtime and operating-system coverage, [Operations](operations.md) for local service recovery, and the [product specification](../specs/product-spec.md) for the complete behavior contract.
