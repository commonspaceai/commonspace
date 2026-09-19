# Using the desktop workspace

New here? Follow [your first conversation](../start/first-conversation.md). Commonspace opens to Inbox at `/`. Use the sidebar to open Channels, agent DMs, Projects, and Threads. The URL records the selected destination; browser Back, Forward, and reloading a detail link return to that location. Workspace branding does not navigate. Unknown or stale links return to Inbox, including when a selected destination disappears during a live refresh.

## Find and return to work

Inbox collects replies, mentions, permission requests, possible input requests, and failures. Its unread state is independent of OS notifications. Open an item to reach the originating conversation and exact message. A reply opens in its Thread while the Channel root remains the navigation anchor.

The Threads view collects focused Channel conversations. Projects provide file and change previews alongside conversation context. Collection heading menus sort Projects, Channels, and Agents; Custom ordering keeps pinned and unpinned groups separate. These preferences belong to the current browser.

Open global search with the top-bar button or **Command+K / Control+K**. Type a query, combine result types, or choose a Project filter. Projects also appear as direct destinations by name; matching replies open the exact message in its Thread or DM. A Project filter matches any Project referenced by the result. Use **Clear filters** to keep the query while removing restrictions. **Up/Down** selects a result, **Enter** opens it, and **Escape** closes search and restores the previous focus. Only results scroll; the query, filters, count, and keyboard hints remain available. A failed search offers **Try again** with the query and filters intact. While a request is pending, its old results cannot be opened.

## Send and follow up

Use `@agent` to address an agent and `@@project` to choose Project context explicitly. Without an agent mention, a Channel uses the selected workspace inference Agent. A DM always stays with its chosen agent. **Enter** sends, **Shift+Enter** adds a line, and suggestions support arrow keys and Tab. `/new` in a DM starts fresh context with a visible boundary; ordinary follow-ups continue the mapped native session.

The Sending tray shows messages awaiting admission and offers **Restore** after failure, retaining the draft and attachments. Once admitted, an active session's follow-ups appear in **Up next**. Expand a preview to inspect its full text, move messages earlier or later, or remove them. Removing the final queued message returns keyboard focus to the composer; reordering or removing other entries preserves a usable focus target.

In an active DM, **Queue** waits for the current run and **Interrupt and send** stops it before sending the next message. **Stop current run** retains queued follow-ups. Thread composers offer Queue; individual active agent activity provides scoped stop controls. Live steering and a Thread-wide interrupt-and-send action are unavailable in the current assembled UI. Unsupported actions are omitted. Independent native sessions continue concurrently.

A routing receipt identifies destination agents, selection source, and delivery outcome. Expand it for stored assignments, Project references, reasons, timing, and correction history. Failed routing offers retry or manual selection of a Channel member without duplicating the accepted message. Correcting an already resolved assignment remains a service/API operation; inline reroute editing is deferred.

## Settings and appearance

Open Workspace settings from the sidebar. Focus enters the settings pane and covered conversation controls leave the keyboard path. The sidebar remains available for navigation. **Escape** or **Close settings** returns to the conversation; closing an overlay such as search first leaves settings open. Navigating to another destination also closes settings.

Choose **Light**, **Dark**, or **System** under Appearance. Light is the default. The choice applies immediately and persists in this browser. System follows operating-system changes while the app is open; native form controls and scrollbars use the resolved appearance too. Reduced-motion preferences suppress interface animations and smooth scrolling.

Inference settings select one added Agent for routing and shared-context compaction. Agent run defaults have their own save action. Configuration status does not test model access; an actual reply establishes access for that request. DMs and explicitly addressed Channel requests bypass automatic routing. Notification preferences have a separate save action. Changing appearance needs no save. A failed save keeps the selection available for correction or retry. Channel and agent settings are available from their headers or action menus; Project settings are available from the Project view. Native capability browsing is read-only and identifies unavailable inspection separately from an empty inventory.

## Recovery and limits

Startup distinguishes loading from an empty workspace and offers retry if the service cannot be reached. A refresh failure preserves loaded content and displays an actionable error. Commonspace must be running locally for new requests and updates; closing the browser does not stop an accepted agent turn.

Desktop browsers are the current target. Mobile layouts, a desktop wrapper, generic plugins, and additional Project resource types remain deferred. Runtime and operating-system support is defined by the [support matrix](../start/support.md), not by a successful browser fixture test. See [Operations](operations.md) for local service recovery and [the product specification](../specs/product-spec.md) for the complete contract.
