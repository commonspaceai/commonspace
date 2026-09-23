import { describe, expect, it, vi } from "vitest";
import type { AiRouteInput } from "../server/src/ai-router.ts";
import type { RunningClassifier } from "../server/src/local-classifier.ts";
import { routeLocally } from "../server/src/local-routing.ts";

const input: AiRouteInput = {
	text: "Fix the login CSS.",
	context: ["Backend: The API is ready."],
	routingMemory: "",
	candidates: [
		{
			id: "front",
			displayName: "Frontend",
			description: "React and CSS",
			adapter: "hermes",
			routingScore: 1,
			matchedTerms: ["css"],
		},
		{
			id: "back",
			displayName: "Backend",
			description: "API and persistence",
			adapter: "codex",
			routingScore: 0,
			matchedTerms: [],
		},
	],
	projects: [],
	inferProjects: false,
	maxAgents: 2,
};

describe("local routing", () => {
	it("retains the only eligible projectless participant without inference", async () => {
		const classify = vi.fn<RunningClassifier["classify"]>();
		expect(
			await routeLocally(
				{
					...input,
					candidates: input.candidates.slice(0, 1),
					text: "nice push",
				},
				classify,
			),
		).toMatchObject({
			source: "local",
			mode: "parallel",
			assignments: [{ agentId: "front", projectIds: [] }],
		});
		expect(classify).not.toHaveBeenCalled();
	});

	it("selects a strong single owner while preserving all context", async () => {
		const classify = vi.fn<RunningClassifier["classify"]>().mockResolvedValue([
			{ id: "agent:0", score: 0.58 },
			{ id: "agent:1", score: 0.2 },
			{ id: "multiple", score: 0.1 },
			{ id: "uncertain", score: 0.12 },
		]);
		const result = await routeLocally(input, classify);
		expect(result).toMatchObject({
			source: "local",
			assignments: [{ agentId: "front", projectIds: [] }],
		});
		expect(result).not.toHaveProperty("confidence");
		expect(classify.mock.calls[0]?.[0].state).toContain(input.context[0]);
		expect(classify.mock.calls[0]?.[0].state).toContain(input.text);
	});

	it.each([
		null,
		[
			{ id: "agent:0", score: 0.54 },
			{ id: "agent:1", score: 0.2 },
			{ id: "multiple", score: 0.14 },
			{ id: "uncertain", score: 0.12 },
		],
		[
			{ id: "agent:0", score: 0.6 },
			{ id: "agent:1", score: 0.4 },
		],
		[
			{ id: "multiple", score: 0.95 },
			{ id: "agent:0", score: 0.05 },
		],
		[
			{ id: "uncertain", score: 0.95 },
			{ id: "agent:0", score: 0.05 },
		],
	])(
		"defers ambiguity, multiple owners, or unsupported input to the existing router",
		async (scores) => {
			expect(await routeLocally(input, async () => scores)).toBeNull();
		},
	);

	it("does not accept a partial owner for a compound cross-domain request", async () => {
		const classify = async () => [
			{ id: "agent:0", score: 0.8 },
			{ id: "agent:1", score: 0.1 },
			{ id: "multiple", score: 0.1 },
		];
		expect(
			await routeLocally(
				{
					...input,
					text: "Add the React export button and the API that streams the archive.",
				},
				classify,
			),
		).toBeNull();
	});

	it("retains explicitly scoped Projects when selecting a recipient", async () => {
		const classify = vi.fn<RunningClassifier["classify"]>().mockResolvedValue([
			{ id: "agent:1", score: 0.9 },
			{ id: "agent:0", score: 0.1 },
		]);
		expect(
			await routeLocally(
				{
					...input,
					projects: [{ id: "web", name: "Website" }],
				},
				classify,
			),
		).toMatchObject({
			assignments: [{ agentId: "back", projectIds: ["web"] }],
		});
		expect(classify).toHaveBeenCalledTimes(1);
	});
	it("defers correction memory rather than trusting a confident conflicting classifier", async () => {
		const classify = vi.fn<RunningClassifier["classify"]>().mockResolvedValue([
			{ id: "agent:0", score: 0.99 },
			{ id: "agent:1", score: 0.01 },
		]);
		expect(
			await routeLocally(
				{ ...input, routingMemory: "Backend handles CSS now." },
				classify,
			),
		).toBeNull();
		expect(classify).not.toHaveBeenCalled();
	});
	it("requires stronger evidence when a request negates a responsibility", async () => {
		const scores = [
			{ id: "agent:0", score: 0.6 },
			{ id: "agent:1", score: 0.1 },
		];
		expect(
			await routeLocally(
				{ ...input, text: "Ignore the CSS work; change the API." },
				async () => scores,
			),
		).toBeNull();
	});
	it.each([
		["Repair Cairn's API.", "work", ["cairn"]],
		["Nice work on Cairn!", "comment", []],
	] as const)(
		"classifies whether %s requires the named Project",
		async (text, choice, projectIds) => {
			const classify = vi.fn<RunningClassifier["classify"]>(async () => [
				{ id: choice, score: 0.95 },
				{ id: choice === "work" ? "comment" : "work", score: 0.05 },
			]);
			expect(
				await routeLocally(
					{
						...input,
						text,
						candidates: input.candidates.slice(0, 1),
						inferProjects: true,
						projects: [
							{ id: "cairn", name: "Cairn" },
							{ id: "other", name: "Other" },
						],
					},
					classify,
				),
			).toMatchObject({
				assignments: [{ agentId: "front", projectIds }],
			});
			expect(classify).toHaveBeenCalledTimes(1);
		},
	);
	it.each(["Repair the API.", "Repair Cairn and Other.", "Do not edit Cairn."])(
		"defers unclear or negated inferred Project scope: %s",
		async (text) => {
			const classify = vi.fn<RunningClassifier["classify"]>();
			expect(
				await routeLocally(
					{
						...input,
						text,
						candidates: input.candidates.slice(0, 1),
						inferProjects: true,
						projects: [
							{ id: "cairn", name: "Cairn" },
							{ id: "other", name: "Other" },
						],
					},
					classify,
				),
			).toBeNull();
			expect(classify).not.toHaveBeenCalled();
		},
	);
	it("defers praise for one Project followed by work elsewhere", async () => {
		const classify = vi.fn<RunningClassifier["classify"]>().mockResolvedValue([
			{ id: "other", score: 0.96 },
			{ id: "work", score: 0.03 },
			{ id: "comment", score: 0.01 },
		]);
		expect(
			await routeLocally(
				{
					...input,
					text: "Nice work on Cairn. Now fix the login CSS.",
					candidates: input.candidates.slice(0, 1),
					inferProjects: true,
					projects: [{ id: "cairn", name: "Cairn" }],
				},
				classify,
			),
		).toBeNull();
		expect(
			classify.mock.calls[0]?.[0].options.map((option) => option.id),
		).toContain("other");
	});
	it("defers inferred Project scope with fixed recipients", async () => {
		const classify = vi.fn<RunningClassifier["classify"]>();
		expect(
			await routeLocally(
				{
					...input,
					fixedAgentIds: ["front", "back"],
					inferProjects: true,
					projects: [{ id: "cairn", name: "Cairn" }],
				},
				classify,
			),
		).toBeNull();
		expect(classify).not.toHaveBeenCalled();
	});
	it("retains explicit participants and Project scope when classifying peer discussion mode", async () => {
		const classify = vi.fn<RunningClassifier["classify"]>().mockResolvedValue([
			{ id: "relay", score: 0.9 },
			{ id: "parallel", score: 0.06 },
			{ id: "uncertain", score: 0.04 },
		]);
		expect(
			await routeLocally(
				{
					...input,
					fixedAgentIds: ["back", "front"],
					projects: [{ id: "web", name: "Website" }],
				},
				classify,
			),
		).toMatchObject({
			mode: "relay",
			assignments: [
				{ agentId: "back", projectIds: ["web"] },
				{ agentId: "front", projectIds: ["web"] },
			],
		});
	});
});
