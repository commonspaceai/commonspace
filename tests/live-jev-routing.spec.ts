import { describe, expect, it } from "vitest";
import { routeWithJev } from "../server/src/jev-router.ts";

describe.skipIf(
	process.env.COMMONSPACE_ROUTING_EVAL !== "1" ||
		process.env.COMMONSPACE_ROUTING_JEV_MODEL === undefined,
)("live Jev Project scope", () => {
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
