# Commonspace design

Commonspace is a desktop workspace for conversations with local agents. Its design should help people find the right conversation, understand the available context, and follow work without losing their place.

This document defines visual requirements and product-surface rules. [Design system](docs/design/design-system.md) describes implementation, [Visual verification](docs/design/visual-verification.md) explains review, and the [Product specification](docs/specs/product-spec.md) defines behavior.

## Layout

The desktop shell has a stable navigation rail and a flexible working area. Use these dimensions when changing its composition:

| Element | Dimension | Purpose |
| --- | --- | --- |
| Title bar | 64px high | Keep workspace identity and global controls in one predictable place. |
| Navigation rail | 260px; 200px at compact desktop widths | Keep destinations and their state easy to scan. |
| Working area | Flexible width | Give conversations and Project content the remaining space. |
| Pane header | 72px high | Align the title, context, and actions across panes. |
| Pane divider | 8px wide | Separate adjacent panes and provide a usable resize area where resizing is supported. |

Use visible borders, compact rows, and consistent alignment to establish hierarchy. Projects, Channels, Agents, Inbox, Threads, conversations, and Project workbenches are working surfaces within this shell.

Desktop is the current product target. Do not add mobile layouts or mobile acceptance requirements as part of a desktop design change.

## Page composition

Use one 72px page header, followed by a 56px view toolbar when needed. Shared headers, toolbars, and collection lists use a 32px desktop inset. View navigation uses a quiet underline; secondary filters use neutral selection. Use ordinary sans-serif for dates and metadata, reserving monospace for code, paths, and commands.

Inbox and Thread rows show identity or subject, time, a readable preview, and one metadata line. Avoid repeating the destination or showing negative state such as “not followed” on every row. Empty filtered lists offer a reset; an empty directory offers creation; a caught-up Inbox offers Activity when replies exist.

Workspace settings has six categories: Appearance, Intelligence, Agent runs, Notifications, Diagnostics, and Data. Keep category selection visible, preserve unsaved fields across category switches, and keep each configuration's existing save boundary. Appearance choices include visual previews. Do not combine routing configuration with execution defaults or native notification preferences.

Project views use one compact tab row. Files and Changes share a 280px browser and a flexible detail pane with neutral surfaces. Keep file read-only status in file context rather than across unrelated conversation views. Project conversations use the same flat row language as other collections.

Channel thread filters live in a labeled menu with checked selections and counts. Choosing a filter closes the menu. The active filter stays visible in the trigger. Thread context uses the same field spacing as other settings; it must not collide with reply controls.

## Navigation and orientation

With no saved destination, Commonspace opens to Inbox. Workspace branding is an identity mark and does not navigate. There is no separate Workspace landing page or Agent-runs dashboard.

Each surface should answer three questions: where am I, what is selected, and what can I do next? Keep titles and selection visible. Preserve the user's conversation position when opening a Thread, attachment, context panel, or Project file.

Threads stay on the right. Use side-by-side panes when both have usable width; otherwise open the Thread over the right side of the conversation. Do not stack the Thread below the conversation. Check this transition separately from ordinary desktop screenshots.

Workspace settings move focus into their pane and remove the covered workspace from keyboard and accessibility navigation while keeping the sidebar available. Closing settings restores focus; Escape closes the nearest active overlay first. [Using the desktop workspace](docs/guides/desktop-usage.md) documents the user flow.

Runtime outcomes belong to Inbox and the conversation or Thread that produced them. Avoid a second surface that repeats the same outcomes without helping the user act.

## Collections and context

Projects, Channels, Agents, Inbox, and Threads use clear titles, compact rows, and visible selection. Do not show collection totals in the navigation rail. Show Channels, Agents, and Projects once each, in that order. Keep pinned items first without separate pinned/unpinned headings. Unread counts use a small neutral counter in a consistent right-hand column; unread Channel names use semibold text. Red is reserved for errors and destructive actions, not ordinary unread activity.

Projects, Channels, and Agents expose sorting through a compact heading menu with checked choices. Custom order preserves identity, status, pinned/unpinned grouping, drag behavior, and keyboard focus.

Project files and Git changes provide context for conversation. Channel and Thread context remains inspectable without exposing native session identifiers or absolute host paths. Use visible `@@project` references in composers; do not add separate Project-scope pickers for roots, Threads, branches, or reroutes.

## Color and appearance

The active palette lives in [`ui/src/index.css`](ui/src/index.css). Components use semantic tokens: names such as `background`, `foreground`, `border`, and `muted` describe a color's purpose. This allows the palette to change without rewriting components.

Use charcoal surfaces in Dark mode: a darker navigation rail, a distinct conversation canvas, and a slightly raised Thread surface. Light mode uses the equivalent white and pale gray hierarchy. Blue is the restrained accent for links, focus, and actions. Use neutral surfaces for ordinary content and selection. Reserve stronger color for identity, links, keyboard focus, and meaningful status. An error must also have readable text or an icon; color alone cannot explain it.

Commonspace starts in Light mode when no preference exists. Users can choose Light, Dark, or System. System follows the operating system, and the choice persists locally. Check every changed surface in both Light and Dark modes.

## Typography and spacing

Use the owned display, body, and code font roles in `ui/src/index.css`. The current body baseline is 15px with a line height of approximately 1.47. Titles, message text, metadata, and code should remain distinct through hierarchy and spacing.

Use the existing spacing scale and shared components. Keep navigation compact enough to scan and conversation text open enough to read. Align related labels, timestamps, icons, and controls. Let content length determine whether a row needs more room; do not clip important text to preserve a decorative shape.

## Shapes and elevation

Choose corner radii by component role:

| Utility | Role |
| --- | --- |
| `rounded-sm` | Compact toolbar actions and small inline status surfaces |
| `rounded-md` | Ordinary buttons, fields, menus, and small content groups |
| `rounded-lg` / `rounded-xl` | Navigation selection, composers, theme previews, and dialogs |
| `rounded-full` | Status dots and compact pill badges |
| `rounded-none` | Full-width strips, line tabs, and table-like separators |

Larger radii need a component-specific reason. Use borders and surface contrast for ordinary separation. Reserve elevation for overlays that need to stand above their surroundings.

Agent identities use the same softly squared mark in navigation, lists, messages, activity, and settings. Size may change with context; shape, configured emoji, background color, and lettering must remain consistent. Render the configured background color exactly as selected instead of tinting or remapping it. Keep default identity colors restrained. Keep ordinary unread indicators neutral and separate from runtime status.

## Conversations and message focus

Ordinary messages remain visually flat. Authorship, text rhythm, and timestamps should explain the conversation without enclosing every message in a card.

A selected or deep-linked message keeps a quiet highlight card using a neutral surface, border, or ring. Do not use an orange rail, orange border, or orange tint for this treatment. When opening a reply, focus that exact reply in the Thread pane while keeping its Channel root as the navigation anchor.

Agent activity begins collapsed beneath its reply. When expanded, it presents the reasoning summaries, plans, tool calls, and usage that the harness actually emitted. The composer keeps the current context visible and makes slash commands and references discoverable.

Render activity and evidence as quiet disclosure rows without surrounding cards. Replies are the primary action beneath a channel message, on their own row with the replying agents’ avatars. Keep routing in a separate, secondary row; do not flatten replies into routing metadata.

Completed outcomes stay in the routing popover; queued, running, cancelled, and failed outcomes remain visible. Open one anchored popover containing the stored decision, selection source, timing, assignments, Project references, and correction history. Do not nest delivery details under another disclosure or invent a rationale from a generic router selection.

Failed routing exposes retry and manual agent selection. Compact resolved receipts show destination Agent marks instead of long names; the full names remain in the accessible label and popover. Resolved assignments offer **Wrong recipient? → Reroute and remember** with multiple replacement Agent choices, preserving the original request and Project scope. General inline editing of assignments remains deferred.

Thread context is an explicit view within the right-hand pane, with a return to replies. Keep reply drafts mounted while context is open.

Navigation section titles open their directories regardless of roster size; a separate chevron controls collapse. Conversation and Thread composers share their form and input framing while submission state stays in the conversation owner.

Queued follow-ups sit in a compact tray aligned with the composer. Keep previews and delivery status distinct, allow long previews to expand, and keep the composer usable. Reorder and removal controls need accessible names and consistent placement.

After a queue action removes or disables the focused control, move focus to a remaining preview, or to the composer when the queue becomes empty. Do not steal focus after a delayed update if the user has moved elsewhere. Omit unsupported runtime controls.

Before workspace data arrives, show loading. Initial connection failure shows an actionable retry. Refreshing loaded data preserves visible content while reporting errors.

## Search

Search keeps its query, filters, result count, and keyboard hints fixed. Only results scroll. Type and Project filters show checked choices and removable selections; clearing filters preserves the query. Pending requests hide stale results, and late responses cannot replace the active search.

A search error offers retry without clearing the query or filters. Search progress and result counts are announced, and retry returns focus to the query.

## Controls and states

Ordinary desktop fields and buttons are 36px high, with 13–14px text, a thin neutral border, and 4px corners. Use 28px controls for dense toolbars, 32px text filters, and 44px only for deliberately prominent actions. Selects reserve space for a 14px chevron, inset 12px from the edge; display the selected value once. Use a 2px theme focus outline for keyboard navigation, never a permanent accent outline.

Destructive settings begin as a quiet description and secondary action. Conversation-history deletion opens a dialog with a picker, exact impact preview, and a clearly named final destructive action. Selection changes invalidate the preview; pending requests disable selection and submission; failures require a fresh preview.

Controls must look interactive before they are clicked. Related filters should read as one group, with a clear selected state. Menus and suggestions should stay near their trigger, remain within the viewport, and close predictably.

Design the empty, loading, error, and dense states alongside the normal state. Explain what happened and provide an appropriate next action. Do not show implementation details such as CSS names, internal identifiers, or token terminology in product copy.

Every icon-only control needs an accessible name. Keyboard focus must remain visible, selection must have semantic state, and motion must respect `prefers-reduced-motion`.

## Review

Use [Visual verification](docs/design/visual-verification.md) for browser, Storybook, interaction, and pixel acceptance. The design contract remains the standard for the rendered result.
