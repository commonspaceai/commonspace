import type { AiRouteInput, AiRouteResult } from "../server/src/ai-router.ts";

export interface ClassifierEvaluationCase {
	input: AiRouteInput;
	// Null requires abstention; a concrete route is the only safe accepted result.
	expected: Pick<AiRouteResult, "mode" | "assignments"> | null;
	// Supported local paths must not silently fall back to the inference harness.
	requiredLocal?: boolean;
}

const rosters: Record<string, AiRouteInput["candidates"]> = {
	standard: [
		{
			id: "frontend",
			displayName: "Frontend",
			description: "frontend development",
			adapter: "codex",
			routingScore: 0,
			matchedTerms: [],
		},
		{
			id: "backend",
			displayName: "Backend",
			description: "backend development",
			adapter: "claude-code",
			routingScore: 0,
			matchedTerms: [],
		},
		{
			id: "docs",
			displayName: "Docs",
			description: "technical documentation",
			adapter: "codex",
			routingScore: 0,
			matchedTerms: [],
		},
	],
	named: [
		{
			id: "frontend",
			displayName: "Northstar",
			description: "React components, CSS layout, browser accessibility",
			adapter: "codex",
			routingScore: 0,
			matchedTerms: [],
		},
		{
			id: "backend",
			displayName: "River",
			description: "HTTP APIs, database transactions and server persistence",
			adapter: "claude-code",
			routingScore: 0,
			matchedTerms: [],
		},
		{
			id: "docs",
			displayName: "Quill",
			description: "User guides, tutorials, reference documentation",
			adapter: "hermes",
			routingScore: 0,
			matchedTerms: [],
		},
	],
	two: [
		{
			id: "backend",
			displayName: "API Agent",
			description: "HTTP APIs, server logic and database persistence",
			adapter: "codex",
			routingScore: 0,
			matchedTerms: [],
		},
		{
			id: "docs",
			displayName: "Writer",
			description: "User guides, release notes and documentation",
			adapter: "claude-code",
			routingScore: 0,
			matchedTerms: [],
		},
	],
	four: [
		{
			id: "frontend",
			displayName: "Canvas",
			description: "React and CSS implementation",
			adapter: "codex",
			routingScore: 0,
			matchedTerms: [],
		},
		{
			id: "backend",
			displayName: "Service",
			description: "Server APIs and databases",
			adapter: "claude-code",
			routingScore: 0,
			matchedTerms: [],
		},
		{
			id: "docs",
			displayName: "Guide",
			description: "Documentation and tutorials",
			adapter: "hermes",
			routingScore: 0,
			matchedTerms: [],
		},
		{
			id: "release",
			displayName: "Release",
			description: "CI workflows, Docker images and deployment",
			adapter: "codex",
			routingScore: 0,
			matchedTerms: [],
		},
	],
};

const owners: {
	expected: string | null;
	text: string;
	roster: string;
	context: string[];
}[] = [
	{
		expected: "frontend",
		text: "Change the CSS on the search input so the clear button no longer overlaps its text.",
		roster: "standard",
		context: [],
	},
	{
		expected: "frontend",
		text: "The React message composer loses focus after every keystroke. Fix its rerender behavior.",
		roster: "standard",
		context: [],
	},
	{
		expected: "frontend",
		text: "Center the empty-state illustration within the conversation panel.",
		roster: "standard",
		context: [],
	},
	{
		expected: "frontend",
		text: "Make the tooltip on the send button accessible to keyboard users.",
		roster: "standard",
		context: [],
	},
	{
		expected: "backend",
		text: "Add a DELETE HTTP endpoint that archives a workspace record in the database.",
		roster: "standard",
		context: [],
	},
	{
		expected: "backend",
		text: "Roll back both database writes if saving the new invitation fails.",
		roster: "standard",
		context: [],
	},
	{
		expected: "backend",
		text: "Validate the uploaded JSON body on the server before importing its records.",
		roster: "standard",
		context: [],
	},
	{
		expected: "backend",
		text: "Add a database index for the query that lists messages by conversation ID.",
		roster: "standard",
		context: [],
	},
	{
		expected: "docs",
		text: "Update the CLI reference to explain the new --port option.",
		roster: "standard",
		context: [],
	},
	{
		expected: "docs",
		text: "Write a getting-started tutorial covering installation and the first conversation.",
		roster: "standard",
		context: [],
	},
	{
		expected: "docs",
		text: "Document the existing authentication endpoint and its error responses.",
		roster: "standard",
		context: [],
	},
	{
		expected: "docs",
		text: "Rewrite the backup guide to make the restore steps easier to follow.",
		roster: "standard",
		context: [],
	},
	{
		expected: null,
		text: "Make this faster.",
		roster: "standard",
		context: [],
	},
	{
		expected: null,
		text: "There is a problem with the app. Can you fix it?",
		roster: "standard",
		context: [],
	},
	{
		expected: null,
		text: "Hello everyone, how is the work going?",
		roster: "standard",
		context: [],
	},
	{
		expected: null,
		text: "Build saved searches, including the React controls and database storage.",
		roster: "standard",
		context: [],
	},
	{
		expected: null,
		text: "Discuss the tradeoffs together and agree on a design.",
		roster: "standard",
		context: [],
	},
	{
		expected: null,
		text: "Implement server-side pagination and update its API reference.",
		roster: "standard",
		context: [],
	},
	{
		expected: "backend",
		text: "Yes, reject duplicate requests.",
		roster: "standard",
		context: [
			"User: Add idempotency keys to the create-payment endpoint.",
			"Backend: Should duplicate keys return the saved result?",
		],
	},
	{
		expected: "frontend",
		text: "Use the compact version.",
		roster: "standard",
		context: [
			"User: Make the React card header take less space.",
			"Frontend: We can use a compact or spacious CSS layout.",
		],
	},
	{
		expected: "docs",
		text: "Put that example first.",
		roster: "standard",
		context: [
			"User: Improve the installation tutorial.",
			"Docs: I have written an example of the first successful launch.",
		],
	},
	{
		expected: null,
		text: "Ship that.",
		roster: "standard",
		context: [
			"Frontend: The theme changes are ready.",
			"Backend: The new authentication endpoint is ready too.",
		],
	},
	{
		expected: "frontend",
		text: "Leave the API alone. Fix the CSS positioning of the popup.",
		roster: "standard",
		context: [],
	},
	{
		expected: "docs",
		text: "Do not modify the database. Only document the existing backup procedure.",
		roster: "standard",
		context: [],
	},
	{
		expected: "frontend",
		text: "Make the dialog body scroll while its buttons stay visible.",
		roster: "named",
		context: [],
	},
	{
		expected: "backend",
		text: "Prevent concurrent updates from overwriting a newer database record.",
		roster: "named",
		context: [],
	},
	{
		expected: "docs",
		text: "Add a troubleshooting guide for expired access tokens.",
		roster: "named",
		context: [],
	},
	{
		expected: "frontend",
		text: "Northstar, can you take this one?",
		roster: "named",
		context: [],
	},
	{
		expected: "backend",
		text: "River, good afternoon.",
		roster: "named",
		context: [],
	},
	{
		expected: "docs",
		text: "Quill, please explain the startup procedure.",
		roster: "named",
		context: [],
	},
	{
		expected: null,
		text: "Northstar and River, build the upload flow from the file picker through server storage.",
		roster: "named",
		context: [],
	},
	{
		expected: null,
		text: "The application is using too much memory. Investigate.",
		roster: "named",
		context: [],
	},
	{
		expected: "backend",
		text: "Add a server-side rate limit to the password-reset endpoint.",
		roster: "two",
		context: [],
	},
	{
		expected: "docs",
		text: "Write release notes describing the existing fixes.",
		roster: "two",
		context: [],
	},
	{
		expected: "docs",
		text: "Explain the SQL migration commands in the operator handbook.",
		roster: "two",
		context: [],
	},
	{
		expected: null,
		text: "Implement password reset and document the new endpoint.",
		roster: "two",
		context: [],
	},
	{
		expected: null,
		text: "Thanks for that!",
		roster: "two",
		context: [],
	},
	{
		expected: null,
		text: "Please investigate the bug.",
		roster: "two",
		context: [],
	},
	{
		expected: "release",
		text: "Update the Dockerfile so the release image runs as an unprivileged user.",
		roster: "four",
		context: [],
	},
	{
		expected: "release",
		text: "Add a CI job that publishes the production Docker image after tests pass.",
		roster: "four",
		context: [],
	},
	{
		expected: "frontend",
		text: "Fix the React form so the error label is linked to the invalid input.",
		roster: "four",
		context: [],
	},
	{
		expected: "backend",
		text: "Persist failed payment attempts atomically in the database.",
		roster: "four",
		context: [],
	},
	{
		expected: "docs",
		text: "Write a user guide for managing notification preferences.",
		roster: "four",
		context: [],
	},
	{
		expected: null,
		text: "Build the new settings form, save its values through an API, and write its user guide.",
		roster: "four",
		context: [],
	},
	{
		expected: null,
		text: "Improve reliability across the whole product.",
		roster: "four",
		context: [],
	},
	{
		expected: null,
		text: "Service and Release should debate how to deploy the API.",
		roster: "four",
		context: [],
	},
	{
		expected: "frontend",
		text: "Show a disabled state on the React save button during submission.",
		roster: "named",
		context: [],
	},
	{
		expected: "backend",
		text: "Create a database migration to add the missing foreign-key constraint.",
		roster: "named",
		context: [],
	},
	{
		expected: "frontend",
		text: "Continue frontend development for the notification tray.",
		roster: "standard",
		context: [
			'Thread context (inference): {"summary":"Frontend owns the React notification tray. Backend finished the delivery API.","decisions":[],"openQuestions":[]}',
		],
	},
	{
		expected: "backend",
		text: "Please continue backend development.",
		roster: "standard",
		context: [
			'Thread context (inference): {"summary":"Backend is implementing the job scheduler. Docs will document it after implementation.","decisions":[],"openQuestions":[]}',
		],
	},
	{
		expected: "docs",
		text: "Continue the technical documentation.",
		roster: "standard",
		context: [
			'Thread context (inference): {"summary":"Docs has a draft for exporting workspace data. Frontend has no current task.","decisions":[],"openQuestions":[]}',
		],
	},
	{
		expected: "frontend",
		text: "Use 100 milliseconds.",
		roster: "standard",
		context: [
			'Thread context (inference): {"summary":"Frontend asked whether an animation should last 100 or 200 milliseconds.","decisions":[],"openQuestions":[]}',
		],
	},
	{
		expected: "backend",
		text: "Return HTTP 410 for expired invitations.",
		roster: "standard",
		context: [
			'Thread context (inference): {"summary":"Backend asked whether expired invitations should return HTTP 410.","decisions":[],"openQuestions":[]}',
		],
	},
	{
		expected: "docs",
		text: "Put prerequisites first.",
		roster: "standard",
		context: [
			'Thread context (inference): {"summary":"Docs proposed placing prerequisites before examples in the setup guide.","decisions":[],"openQuestions":[]}',
		],
	},
	{
		expected: "frontend",
		text: "Please do frontend development on the notification view.",
		roster: "standard",
		context: [
			'Thread context (inference): {"summary":"Backend finished a notification endpoint and Frontend will connect its view.","decisions":[],"openQuestions":[]}',
		],
	},
	{
		expected: "backend",
		text: "Please do backend development for the checkout endpoint.",
		roster: "standard",
		context: [
			'Thread context (inference): {"summary":"Docs finished explaining the checkout endpoint. Backend still needs to implement it.","decisions":[],"openQuestions":[]}',
		],
	},
	{
		expected: "docs",
		text: "Write the technical documentation for those preferences.",
		roster: "standard",
		context: [
			'Thread context (inference): {"summary":"Frontend completed the preferences page. Docs will describe how to use it.","decisions":[],"openQuestions":[]}',
		],
	},
	{
		expected: "frontend",
		text: "Never change the CLI tutorial. Update the browser view.",
		roster: "standard",
		context: [
			'Thread context (inference): {"summary":"Docs owns the CLI tutorial, Frontend owns the browser view.","decisions":[],"openQuestions":[]}',
		],
	},
	{
		expected: "backend",
		text: "Ignore the CSS work for now and handle data retention.",
		roster: "standard",
		context: [
			'Thread context (inference): {"summary":"Frontend is polishing CSS and Backend owns data retention.","decisions":[],"openQuestions":[]}',
		],
	},
	{
		expected: "docs",
		text: "Document the recovery steps without changing the database.",
		roster: "standard",
		context: [
			'Thread context (inference): {"summary":"Backend owns database implementation and Docs owns its runbook.","decisions":[],"openQuestions":[]}',
		],
	},
	{
		expected: "backend",
		text: "Use Backend instead of Frontend for this task.",
		roster: "standard",
		context: [
			'Thread context (inference): {"summary":"Frontend and Backend both have a prototype.","decisions":[],"openQuestions":[]}',
		],
	},
	{
		expected: "frontend",
		text: "Don’t touch the guide; implement the dashboard.",
		roster: "standard",
		context: [
			'Thread context (inference): {"summary":"Docs maintains the dashboard guide and Frontend implements the dashboard.","decisions":[],"openQuestions":[]}',
		],
	},
	{
		expected: "docs",
		text: "Stop editing the server. Write the API guide.",
		roster: "standard",
		context: [
			'Thread context (inference): {"summary":"Backend maintains the HTTP server and Docs writes the API guide.","decisions":[],"openQuestions":[]}',
		],
	},
	{
		expected: "frontend",
		text: "No database changes; adjust the form.",
		roster: "standard",
		context: [
			'Thread context (inference): {"summary":"Backend owns persistence and Frontend owns forms.","decisions":[],"openQuestions":[]}',
		],
	},
	{
		expected: "backend",
		text: "Forget the help text. Finish the endpoint.",
		roster: "standard",
		context: [
			'Thread context (inference): {"summary":"Docs is drafting help text and Backend is building an endpoint.","decisions":[],"openQuestions":[]}',
		],
	},
	{
		expected: "docs",
		text: "Please handle the release notes rather than CSS.",
		roster: "standard",
		context: [
			'Thread context (inference): {"summary":"Frontend owns CSS and Docs owns release notes.","decisions":[],"openQuestions":[]}',
		],
	},
	{
		expected: null,
		text: "Finish the search controls and the query endpoint.",
		roster: "standard",
		context: [
			'Thread context (inference): {"summary":"Frontend is implementing search controls and Backend is implementing the query endpoint.","decisions":[],"openQuestions":[]}',
		],
	},
	{
		expected: null,
		text: "Both of you should compare your plans.",
		roster: "standard",
		context: [
			'Thread context (inference): {"summary":"Backend and Docs have separate unresolved plans for the import feature.","decisions":[],"openQuestions":[]}',
		],
	},
	{
		expected: null,
		text: "Go with that proposal.",
		roster: "standard",
		context: [
			'Thread context (inference): {"summary":"Frontend suggested a new layout. Backend suggested a new database.","decisions":[],"openQuestions":[]}',
		],
	},
	{
		expected: null,
		text: "Great work, everyone.",
		roster: "standard",
		context: [
			'Thread context (inference): {"summary":"Frontend and Docs finished unrelated work.","decisions":[],"openQuestions":[]}',
		],
	},
	{
		expected: null,
		text: "The entire application is unreliable. Investigate the cause.",
		roster: "standard",
		context: [
			'Thread context (inference): {"summary":"Frontend owns a browser page; Backend owns a server process.","decisions":[],"openQuestions":[]}',
		],
	},
	{
		expected: null,
		text: "Complete implementation and documentation together.",
		roster: "standard",
		context: [
			'Thread context (inference): {"summary":"Docs is writing the guide and Backend is implementing its HTTP examples.","decisions":[],"openQuestions":[]}',
		],
	},
	{
		expected: "frontend",
		text: "Do not change the docs. Please do frontend development.",
		roster: "standard",
		context: [
			'Thread context (inference): {"summary":"Docs is maintaining the CSS guide. Frontend owns UI implementation.","decisions":[],"openQuestions":[]}',
		],
	},
];

// These cases were labeled before the first model run. Changing a prompt or
// gate requires fresh held-out examples; this set is now a regression corpus.
export const classifierEvaluationCases: ClassifierEvaluationCase[] = owners.map(
	(item) => {
		const candidates = rosters[item.roster];
		if (candidates === undefined)
			throw new Error(`Unknown evaluation roster: ${item.roster}`);
		return {
			input: {
				text: item.text,
				context: item.context,
				candidates,
				projects: [],
				routingMemory: "",
				inferProjects: false,
				maxAgents: 2,
			},
			expected:
				item.expected === null
					? null
					: {
							mode: "parallel",
							assignments: [{ agentId: item.expected, projectIds: [] }],
						},
		};
	},
);

// Held-out during ONNX integration; retained here as regression cases afterward.
const onnxRegressionCases: {
	text: string;
	context: string[];
	expected: { agentId: string; projectIds: string[] } | null;
	projects: string[];
	sole: boolean;
}[] = [
	{
		text: "Increase the contrast of the disabled toolbar icons.",
		context: [],
		expected: {
			agentId: "frontend",
			projectIds: [],
		},
		projects: [],
		sole: false,
	},
	{
		text: "The browser's tab order skips the dismiss control. Repair it.",
		context: [],
		expected: {
			agentId: "frontend",
			projectIds: [],
		},
		projects: [],
		sole: false,
	},
	{
		text: "Render a skeleton while the React list is loading.",
		context: [],
		expected: {
			agentId: "frontend",
			projectIds: [],
		},
		projects: [],
		sole: false,
	},
	{
		text: "Add an expiry column to the sessions table and migrate existing records.",
		context: [],
		expected: {
			agentId: "backend",
			projectIds: [],
		},
		projects: [],
		sole: false,
	},
	{
		text: "The HTTP handler accepts invalid currency codes. Validate that input.",
		context: [],
		expected: {
			agentId: "backend",
			projectIds: [],
		},
		projects: [],
		sole: false,
	},
	{
		text: "Make the two SQL updates part of one transaction.",
		context: [],
		expected: {
			agentId: "backend",
			projectIds: [],
		},
		projects: [],
		sole: false,
	},
	{
		text: "Write an operator runbook for recovering a failed import.",
		context: [],
		expected: {
			agentId: "docs",
			projectIds: [],
		},
		projects: [],
		sole: false,
	},
	{
		text: "Explain each exit code in the command line manual.",
		context: [],
		expected: {
			agentId: "docs",
			projectIds: [],
		},
		projects: [],
		sole: false,
	},
	{
		text: "Add a glossary to the onboarding tutorial.",
		context: [],
		expected: {
			agentId: "docs",
			projectIds: [],
		},
		projects: [],
		sole: false,
	},
	{
		text: "Add the React export button and the API that streams the archive.",
		context: [],
		expected: null,
		projects: [],
		sole: false,
	},
	{
		text: "Implement the health endpoint and document its response schema.",
		context: [],
		expected: null,
		projects: [],
		sole: false,
	},
	{
		text: "Build a keyboard-accessible menu and write a guide for using its shortcuts.",
		context: [],
		expected: null,
		projects: [],
		sole: false,
	},
	{
		text: "Do not edit the React form. Add the missing database uniqueness constraint.",
		context: [],
		expected: {
			agentId: "backend",
			projectIds: [],
		},
		projects: [],
		sole: false,
	},
	{
		text: "Keep the server code unchanged and write troubleshooting documentation.",
		context: [],
		expected: {
			agentId: "docs",
			projectIds: [],
		},
		projects: [],
		sole: false,
	},
	{
		text: "Ignore the README for now. Fix the browser's clipped dropdown.",
		context: [],
		expected: {
			agentId: "frontend",
			projectIds: [],
		},
		projects: [],
		sole: false,
	},
	{
		text: "Use the second version.",
		context: ["Frontend: I prepared two CSS layouts for the account menu."],
		expected: {
			agentId: "frontend",
			projectIds: [],
		},
		projects: [],
		sole: false,
	},
	{
		text: "Yes, make it atomic.",
		context: [
			"Backend: Should the transfer update both account rows in a single database transaction?",
		],
		expected: {
			agentId: "backend",
			projectIds: [],
		},
		projects: [],
		sole: false,
	},
	{
		text: "Put it before the installation steps.",
		context: [
			"Docs: Where should the prerequisites section go in the setup tutorial?",
		],
		expected: {
			agentId: "docs",
			projectIds: [],
		},
		projects: [],
		sole: false,
	},
	{
		text: "Apply that change.",
		context: [
			"Frontend: I proposed a menu redesign.",
			"Backend: I proposed changing the session schema.",
		],
		expected: null,
		projects: [],
		sole: false,
	},
	{
		text: "Let's fix the bad behavior.",
		context: [],
		expected: null,
		projects: [],
		sole: false,
	},
	{
		text: "Good morning everyone.",
		context: [],
		expected: null,
		projects: [],
		sole: false,
	},
	{
		text: "Please finish the urgent thing.",
		context: [],
		expected: null,
		projects: [],
		sole: false,
	},
	{
		text: "Add a foreign key to the Billing project's invoice table.",
		context: [],
		expected: {
			agentId: "backend",
			projectIds: ["Billing"],
		},
		projects: ["Billing", "Marketing"],
		sole: false,
	},
	{
		text: "Fix the Marketing project's mobile navigation CSS.",
		context: [],
		expected: {
			agentId: "frontend",
			projectIds: ["Marketing"],
		},
		projects: ["Billing", "Marketing"],
		sole: false,
	},
	{
		text: "Write the Billing project's installation guide.",
		context: [],
		expected: {
			agentId: "docs",
			projectIds: ["Billing"],
		},
		projects: ["Billing", "Marketing"],
		sole: false,
	},
	{
		text: "Fix the timeout.",
		context: [],
		expected: null,
		projects: ["Billing", "Marketing"],
		sole: false,
	},
	{
		text: "Thanks, the Billing project is looking great.",
		context: [],
		expected: null,
		projects: ["Billing", "Marketing"],
		sole: false,
	},
	{
		text: "Explain what a SQL transaction is, without opening a repository.",
		context: [],
		expected: {
			agentId: "backend",
			projectIds: [],
		},
		projects: ["Billing", "Marketing"],
		sole: false,
	},
	{
		text: "Add the same database index to Billing and Marketing.",
		context: [],
		expected: {
			agentId: "backend",
			projectIds: ["Billing", "Marketing"],
		},
		projects: ["Billing", "Marketing"],
		sole: false,
	},
	{
		text: "Frontend and Backend should debate the upload design and agree on an approach.",
		context: [],
		expected: null,
		projects: [],
		sole: false,
	},
	{
		text: "Repair the CSS flexbox wrapping in the attachment tray.",
		context: [],
		expected: {
			agentId: "frontend",
			projectIds: [],
		},
		projects: [],
		sole: false,
	},
	{
		text: "Show a React loading spinner inside the submit control.",
		context: [],
		expected: {
			agentId: "frontend",
			projectIds: [],
		},
		projects: [],
		sole: false,
	},
	{
		text: "Give the browser's resize handle a larger pointer target.",
		context: [],
		expected: {
			agentId: "frontend",
			projectIds: [],
		},
		projects: [],
		sole: false,
	},
	{
		text: "Add server-side validation for the invoice currency field.",
		context: [],
		expected: {
			agentId: "backend",
			projectIds: [],
		},
		projects: [],
		sole: false,
	},
	{
		text: "Prevent the queue worker from inserting duplicate records.",
		context: [],
		expected: {
			agentId: "backend",
			projectIds: [],
		},
		projects: [],
		sole: false,
	},
	{
		text: "Add a database constraint to prevent negative inventory.",
		context: [],
		expected: {
			agentId: "backend",
			projectIds: [],
		},
		projects: [],
		sole: false,
	},
	{
		text: "Write a tutorial for the existing bulk-import command.",
		context: [],
		expected: {
			agentId: "docs",
			projectIds: [],
		},
		projects: [],
		sole: false,
	},
	{
		text: "Document how administrators revoke active sessions.",
		context: [],
		expected: {
			agentId: "docs",
			projectIds: [],
		},
		projects: [],
		sole: false,
	},
	{
		text: "Explain the documented recovery procedure in simpler language.",
		context: [],
		expected: {
			agentId: "docs",
			projectIds: [],
		},
		projects: [],
		sole: false,
	},
	{
		text: "Create the React billing page and implement its storage endpoint.",
		context: [],
		expected: null,
		projects: [],
		sole: false,
	},
	{
		text: "Add the audit-log API and write a tutorial for using it.",
		context: [],
		expected: null,
		projects: [],
		sole: false,
	},
	{
		text: "Improve the keyboard shortcuts and also write their reference page.",
		context: [],
		expected: null,
		projects: [],
		sole: false,
	},
	{
		text: "Implement the account lookup endpoint. Document its error codes.",
		context: [],
		expected: null,
		projects: [],
		sole: false,
	},
	{
		text: "Work on the user interface, persistence layer, documentation.",
		context: [],
		expected: null,
		projects: [],
		sole: false,
	},
	{
		text: "Sort out the remaining issues.",
		context: [],
		expected: null,
		projects: [],
		sole: false,
	},
	{
		text: "How's it going today?",
		context: [],
		expected: null,
		projects: [],
		sole: false,
	},
	{
		text: "Keep those instructions unchanged. Repair the API response validation.",
		context: [],
		expected: {
			agentId: "backend",
			projectIds: [],
		},
		projects: [],
		sole: false,
	},
	{
		text: "Please use the narrower margin.",
		context: ["Frontend: The React card can have a narrow or wide CSS margin."],
		expected: {
			agentId: "frontend",
			projectIds: [],
		},
		projects: [],
		sole: false,
	},
	{
		text: "Use HTTP 409.",
		context: [
			"Backend: What status should the create-invoice endpoint return for a duplicate record?",
		],
		expected: {
			agentId: "backend",
			projectIds: [],
		},
		projects: [],
		sole: false,
	},
	{
		text: "Yes, add that warning.",
		context: [
			"Docs: Should the restore guide warn that importing replaces existing data?",
		],
		expected: {
			agentId: "docs",
			projectIds: [],
		},
		projects: [],
		sole: false,
	},
	{
		text: "Update the Ledger project's SQL migration.",
		context: [],
		expected: {
			agentId: "backend",
			projectIds: ["Ledger"],
		},
		projects: ["Ledger", "Website"],
		sole: true,
	},
	{
		text: "Good job on the Ledger project!",
		context: [],
		expected: {
			agentId: "backend",
			projectIds: [],
		},
		projects: ["Ledger", "Website"],
		sole: true,
	},
	{
		text: "Explain how relational indexes work without accessing a Project.",
		context: [],
		expected: {
			agentId: "backend",
			projectIds: [],
		},
		projects: ["Ledger", "Website"],
		sole: true,
	},
	{
		text: "Please fix the regression.",
		context: [],
		expected: null,
		projects: ["Ledger", "Website"],
		sole: true,
	},
];
for (const item of onnxRegressionCases) {
	const standard = rosters.standard;
	if (standard === undefined)
		throw new Error("Missing standard evaluation roster");
	classifierEvaluationCases.push({
		input: {
			text: item.text,
			context: item.context,
			routingMemory: "",
			candidates: item.sole
				? standard.filter((candidate) => candidate.id === "backend")
				: standard,
			projects: item.projects.map((name) => ({ id: name, name })),
			inferProjects: item.projects.length > 0,
			maxAgents: 2,
		},
		expected:
			item.expected === null
				? null
				: { mode: "parallel", assignments: [item.expected] },
	});
}

// Additional cases labeled before adapter fitting; retained as regression after evaluation.
const additionalRoster: AiRouteInput["candidates"] = [
	{
		id: "ui-agent",
		displayName: "Nika",
		description: "frontend development",
		adapter: "codex",
		routingScore: 0,
		matchedTerms: [],
	},
	{
		id: "api-agent",
		displayName: "Oren",
		description: "backend development",
		adapter: "claude-code",
		routingScore: 0,
		matchedTerms: [],
	},
	{
		id: "writing-agent",
		displayName: "Vale",
		description: "technical documentation",
		adapter: "hermes",
		routingScore: 0,
		matchedTerms: [],
	},
	{
		id: "delivery-agent",
		displayName: "Tess",
		description: "CI workflows, Docker images and deployment",
		adapter: "codex",
		routingScore: 0,
		matchedTerms: [],
	},
];

const addAdditionalCase = (
	text: string,
	agent: string | null,
	other: Partial<AiRouteInput> = {},
): ClassifierEvaluationCase => {
	const shift = (classifierEvaluationCases.length - 127) % 4;
	const candidates = [
		...additionalRoster.slice(shift),
		...additionalRoster.slice(0, shift),
	];
	const input: AiRouteInput = {
		text,
		context: [],
		routingMemory: "",
		candidates,
		projects: [],
		inferProjects: false,
		maxAgents: 4,
		...other,
	};
	const item: ClassifierEvaluationCase = {
		input,
		expected:
			agent === null
				? null
				: {
						mode: "parallel",
						assignments: [
							{
								agentId: agent,
								projectIds: input.inferProjects
									? []
									: input.projects.map((p) => p.id),
							},
						],
					},
	};
	classifierEvaluationCases.push(item);
	return item;
};
for (const [agent, texts] of Object.entries({
	"ui-agent": [
		"Restore the focus position after the settings dialog closes.",
		"The navigation underline is one pixel too low. Adjust its CSS.",
		"Make a React component that previews an uploaded photo.",
		"Disable the browser form until its required inputs are filled.",
		"Render validation hints under the text fields.",
		"Remove the unwanted horizontal scrollbar from the browser panel.",
	],
	"api-agent": [
		"The account creation endpoint returns secrets in its JSON. Fix the response.",
		"Write a schema migration that makes the optional owner column nullable.",
		"Delete expired jobs from persistent storage every night.",
		"The HTTP service deadlocks when two clients save the same object. Repair it.",
		"Reject path traversal filenames at the upload API boundary.",
		"Serialize writes targeting the same stored conversation.",
	],
	"writing-agent": [
		"Create a reference page for the already implemented environment variables.",
		"The administrator manual uses obsolete command names. Correct the prose.",
		"Write a beginner walkthrough for joining a workspace.",
		"Explain the restore command in the troubleshooting guide.",
		"Produce a quick-start checklist for the published package.",
		"Document how the current permissions work without changing any code.",
	],
	"delivery-agent": [
		"Bundle the Windows executable in the release pipeline.",
		"Fix the broken step that pushes container tags after a release.",
		"Use the correct certificate when signing the macOS release artifact.",
		"Set the Docker image entrypoint to the application launcher.",
		"Add a deployment health gate before sending traffic to the new version.",
		"Move the package publishing credentials to the CI secret configuration.",
	],
}))
	for (const text of texts) addAdditionalCase(text, agent);
for (const [text, agent] of [
	[
		"Keep the frontend unchanged. Add the missing API request validation.",
		"api-agent",
	],
	["The API already works; only write its usage guide.", "writing-agent"],
	["Do not deploy anything yet. Fix the browser layout.", "ui-agent"],
	["Ignore the guide edit and repair the Docker build.", "delivery-agent"],
	[
		"Leave the implementation alone and document the existing endpoint.",
		"writing-agent",
	],
	["The tutorial is complete. Repair the SQL query instead.", "api-agent"],
] as const)
	addAdditionalCase(text, agent);
for (const [text, context, agent] of [
	[
		"Use the smaller gap.",
		["Nika: Should the settings labels have a large or a small visual gap?"],
		"ui-agent",
	],
	[
		"Return the saved result.",
		[
			"Oren: When the API sees a duplicate idempotency key, should it fail or return the saved result?",
		],
		"api-agent",
	],
	[
		"Put that warning first.",
		[
			"Vale: I am deciding where the data-loss warning belongs in the backup instructions.",
		],
		"writing-agent",
	],
	[
		"Ship the signed archive.",
		[
			"Tess: Both unsigned and signed release archives have passed staging verification. Which should be published?",
		],
		"delivery-agent",
	],
] as const)
	addAdditionalCase(text, agent, { context: [...context] });
for (const text of [
	"The workspace feels strange.",
	"Any ideas?",
	"Thanks, folks.",
	"Carry on with it.",
])
	addAdditionalCase(text, null);
for (const text of [
	"Create the React settings controls and persist their values through a new HTTP endpoint.",
	"Repair the deployment workflow and write a guide to its operation.",
	"Nika and Oren should debate the architecture together.",
	"Build the database migration, update its reference guide, and deploy it.",
])
	addAdditionalCase(text, null);
for (const [text, agent, memory] of [
	[
		"Repair the CSS margin on the browser toolbar.",
		"api-agent",
		"Confirmed correction: Oren handles frontend development in this channel.",
	],
	[
		"Write a guide explaining the setup commands.",
		"ui-agent",
		"Confirmed correction: Nika handles technical documentation in this channel.",
	],
	[
		"Implement validation for the new API payload.",
		"writing-agent",
		"Confirmed correction: Vale handles backend development in this channel.",
	],
	[
		"Update the container deployment job.",
		"delivery-agent",
		"Confirmed correction: Oren handles frontend development; Tess continues to own CI and deployment.",
	],
] as const)
	addAdditionalCase(text, agent, { routingMemory: memory });
const projects = [
	{ id: "cedar", name: "Cedar" },
	{ id: "larch", name: "Larch" },
];
for (const [text, scope] of [
	["Add a foreign key in the Cedar repository.", ["cedar"]],
	["Repair Larch's API request parsing.", ["larch"]],
	["Explain what an index is; do not open a repository.", []],
	["Excellent progress on Cedar.", []],
	["I appreciate the Larch work.", []],
	["Change the schema in that project.", null],
	["Apply the same schema migration in Cedar and Larch.", null],
	["Leave Cedar alone and implement the change in Larch.", ["larch"]],
] as const) {
	const item = addAdditionalCase(text, "api-agent", {
		candidates: additionalRoster.filter((a) => a.id === "api-agent"),
		projects,
		inferProjects: true,
	});
	item.expected =
		scope === null
			? null
			: {
					mode: "parallel",
					assignments: [{ agentId: "api-agent", projectIds: [...scope] }],
				};
}
for (const [text, mode] of [
	[
		"Work separately: one agent implements the screen and the other builds the endpoint.",
		"parallel",
	],
	[
		"Compare your designs, challenge each other, and reach a joint recommendation.",
		"relay",
	],
	["Complete your respective implementation tasks independently.", "parallel"],
	["Discuss the architecture back and forth before settling it.", "relay"],
] as const) {
	const item = addAdditionalCase(text, null, {
		fixedAgentIds: ["api-agent", "ui-agent"],
		projects: [{ id: "cedar", name: "Cedar" }],
		candidates: additionalRoster.slice(0, 2),
	});
	item.expected = {
		mode,
		assignments: [
			{ agentId: "api-agent", projectIds: ["cedar"] },
			{ agentId: "ui-agent", projectIds: ["cedar"] },
		],
	};
}

// Fixed participants still require inference when their work must run in order.
for (const text of [
	"Oren, add the endpoint first. Then Nika, build the form using Oren's result.",
	"Nika, design the form first. Then Oren, implement the API using Nika's design.",
	"Oren must finish the migration before Nika starts updating the settings screen.",
]) {
	addAdditionalCase(text, null, {
		fixedAgentIds: ["api-agent", "ui-agent"],
		candidates: additionalRoster.slice(0, 2),
	});
}

for (const text of [
	"Nice work on Cairn!",
	"I appreciate your work on Aster.",
]) {
	const item = addAdditionalCase(text, "api-agent", {
		candidates: additionalRoster
			.filter((a) => a.id === "api-agent")
			.map((a) => ({ ...a, displayName: "Backend" })),
		projects: [
			{ id: "aster", name: "Aster" },
			{ id: "cairn", name: "Cairn" },
		],
		inferProjects: true,
	});
	item.expected = {
		mode: "parallel",
		assignments: [{ agentId: "api-agent", projectIds: [] }],
	};
}
const mixedProjectMention = addAdditionalCase(
	"Nice work on Cairn. Now fix the login CSS.",
	"api-agent",
	{
		candidates: additionalRoster.filter((agent) => agent.id === "api-agent"),
		projects: [{ id: "cairn", name: "Cairn" }],
		inferProjects: true,
	},
);
mixedProjectMention.expected = null;

// Regression: configured Projects must not force standalone greetings through a harness.
const greetingRoster: AiRouteInput["candidates"] = [
	{
		id: "default",
		displayName: "Default",
		adapter: "hermes",
		description: "General coding assistance and workspace maintenance.",
		routingScore: 0,
		matchedTerms: [],
	},
	{
		id: "codex",
		displayName: "Codex",
		adapter: "codex",
		description: "Installed Codex harness.",
		routingScore: 0,
		matchedTerms: [],
	},
	{
		id: "agentops",
		displayName: "Gatdamgames Agentops",
		adapter: "hermes",
		description:
			"Agent runtimes, gateways, observability and workflow infrastructure.",
		routingScore: 0,
		matchedTerms: [],
	},
];
for (const [text, recipients, routingMemory] of [
	["hi agentops", ["agentops"], ""],
	["say hello all", ["default", "codex", "agentops"], ""],
	[
		"hello al",
		["default", "codex", "agentops"],
		"Earlier unaddressed greetings were redirected to Codex.",
	],
	[
		"hi agent ops",
		["agentops"],
		"Earlier unaddressed greetings were redirected to Codex.",
	],
] as const) {
	classifierEvaluationCases.push({
		input: {
			text,
			context: [
				"The agents previously discussed implementation work in the Website Project.",
			],
			routingMemory,
			candidates: greetingRoster,
			projects: [
				{ id: "website", name: "Website" },
				{ id: "cairn", name: "Cairn" },
			],
			inferProjects: true,
			maxAgents: 3,
		},
		expected: {
			mode: "parallel",
			assignments: recipients.map((agentId) => ({ agentId, projectIds: [] })),
		},
		requiredLocal: true,
	});
}

// Independently labeled before testing the conversational prompt. Straightforward
// addressing is mandatory; unsupported phrasing may abstain but may never misroute.
const conversationalRoster: AiRouteInput["candidates"] = [
	{
		id: "mira",
		displayName: "Mira Vale",
		adapter: "codex",
		description: "React components and browser accessibility",
		routingScore: 0,
		matchedTerms: [],
	},
	{
		id: "rowan",
		displayName: "Rowan Ops",
		adapter: "claude-code",
		description: "HTTP APIs and database persistence",
		routingScore: 0,
		matchedTerms: [],
	},
	{
		id: "tess",
		displayName: "Tess Reed",
		adapter: "codex",
		description: "Documentation and tutorials",
		routingScore: 0,
		matchedTerms: [],
	},
];
const conversationalCases: {
	text: string;
	recipients: string[] | null;
	requiredLocal?: boolean;
	input?: Partial<AiRouteInput>;
}[] = [
	{ text: "Hey Mira Vale, good morning!", recipients: ["mira"] },
	{ text: "Thanks, Rowan!", recipients: ["rowan"], requiredLocal: true },
	{ text: "Codex, hello there.", recipients: null },
	{ text: "Good evening, Claude.", recipients: ["rowan"] },
	{
		text: "Good morning, everyone!",
		recipients: ["mira", "rowan", "tess"],
		requiredLocal: true,
	},
	{
		text: "Could all of you say hello?",
		recipients: ["mira", "rowan", "tess"],
	},
	{ text: "Hello!", recipients: null },
	{
		text: "Thanks for that.",
		recipients: null,
		input: { context: ["Tess Reed: The guide is ready."] },
	},
	{
		text: "Hello Mira, build the upload screen and have Rowan implement its API.",
		recipients: null,
	},
	{ text: "Hi everyone, please fix the failing build.", recipients: null },
	{ text: "Do not greet Tess.", recipients: null },
	{ text: "Hello everyone except Rowan.", recipients: null },
	{
		text: '"Hello Mira" is an example string in the README.',
		recipients: null,
	},
	{ text: "Tell Mira that I said hello.", recipients: null },
	{ text: "Good morning, you two.", recipients: null },
	{
		text: "Hello, Tess Reed!",
		recipients: ["tess"],
		requiredLocal: true,
		input: {
			inferProjects: false,
			projects: [{ id: "cedar", name: "Cedar" }],
		},
	},
	{ text: "Thanks, Rowan, excellent work on Cedar!", recipients: ["rowan"] },
	{
		text: "Good morning, Mira Vale.",
		// Current direct addressing supersedes historical corrections. This oracle
		// previously required abstention whenever routing memory was present.
		recipients: ["mira"],
		requiredLocal: true,
		input: {
			routingMemory:
				"Confirmed correction: requests addressing Mira go to Tess in this channel.",
		},
	},
	{ text: "No, Rowan should get that.", recipients: null },
	{
		text: "Mira and Rowan, say hello to each other and introduce yourselves back and forth.",
		recipients: null,
	},
	{ text: "hi Mira Vale", recipients: ["mira"], requiredLocal: true },
	{ text: "hello Rowan", recipients: ["rowan"], requiredLocal: true },
	{ text: "hey Tess Reed", recipients: ["tess"], requiredLocal: true },
	{ text: "good morning Mira", recipients: ["mira"], requiredLocal: true },
	...[
		"hello alll",
		"hey evveryone",
		"thanks everrybody",
		"good morning all agents",
	].map((text) => ({
		text,
		recipients: ["mira", "rowan", "tess"],
		requiredLocal: true,
	})),
	{ text: "hello Row an", recipients: ["rowan"], requiredLocal: true },
	{ text: "hi MiraVale", recipients: ["mira"], requiredLocal: true },
	...[
		"hello pal",
		"hello Hall",
		"hello stranger",
		"hello al, fix the failing build",
		"hello al except Rowan",
		"hi Mira and Rowan",
	].map((text) => ({ text, recipients: null })),
	{
		text: "hello al",
		recipients: null,
		input: {
			candidates: conversationalRoster.map((agent) => {
				if (agent.id === "mira") return { ...agent, displayName: "Al Foster" };
				if (agent.id === "rowan") return { ...agent, displayName: "Al Reeves" };
				return agent;
			}),
		},
	},
	{
		text: "hello al",
		recipients: null,
		input: {
			candidates: conversationalRoster.map((agent) => ({
				...agent,
				displayName: agent.id === "mira" ? "All" : agent.displayName,
			})),
		},
	},
	{
		text: "hi Row an",
		recipients: null,
		input: {
			candidates: conversationalRoster.map((agent) => {
				if (agent.id === "mira") return { ...agent, displayName: "Row An" };
				if (agent.id === "rowan") return { ...agent, displayName: "Rowan" };
				return agent;
			}),
		},
	},
	{
		text: "hello alll",
		recipients: null,
		input: { maxAgents: 2 },
	},
];
for (const item of conversationalCases) {
	const input: AiRouteInput = {
		text: item.text,
		context: [],
		routingMemory: "",
		candidates: conversationalRoster,
		projects: [
			{ id: "cedar", name: "Cedar" },
			{ id: "larch", name: "Larch" },
		],
		inferProjects: true,
		maxAgents: 3,
		...item.input,
	};
	classifierEvaluationCases.push({
		input,
		requiredLocal: item.requiredLocal === true,
		expected:
			item.recipients === null
				? null
				: {
						mode: "parallel",
						assignments: item.recipients.map((agentId) => ({
							agentId,
							projectIds: input.inferProjects
								? []
								: input.projects.map((project) => project.id),
						})),
					},
	});
}
