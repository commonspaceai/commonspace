import { describe, expect, it } from "vitest";
import type { AiRouteInput } from "../server/src/ai-router.ts";
import { routeWithJev } from "../server/src/jev-router.ts";

const roster: AiRouteInput["candidates"] = [
	{
		id: "assistant-a",
		displayName: "Default",
		adapter: "hermes",
		routingScore: 0,
		matchedTerms: [],
	},
	{
		id: "assistant-b",
		displayName: "Codex",
		adapter: "codex",
		routingScore: 0,
		matchedTerms: [],
	},
	{
		id: "assistant-c",
		displayName: "Cedarworks Agentops",
		adapter: "opencode",
		routingScore: 0,
		matchedTerms: [],
	},
];

describe.skipIf(
	process.env.COMMONSPACE_ROUTING_EVAL !== "1" ||
		process.env.COMMONSPACE_ROUTING_JEV_MODEL === undefined,
)("live Jev routing", () => {
	it.each([
		{ text: "hi hermes", agentId: "assistant-a" },
		{ text: "hi cedar", agentId: "assistant-c" },
		{ text: "hello codex", agentId: "assistant-b" },
		{ text: "hi default", agentId: "assistant-a" },
	])(
		"recognizes conversational addressing: $text",
		async ({ text, agentId }) => {
			const apiKey = process.env.TYPESAFE_API_KEY;
			if (apiKey === undefined) throw new Error("TYPESAFE_API_KEY is required");
			const result = await routeWithJev(
				{
					apiKey,
					model: process.env.COMMONSPACE_ROUTING_JEV_MODEL ?? "jev-1.13.0",
				},
				{
					text,
					context: [],
					routingMemory: "",
					candidates: roster,
					projects: [],
					inferProjects: true,
					maxAgents: 3,
				},
			);
			expect(result.assignments).toEqual([{ agentId, projectIds: [] }]);
		},
	);
	it("does not invent an owner when multiple agents use the addressed harness", async () => {
		const apiKey = process.env.TYPESAFE_API_KEY;
		if (apiKey === undefined) throw new Error("TYPESAFE_API_KEY is required");
		await expect(
			routeWithJev(
				{
					apiKey,
					model: process.env.COMMONSPACE_ROUTING_JEV_MODEL ?? "jev-1.13.0",
				},
				{
					text: "hi hermes",
					context: [],
					routingMemory: "",
					candidates: roster.map((agent) => ({
						...agent,
						adapter: "hermes",
						displayName: agent.id,
					})),
					projects: [],
					inferProjects: true,
					maxAgents: 3,
				},
			),
		).rejects.toThrow(/uncertain/);
	});
	it("uses a named greeting over old ownership even when agents share a harness", async () => {
		const apiKey = process.env.TYPESAFE_API_KEY;
		if (apiKey === undefined) throw new Error("TYPESAFE_API_KEY is required");
		const result = await routeWithJev(
			{
				apiKey,
				model: process.env.COMMONSPACE_ROUTING_JEV_MODEL ?? "jev-1.13.0",
			},
			{
				text: "hi cedar",
				context: [
					'Prior Thread ownership: ["assistant-b"]',
					"Codex: I am fixing the login screen in Project sample.",
				],
				routingMemory: "",
				candidates: roster.map((agent) =>
					agent.id === "assistant-c" ? { ...agent, adapter: "hermes" } : agent,
				),
				projects: [{ id: "sample", name: "sample" }],
				inferProjects: true,
				maxAgents: 3,
			},
		);
		expect(result.assignments).toEqual([
			{ agentId: "assistant-c", projectIds: [] },
		]);
	});
	it.each([
		{ text: "hello", projectIds: [] },
		{ text: "Continue fixing it", projectIds: ["sample"] },
		{
			text: "What does the login screen currently do?",
			projectIds: ["sample"],
		},
		{
			text: "Continue fixing the login screen in @@sample",
			projectIds: ["sample"],
		},
	])(
		"routes $text with only its requested Project scope",
		async ({ text, projectIds }) => {
			const apiKey = process.env.TYPESAFE_API_KEY;
			if (apiKey === undefined)
				throw new Error(
					"TYPESAFE_API_KEY is required for live Jev verification",
				);
			const result = await routeWithJev(
				{
					apiKey,
					model: process.env.COMMONSPACE_ROUTING_JEV_MODEL ?? "jev-1.13.0",
				},
				{
					text,
					context: [
						"Earlier Channel conversation: User: Fix the login screen in @@sample. Developer: I am fixing the login screen in Project sample.",
						"Previous owner: Developer. Project sample has ongoing login screen work.",
					],
					routingMemory: "",
					candidates: [
						{
							id: "developer",
							displayName: "Developer",
							description: "Development and general assistance",
							adapter: "codex",
							routingScore: 0,
							matchedTerms: [],
						},
					],
					projects: [{ id: "sample", name: "sample" }],
					inferProjects: true,
					maxAgents: 1,
				},
			);
			expect(result.assignments).toEqual([
				{ agentId: "developer", projectIds },
			]);
		},
	);
});
