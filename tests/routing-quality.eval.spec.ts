import { describe, expect, it } from "vitest";
import {
	type AiRouteInput,
	type AiRouteResult,
	routeWithOpenAICompatible,
} from "../server/src/ai-router.ts";
import { routeWithJev } from "../server/src/jev-router.ts";

interface ExpectedAssignment {
	agentId: string;
	projectIds: string[];
}

interface RoutingEvaluationCase {
	name: string;
	input: AiRouteInput;
	expectedMode: "parallel" | "relay";
	expected: ExpectedAssignment[];
}

const cases: RoutingEvaluationCase[] = [
	{
		name: "selects one semantic owner despite negated lexical evidence",
		input: {
			text: "Fix expired refresh tokens without changing the UI. Preserve AUTH_PROTOCOL.",
			context: [],
			routingMemory: "",
			candidates: [
				{
					id: "backend",
					displayName: "Backend",
					description: "Owns authentication and APIs.",
					adapter: "codex",
					routingScore: 0,
					matchedTerms: [],
				},
				{
					id: "frontend",
					displayName: "Frontend",
					description: "Owns screens and CSS.",
					adapter: "codex",
					routingScore: 3,
					matchedTerms: ["UI"],
				},
			],
			projects: [{ id: "api", name: "Authentication API" }],
			inferProjects: true,
			maxAgents: 2,
		},
		expectedMode: "parallel",
		expected: [
			{
				agentId: "backend",
				projectIds: ["api"],
			},
		],
	},
	{
		name: "continues prior ownership from a terse follow-up",
		input: {
			text: "continue, preserving CONTINUITY",
			context: [
				'Prior Thread ownership: ["backend"]',
				"Backend: Implementing refresh-token recovery; Frontend has no assignment.",
			],
			routingMemory: "",
			candidates: [
				{
					id: "backend",
					displayName: "Backend",
					description: "Owns authentication and APIs.",
					adapter: "codex",
					routingScore: 0,
					matchedTerms: [],
				},
				{
					id: "frontend",
					displayName: "Frontend",
					description: "Owns screens and CSS.",
					adapter: "codex",
					routingScore: 0,
					matchedTerms: [],
				},
			],
			projects: [],
			inferProjects: false,
			maxAgents: 2,
		},
		expectedMode: "parallel",
		expected: [
			{ agentId: "backend", projectIds: [], requiredConstraint: "CONTINUITY" },
		],
	},
	{
		name: "separates API compatibility from documentation",
		input: {
			text: "Backend: validate the import envelope without changing the public archive shape. Constraint API_COMPAT must survive. Docs: document the exact supported limits and keep the privacy warning. Constraint DOC_PRIVACY must survive.",
			context: [],
			routingMemory: "",
			candidates: [
				{
					id: "backend",
					displayName: "Backend",
					description: "Owns server APIs, validation, and persistence.",
					adapter: "codex",
					routingScore: 1,
					matchedTerms: ["import", "envelope"],
				},
				{
					id: "docs",
					displayName: "Docs",
					description: "Owns user and release documentation.",
					adapter: "codex",
					routingScore: 1,
					matchedTerms: ["document", "privacy"],
				},
			],
			projects: [
				{ id: "server-project", name: "Server" },
				{ id: "docs-project", name: "Documentation" },
			],
			inferProjects: true,
			maxAgents: 2,
		},
		expectedMode: "parallel",
		expected: [
			{
				agentId: "backend",
				projectIds: ["server-project"],
			},
			{
				agentId: "docs",
				projectIds: ["docs-project"],
			},
		],
	},
	{
		name: "keeps independent UI and security constraints scoped",
		input: {
			text: "UI: show uncertain reply attention without changing permission controls. Preserve token UI_UNCERTAIN. Security: review file-handle race protection only; do not rewrite attachment contents. Preserve token SECURITY_BYTES.",
			context: [
				"Ralph: Native permissions remain authoritative.",
				"Project Server owns filesystem file handles and attachment storage. Project UI owns browser reply presentation and permission controls.",
			],
			routingMemory: "",
			candidates: [
				{
					id: "frontend",
					displayName: "Frontend",
					description: "Owns React presentation and interaction semantics.",
					adapter: "codex",
					routingScore: 1,
					matchedTerms: ["UI", "show"],
				},
				{
					id: "security",
					displayName: "Security",
					description: "Owns filesystem boundary review and data protection.",
					adapter: "codex",
					routingScore: 1,
					matchedTerms: ["Security", "file-handle"],
				},
			],
			projects: [
				{ id: "ui-project", name: "UI" },
				{ id: "server-project", name: "Server" },
			],
			inferProjects: true,
			maxAgents: 2,
		},
		expectedMode: "parallel",
		expected: [
			{
				agentId: "frontend",
				projectIds: ["ui-project"],
			},
			{
				agentId: "security",
				projectIds: ["server-project"],
			},
		],
	},
	{
		name: "orders an explicit peer discussion as a relay",
		input: {
			text: "Talk to each other in this order and agree on ownership. Backend starts with BACKEND_SCOPE. Frontend responds with FRONTEND_SCOPE. Infrastructure synthesizes with INFRA_SCOPE.",
			context: [],
			routingMemory: "",
			candidates: [
				{
					id: "backend",
					displayName: "Backend",
					description: "Owns APIs, services, and persistence.",
					adapter: "codex",
					routingScore: 1,
					matchedTerms: ["Backend"],
				},
				{
					id: "frontend",
					displayName: "Frontend",
					description: "Owns client UI, state, and navigation.",
					adapter: "codex",
					routingScore: 1,
					matchedTerms: ["Frontend"],
				},
				{
					id: "infrastructure",
					displayName: "Infrastructure",
					description: "Owns runtime, deployment, and reliability.",
					adapter: "codex",
					routingScore: 1,
					matchedTerms: ["Infrastructure"],
				},
			],
			projects: [],
			inferProjects: false,
			maxAgents: 3,
		},
		expectedMode: "relay",
		expected: [
			{
				agentId: "backend",
				projectIds: [],
			},
			{
				agentId: "frontend",
				projectIds: [],
			},
			{
				agentId: "infrastructure",
				projectIds: [],
			},
		],
	},
];

const runEvaluation = process.env.COMMONSPACE_ROUTING_EVAL === "1";

describe.runIf(runEvaluation)("routing provider quality evaluation", () => {
	for (const evaluation of cases) {
		it(evaluation.name, async () => {
			const baseUrl = process.env.COMMONSPACE_ROUTING_BASE_URL;
			const model = process.env.COMMONSPACE_ROUTING_MODEL;
			if (
				process.env.COMMONSPACE_ROUTING_JEV_MODEL === undefined &&
				(baseUrl === undefined || model === undefined)
			)
				throw new Error(
					"routing evaluation requires COMMONSPACE_ROUTING_BASE_URL and COMMONSPACE_ROUTING_MODEL",
				);
			const jevModel = process.env.COMMONSPACE_ROUTING_JEV_MODEL;
			const started = performance.now();
			let result: AiRouteResult;
			if (jevModel !== undefined) {
				const apiKey = process.env.TYPESAFE_API_KEY;
				if (!apiKey)
					throw new Error("Jev quality evaluation requires TYPESAFE_API_KEY");
				const decision = await routeWithJev(
					{ apiKey, model: jevModel },
					evaluation.input,
				);
				result = {
					assignments: decision.assignments,
					mode: decision.mode,
					reason: decision.reason,
					confidence: decision.confidence,
				};
			} else {
				if (baseUrl === undefined || model === undefined)
					throw new Error("text router requires base URL and model");
				result = await routeWithOpenAICompatible(
					{
						baseUrl,
						model,
						apiKey: process.env.COMMONSPACE_ROUTING_API_KEY,
					},
					evaluation.input,
				);
			}
			console.log(
				JSON.stringify({
					case: evaluation.name,
					provider: jevModel ?? model,
					routingMs: performance.now() - started,
				}),
			);
			expect(result.mode).toBe(evaluation.expectedMode);
			expect(result.assignments).toHaveLength(evaluation.expected.length);
			for (const expected of evaluation.expected) {
				const assignment = result.assignments.find(
					(candidate) => candidate.agentId === expected.agentId,
				);
				expect(
					assignment,
					`missing ${expected.agentId} assignment`,
				).toBeDefined();
				expect(assignment?.projectIds).toEqual(expected.projectIds);
			}
		});
	}
});
