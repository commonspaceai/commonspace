# Commonspace design system

The design system gives Commonspace one consistent set of colors, typography, spacing, and components. Use it when building or changing the desktop UI. The [design contract](../../DESIGN.md) defines the intended appearance; this document explains how to implement it without creating competing styles.

## Ownership

| Location | Responsibility |
| --- | --- |
| [`ui/src/index.css`](../../ui/src/index.css) | Semantic theme variables, font roles, radius aliases, base styles, and reduced-motion behavior |
| [`ui/components.json`](../../ui/components.json) | shadcn configuration and component aliases |
| `ui/src/components/ui` | Shared UI primitives |
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
| `--sidebar-deep` | Additional sidebar depth within the same palette |
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
- `Button` uses 36px by default, 28px for small actions, and 44px for large actions. Secondary buttons use neutral colors.
- `UnreadCount` owns quiet 18px-high navigation counters, tabular numerals, and the `99+` cap. The parent supplies the accessible unread label.
- `ConversationRetention` owns its dialog and the choose/review/delete lifecycle. The sidebar supplies conversations and the existing retention API; it does not own dialog form state.

Use the focus and density tokens rather than adding per-screen orange rings or large minimum heights. Strong status color belongs to errors and final destructive actions. Inspect `Foundations/UI Primitives`, `Pages/CommonspaceSidebar`, and `Pages/CommonspaceProjectFiles` in Storybook when changing these rules.

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

The desktop shell uses the dimensions in [DESIGN.md](../../DESIGN.md#layout). Screen components should compose those shared rules rather than define alternate shell geometry.

## Accessibility

Every component must support its intended keyboard interaction. Icon-only controls need accessible names, selected items need semantic state, and focus must remain visible. Pickers and suggestions use the appropriate listbox and option semantics. Errors and command outcomes use alert or status roles where appropriate.

Workspace settings leave the sidebar available while the shell marks the covered workspace inert. Focus enters the pane and returns when it closes. Queue changes move focus only when the action's control disappears or becomes disabled; a delayed response must not interrupt focus elsewhere. Search retry preserves inputs, returns focus to the query, and announces progress and result counts. Native browser controls use the resolved theme's `color-scheme`.

Respect `prefers-reduced-motion`. Use text, icons, and semantic state alongside color so that color is never the only way to understand an outcome. Check accessibility in Storybook and the integrated desktop flow.

## Changing the system

1. Identify whether the change belongs to a token, shared primitive, product component, or screen.
2. Update the smallest owner and preserve existing behavior.
3. Add or update the Storybook states that demonstrate the change, including affected empty, loading, error, and selected states.
4. Inspect the rendered result in Light and Dark modes.
5. Run the appropriate [development checks](../guides/development.md#verification-commands) and complete the [visual review](visual-verification.md).

Keep [DESIGN.md](../../DESIGN.md) current when changing a visual requirement. Product documentation should explain what users can do; token names and implementation details belong here.
