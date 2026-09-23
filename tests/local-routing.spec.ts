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
	it.each([
		["hi agentops", ["ops"]],
		["hi agent ops", ["ops"]],
		["hello al", ["front", "ops"]],
		["say hello all", ["front", "ops"]],
	] as const)(
		"routes the standalone greeting %s without inferred Project access",
		async (text, recipients) => {
			const classify = vi
				.fn<RunningClassifier["classify"]>()
				.mockResolvedValue([
					{
						id: recipients.length === 1 ? "greeting-agent:1" : "everyone",
						score: 0.9,
					},
					{ id: "other", score: 0.1 },
				]);
			const result = await routeLocally(
				{
					...input,
					text,
					candidates: input.candidates.map((candidate, index) =>
						index === 1
							? { ...candidate, id: "ops", displayName: "Gatdamgames Agentops" }
							: candidate,
					),
					projects: [{ id: "web", name: "Website" }],
					inferProjects: true,
				},
				classify,
			);
			expect(result).toMatchObject({
				source: "local",
				mode: "parallel",
				assignments: recipients.map((agentId) => ({ agentId, projectIds: [] })),
			});
		},
	);

	it("keeps explicit Project scope when a standalone greeting has no usable brief", async () => {
		const classify = async () => [
			{ id: "greeting-agent:0", score: 0.9 },
			{ id: "unclear", score: 0.1 },
		];
		expect(
			await routeLocally(
				{
					...input,
					text: "Hello Frontend!",
					context: null,
					projects: [{ id: "web", name: "Website" }],
				},
				classify,
			),
		).toMatchObject({
			assignments: [{ agentId: "front", projectIds: ["web"] }],
		});
	});

	it.each([
		"hi frontend, continue",
		"say hello all then improve Website",
		"Good morning everyone; deploy Website.",
		"hello all what is your status",
		"hello everyone except Frontend",
		"hello everyone but Frontend",
		"hello al then fix Website",
		"hi front end fix the API",
		"hello pal",
		"hi unknown",
	])("does not turn %s into a projectless greeting", async (text) => {
		const classify = vi.fn<RunningClassifier["classify"]>().mockResolvedValue([
			{ id: "everyone", score: 0.99 },
			{ id: "unclear", score: 0.01 },
		]);
		expect(
			await routeLocally(
				{
					...input,
					text,
					projects: [{ id: "web", name: "Website" }],
					inferProjects: true,
				},
				classify,
			),
		).toBeNull();
		expect(classify).not.toHaveBeenCalled();
	});

	it("does not silently truncate an everyone greeting to the fan-out limit", async () => {
		const classify = vi.fn<RunningClassifier["classify"]>();
		expect(
			await routeLocally(
				{ ...input, text: "say hello all", maxAgents: 1 },
				classify,
			),
		).toBeNull();
		expect(classify).not.toHaveBeenCalled();
	});

	it.each([
		["hello evveryone", "Every One"],
		["hello alll", "A ll"],
		["hello al agents", "Allagents"],
	])(
		"does not broadcast %s when a normalized Agent name collides",
		async (text, displayName) => {
			const classify = vi
				.fn<RunningClassifier["classify"]>()
				.mockResolvedValue([
					{ id: "everyone", score: 0.99 },
					{ id: "unclear", score: 0.01 },
				]);
			expect(
				await routeLocally(
					{
						...input,
						text,
						candidates: input.candidates.map((candidate, index) =>
							index === 0 ? { ...candidate, displayName } : candidate,
						),
					},
					classify,
				),
			).toBeNull();
			expect(classify).not.toHaveBeenCalled();
		},
	);

	it("abstains when a shortened greeting names two candidates", async () => {
		const classify = vi.fn<RunningClassifier["classify"]>();
		expect(
			await routeLocally(
				{
					...input,
					text: "hi agent",
					candidates: input.candidates.map((candidate) => ({
						...candidate,
						displayName: `${candidate.displayName} Agent`,
					})),
				},
				classify,
			),
		).toBeNull();
		expect(classify).not.toHaveBeenCalled();
	});

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

	it.each([
		"Fix the login CSS.",
		"Add the React export button and the API that streams the archive.",
		"Build a login screen backed by a new authentication endpoint.",
	])(
		"leaves the complete recipient set to inference despite a confident partial match: %s",
		async (text) => {
			const classify = vi
				.fn<RunningClassifier["classify"]>()
				.mockResolvedValue([
					{ id: "agent:0", score: 0.99 },
					{ id: "agent:1", score: 0.005 },
					{ id: "multiple", score: 0.005 },
				]);
			expect(await routeLocally({ ...input, text }, classify)).toBeNull();
			expect(classify).not.toHaveBeenCalled();
		},
	);

	it("retains explicitly scoped Projects for the only eligible participant", async () => {
		const classify = vi.fn<RunningClassifier["classify"]>();
		expect(
			await routeLocally(
				{
					...input,
					candidates: input.candidates.slice(1),
					projects: [{ id: "web", name: "Website" }],
				},
				classify,
			),
		).toMatchObject({
			assignments: [{ agentId: "back", projectIds: ["web"] }],
		});
		expect(classify).not.toHaveBeenCalled();
	});
	it("defers correction memory rather than trusting a confident conflicting classifier", async () => {
		const classify = vi.fn<RunningClassifier["classify"]>().mockResolvedValue([
			{ id: "agent:0", score: 0.99 },
			{ id: "agent:1", score: 0.01 },
		]);
		expect(
			await routeLocally(
				{
					...input,
					candidates: input.candidates.slice(0, 1),
					routingMemory: "Backend handles CSS now.",
				},
				classify,
			),
		).toBeNull();
		expect(classify).not.toHaveBeenCalled();
	});
	it("defers a stale brief even with only one eligible participant", async () => {
		const classify = vi.fn<RunningClassifier["classify"]>();
		expect(
			await routeLocally(
				{ ...input, candidates: input.candidates.slice(0, 1), context: null },
				classify,
			),
		).toBeNull();
		expect(classify).not.toHaveBeenCalled();
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
	it("retains explicit participants and Project scope for independent work", async () => {
		const classify = vi.fn<RunningClassifier["classify"]>().mockResolvedValue([
			{ id: "parallel", score: 0.9 },
			{ id: "relay", score: 0.06 },
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
			mode: "parallel",
			assignments: [
				{ agentId: "back", projectIds: ["web"] },
				{ agentId: "front", projectIds: ["web"] },
			],
		});
		expect(classify.mock.calls[0]?.[0].state).toContain(input.context[0]);
		expect(classify.mock.calls[0]?.[0].state).toContain(input.text);
	});

	it("defers explicit relay order to inference when the user names a different first speaker", async () => {
		const classify = vi.fn<RunningClassifier["classify"]>().mockResolvedValue([
			{ id: "relay", score: 0.9 },
			{ id: "parallel", score: 0.06 },
			{ id: "uncertain", score: 0.04 },
		]);
		expect(
			await routeLocally(
				{
					...input,
					text: "@Frontend @Backend: Backend speaks first, then Frontend reviews.",
					fixedAgentIds: ["front", "back"],
				},
				classify,
			),
		).toBeNull();
		expect(classify).toHaveBeenCalledTimes(1);
	});
});
