/** Production stories to inspect after changing shared component owners. */
export const uiReviewCatalog = [
	{
		id: "review-component-system--shared-patterns",
		name: "Shared component patterns",
		ready: '[aria-label="Component review"]',
		question:
			"Do the same controls, identities, and selected states look related?",
	},
	{
		id: "screens-workspace--inbox-attention",
		name: "Inbox attention",
		ready: 'main[aria-label="Inbox"]',
		question: "Does attention stand out without changing agent identity?",
	},
	{
		id: "screens-workspace--dense-inbox-activity",
		name: "Dense Inbox",
		ready: 'button[aria-pressed="true"]:has-text("Activity")',
		question:
			"Can names, previews, and outcomes be scanned without competing badges?",
	},
	{
		id: "screens-workspace--dense-threads",
		name: "Dense Threads",
		ready: 'fieldset[aria-label="Thread filter"]',
		question:
			"Do shared filters, agent marks, and unread indicators stay consistent with Inbox?",
	},
	{
		id: "pages-commonspaceinbox--sessions",
		name: "Inbox sessions",
		ready: 'button[aria-pressed="true"]:has-text("Sessions")',
		question:
			"Are identity, session status, and follow controls distinct and readable?",
	},
	{
		id: "pages-commonspacecontextsettings--agent-settings",
		name: "Agent profile",
		ready: 'aside[aria-label="Agent profile"]',
		question:
			"Does the editable profile preview match the agent mark elsewhere?",
	},
	{
		id: "screens-workspace--thread-conversation",
		name: "Conversation with thread",
		ready: ".commonspace-thread-panel",
		question:
			"Does the thread stay on the right with enough room for both composers?",
	},
	{
		id: "screens-workspace--direct-message-runtime",
		name: "Permission and queued follow-ups",
		ready: 'button:has-text("Allow once")',
		question:
			"Are permission, current work, and queued messages distinguishable?",
	},
	{
		id: "screens-workspace--project-files",
		name: "Project files",
		ready: 'text="Select a file to preview"',
		question: "Is file location clear without unnecessary header layers?",
	},
	{
		id: "screens-workspace--workspace-settings",
		name: "Workspace settings",
		ready: 'button[aria-label="Close settings"]',
		question:
			"Do settings share the same typography, controls, and grouping as the workspace?",
	},
	{
		id: "screens-workspace--agents-directory",
		name: "Agent directory",
		ready: 'input[aria-label="Filter agents"]',
		question:
			"Are agent identities consistent with navigation and conversations?",
	},
	{
		id: "screens-workspace--global-search-failure",
		name: "Search failure",
		ready: 'button:has-text("Try again")',
		question: "Does failure preserve the query and make recovery obvious?",
	},
	{
		id: "screens-workspace--loading-workspace",
		name: "Workspace loading",
		ready: 'text="Opening workspace"',
		question: "Is loading distinct from an empty or failed workspace?",
	},
	{
		id: "shell-workspace--connection-failed",
		name: "Workspace unavailable",
		ready: 'button:has-text("Try again")',
		question: "Can the user understand the failure and recover?",
	},
	{
		id: "screens-workspace--projects-directory",
		name: "Projects directory",
		ready: 'input[aria-label="Filter projects"]',
		question: "Are project folders readable and consistent with navigation?",
	},
	{
		id: "screens-workspace--channels-directory",
		name: "Channels directory",
		ready: 'input[aria-label="Filter channels"]',
		question: "Are membership and unread state clear?",
	},
	{
		id: "screens-workspace--project-changes",
		name: "Project changes",
		ready: '[aria-label="Project views"]',
		question:
			"Can changes be selected and the diff read without redundant chrome?",
	},
	{
		id: "screens-workspace--project-conversations",
		name: "Project conversations",
		ready: '[aria-labelledby="project-conversations-heading"]',
		question:
			"Are conversations identifiable without repeating the project title?",
	},
	{
		id: "screens-workspace--project-settings",
		name: "Project settings",
		ready: 'aside[aria-label="Project settings"]',
		question: "Are folder context and destructive actions grouped clearly?",
	},
	{
		id: "screens-workspace--channel-conversation",
		name: "Channel conversation",
		ready: '[aria-label="Channel thread view"]',
		question: "Does content dominate while thread filters remain discoverable?",
	},
	{
		id: "screens-workspace--thread-context-open",
		name: "Thread context",
		ready: '[aria-label="Thread context"]',
		question: "Are context fields and replies independently readable?",
	},
	{
		id: "screens-workspace--settings-intelligence",
		name: "Intelligence settings",
		ready: '[role="tab"][aria-selected="true"]:has-text("Intelligence")',
		question:
			"Are saved state, draft edits, and connection requirements distinguishable?",
	},
	{
		id: "screens-workspace--settings-agent-runs",
		name: "Agent run settings",
		ready: '[role="tab"][aria-selected="true"]:has-text("Agent runs")',
		question: "Are native defaults and overrides clear?",
	},
	{
		id: "screens-workspace--settings-notifications",
		name: "Notification settings",
		ready: '[role="tab"][aria-selected="true"]:has-text("Notifications")',
		question: "Are enabled state, saving, and test delivery clear?",
	},
	{
		id: "screens-workspace--settings-diagnostics",
		name: "Runtime diagnostics",
		ready: '[role="tab"][aria-selected="true"]:has-text("Diagnostics")',
		question: "Does recorded status avoid implying live connectivity?",
	},
	{
		id: "screens-workspace--settings-data",
		name: "Workspace data",
		ready: '[role="tab"][aria-selected="true"]:has-text("Data")',
		question: "Are export, import, and deletion clearly separated?",
	},
	{
		id: "screens-workspace--global-search",
		name: "Global search",
		ready: '[role="dialog"]',
		question: "Can results be scanned and selected with a keyboard?",
	},
	{
		id: "screens-workspace--add-project",
		name: "Add project",
		ready: '[role="dialog"]',
		question: "Are required fields and the primary action clear?",
	},
	{
		id: "screens-workspace--add-channel",
		name: "Add channel",
		ready: '[role="dialog"]',
		question: "Can members be chosen without losing the form actions?",
	},
	{
		id: "screens-workspace--add-agent",
		name: "Add agent",
		ready: '[role="dialog"]',
		question: "Is harness choice distinct from agent profile configuration?",
	},
];
