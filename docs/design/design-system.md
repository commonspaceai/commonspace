# Commonspace design system

The design system gives Commonspace one consistent set of colors, typography, spacing, and components. Use it when building or changing the desktop UI. The [design contract](../../DESIGN.md) defines the intended appearance; this document explains how to implement it without creating competing styles.

## Ownership

| Location | Responsibility |
| --- | --- |
| [`ui/src/index.css`](../../ui/src/index.css) | Semantic theme variables, font roles, radius aliases, base styles, and reduced-motion behavior |
| [`ui/components.json`](../../ui/components.json) | shadcn configuration and component aliases |
| `ui/src/components/ui` | Shared UI primitives |
| `ui/src/design-system` | Shared product patterns: identity, headers, collection controls, delivery, and counters |
| `ui/src` | Product components and screen composition |
| `ui/src/stories` | Isolated component and screen states |

The [Visual verification guide](visual-verification.md) describes Storybook review. `SidebarSortControl` owns the compact collection-header sort menu. `RunDelivery` owns the shared DM/Thread follow-up tray and delivery buttons; it preserves native form submission values and the existing queue callbacks.

Use Tailwind CSS v4 and the existing shadcn primitives. Prefer an existing component for a repeated control or layout. Add a shared component when it has a clear reusable responsibility; avoid a new abstraction for one small styling change.

## Semantic tokens

Semantic tokens describe purpose instead of a fixed color. For example, `foreground` is readable content and `muted-foreground` is secondary content. Components should depend on those roles so that Light, Dark, and future palette changes remain consistent.

The stable aliases in `ui/src/index.css` connect Commonspace's needs to the theme:

| Token or alias | Purpose |
| --- | --- |
| `--font-display`, `--font-body`, `--font-code` | Heading, prose, and code typography |
| `--surface`, `--surface-raised` | Ordinary and raised content surfaces |
| `--radius-control`, `--radius-field`, `--radius-panel` | Component corner roles derived from the base radius |
| `--sidebar-deep` | Compatibility alias for the navigation surface |
| `--status-success`, `--status-warning`, `--status-danger` | Semantic status colors |
| `--control` | Shared control sizing |
| `--shadow-soft`, `--shadow-high` | Subtle and elevated shadows |
| `--motion-fast`, `--motion-base`, `--ease-standard` | Consistent transition timing and easing |

Do not hardcode a second palette in React components. Keep the stable aliases when updating theme variables, and use the radius roles in [DESIGN.md](../../DESIGN.md#shapes-and-elevation).

To apply a compatible theme, run the following from the repository root, replacing `<theme-url>` with its registry address:

```bash
pnpm --filter @commonspace/ui exec shadcn add "<theme-url>" --yes
```

Review the resulting diff, preserve the stable aliases, and inspect every affected component in Light and Dark modes. A theme update must not change screen structure or behavior.

## Shared controls

- `CommonspaceLogo` owns the monochrome identity: three uneven, flowing agent shapes form an open C, with two circular eye cutouts per shape. Preserve the organic silhouette and curved gaps. The SVG inherits text color; its eyes show the underlying surface. Use the same geometry for the browser icons and repository logo. The `Design System/CommonspaceLogo/Monochrome` story shows both polarities and sizes from 16px to 32px.
- `NativeSelect` owns compact native pickers, neutral borders, chevron spacing, disabled/error states, and keyboard focus. Pass native select props and children; keep labels at the call site. Folder pickers display the public folder label once, without adding a duplicate Working/Reference prefix.
- `Button` uses 36px by default, 28px for small actions, 32px for compact text filters, and 44px for large actions. Secondary buttons use neutral colors. Use `variant="tab"` for page views and `variant="filter"` for secondary collection filters, with `size="compact"` and `aria-pressed`.
- `AgentAvatar` owns configured emoji and background color, fallback initials, corner shape, and size across navigation, collections, conversations, activity, and profile editing. Render the chosen background color exactly. Callers may position it; do not override its shape, typography, or color. Runtime status is optional and must represent runtime state, never unread state.
- `CollectionToolbar` owns collection width, padding, alignment, and wrapping. Supply native labels, groups, and shared controls as children; keep filter state and behavior in the screen.
- `UnreadCount` owns quiet 18px-high navigation counters, tabular numerals, and the `99+` cap. The parent supplies the accessible unread label.
- `ConversationRetention` owns its dialog and the choose/review/delete lifecycle. The sidebar supplies conversations and the existing retention API; it does not own dialog form state.

Use the focus and density tokens rather than adding per-screen orange rings or large minimum heights. Strong status color belongs to errors and final destructive actions. Inspect `Foundations/UI Primitives`, `Pages/CommonspaceSidebar`, and `Pages/CommonspaceProjectFiles` in Storybook when changing these rules.

## Component index and adoption

Search this index and the existing source before adding a component. Extend the owning variant when the job is the same. Share a product pattern when at least two real callers need it; do not move an entire screen into a generic configurable component.

| Job | Canonical owner | Adoption / review entry |
| --- | --- | --- |
| Ordinary actions and collection filters | [`Button`](../../ui/src/components/ui/button.tsx) | Inbox and Threads toolbars, filters, and row actions; `Review/Component System` |
| Agent identity | [`AgentAvatar`](../../ui/src/design-system/AgentAvatar.tsx) | Sidebar, directory, Inbox, Threads, messages, activity, Project, and agent settings; dedicated identity stories |
| Collection control layout | [`CollectionToolbar`](../../ui/src/design-system/CollectionToolbar.tsx) | Inbox and Threads; `Review/Component System` |
| Workspace settings categories | [`WorkspaceSettingsLayout`](../../ui/src/design-system/WorkspaceSettingsLayout.tsx) | Six keyboard-accessible categories; drafts remain mounted across category changes |
| Theme selection | [`AppearanceSettings`](../../ui/src/design-system/AppearanceSettings.tsx) | Light, Dark, and System previews using native radio behavior |
| Channel thread filter | [`ChannelThreadFilter`](../../ui/src/design-system/ChannelThreadFilter.tsx) | Checked menu options; selection closes the menu |
| Page heading | [`WorkspaceHeader`](../../ui/src/design-system/WorkspaceHeader.tsx) | Workspace collections; dedicated header stories |
| Native picker | [`NativeSelect`](../../ui/src/components/ui/native-select.tsx) | Sorting and forms; `Foundations/UI Primitives` |
| Navigation unread count | [`UnreadCount`](../../ui/src/design-system/UnreadCount.tsx) | Sidebar; `Review/Component System` |
| Collection sort menu | [`SidebarSortControl`](../../ui/src/design-system/SidebarSortControl.tsx) | Sidebar; `Pages/CommonspaceSidebar` |
| Follow-up delivery | [`RunDelivery`](../../ui/src/design-system/RunDelivery.tsx) | DM and Thread composer trays; dedicated delivery stories |

This is an adoption map, not a claim that consolidation is complete. Complex clickable list rows remain native buttons with their own row layout. Sidebar navigation, settings forms, and directory tabs still include screen-owned controls; audit their semantics before migrating them. User and system-message identities are distinct from agent identities.

The review entry renders the production owners together and links to assembled fixture screens. It must not introduce a parallel set of demonstration-only controls. The [capture catalog](../../ui/src/stories/review-catalog.ts) declares representative screens and a review question for each. Add an affected screen or state when changing a shared owner, then follow the visual verification protocol. Passing stories demonstrate behavior; screenshots become accepted only after pixel inspection.

## Component behavior

The same visual treatment should mean the same thing across screens. Selected rows need a clear state, primary actions need clear labels, and secondary actions should remain discoverable without competing with conversation text.

| Surface | Design responsibility |
| --- | --- |
| Project pane | Show files and changes with clear location and selection. |
| Channel | Make membership and shared context easy to inspect. |
| Direct Message | Keep the chosen agent and conversation continuity clear. |
| Message | Distinguish authors and outcomes while keeping ordinary messages flat. |
| Agent activity | Present only harness-emitted activity, collapsed by default. |
| Thread | Keep the root, focused reply, and continuation understandable. |
| Composer | Keep active context visible and provide slash-command and reference suggestions. |

Conversation screens use three shared pattern owners: `NavigationSection`, `RoutingReceipt`, and `MessageComposer`.

Section titles navigate; separate chevrons collapse. Routing opens a single anchored popover with the stored decision, source, timing, assignments, and corrections; delivery history has no nested disclosure. A generic selection receipt is not a rationale. Preserve recovery actions and all stored history.

Root and Thread composers share native form/input framing without moving their submission state.

Use `Workspace/Conversation` as the connected design workspace. It renders the production app and client store against a disposable mock HTTP service. Shared component edits appear here and in the live app; reload resets the sample data. Focused component stories remain available for individual states.

The desktop shell uses the dimensions in [DESIGN.md](../../DESIGN.md#layout). Screen components should compose those shared rules rather than define alternate shell geometry.

## Reference-aligned workspace

The shell uses a monochrome SVG mark, one navigation group per collection, and the semantic charcoal/white surface hierarchy from the accepted design direction. Conversation text, collapsed details, and composers share the same rhythm. Keep the configured agent identity and render its chosen background color without tinting or remapping it.

`useThreadOverlay` measures available conversation width. Below 960px the Thread overlays the right side; otherwise it docks beside the channel with resizing available. Covered channel controls become inert, while the channel remains visually present. Closing or pressing Escape restores the channel composer; an open Thread context closes first. Review `Screens/Workspace/ThreadRightOverlay` and `ThreadDocked` for these behaviors.

### Interaction emphasis

`NavigationItem` owns the 36px navigation row and its quiet selected surface. Pointer hover changes navigation text; it must not resemble a second selection. Keyboard focus remains explicit. Collection rows use the weaker hover token to identify the clickable row. Messages themselves have no hover fill: hovering or focusing exposes the message menu, while the active thread source uses a narrow neutral location marker. Pin, edit, and delete live in that menu; reply remains directly available.

Use spacing and section headings for settings groups. Do not repeat a radio selection as a colored border plus a Selected label, or frame each passive project fact as a card. Repeated agent choices share one explanation above the list. Directory search, count, sort, and actions share one toolbar.

The visual direction is a conversation workspace: the authored work and the right-side reply pane establish the hierarchy. Use the platform system typeface for both content and controls, with 15px message text, 13–14px controls, and 12px supporting metadata. Align labels, content, and form fields to a common left edge. Dark roles use rail `#191a1c`, canvas `#202123`, selection `#292b30`, primary text `#ededf0`, secondary text `#abadb6`, and action blue `#78b5ff`; Light uses the corresponding semantic tokens. Surface differences identify navigation, work, and a foreground reply—not decorative cards.

Error notices occupy normal layout space: the workspace footer normally owns the notice, and open Workspace settings owns it below its header. An error must never cover a save or retry control. Use one focus outline rather than stacking a border, ring, and outline.

## Accessibility

Every component must support its intended keyboard interaction. Icon-only controls need accessible names, selected items need semantic state, and focus must remain visible. Pickers and suggestions use the appropriate listbox and option semantics. Errors and command outcomes use alert or status roles where appropriate.

Workspace settings leave the sidebar available while the shell marks the covered workspace inert. Focus enters the pane and returns when it closes. Queue changes move focus only when the action's control disappears or becomes disabled; a delayed response must not interrupt focus elsewhere. Search retry preserves inputs, returns focus to the query, and announces progress and result counts. Native browser controls use the resolved theme's `color-scheme`.

Respect `prefers-reduced-motion`. Use text, icons, and semantic state alongside color so that color is never the only way to understand an outcome. Check accessibility in Storybook and the integrated desktop flow.

## Changing the system

1. Use [Storybook MCP](visual-verification.md#storybook-mcp-workflow) to discover existing components and stories. Identify whether the change belongs to a token, shared primitive, product component, or screen.
2. Update the smallest owner and preserve existing behavior.
3. Add or update the Storybook states that demonstrate the change, including affected empty, loading, error, and selected states.
4. Inspect the running canvas through hot reload at 1440 × 960, including hover, focus, and Light/Dark states. Run a focused interaction check when the behavior is settled.
5. When the change is ready for integration, run the appropriate [development checks](../guides/development.md#verification-commands) and complete the [visual review](visual-verification.md).

Keep [DESIGN.md](../../DESIGN.md) current when changing a visual requirement. Product documentation should explain what users can do; token names and implementation details belong here.
