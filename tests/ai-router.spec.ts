import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
	buildRoutingPrompt,
	parseRoutingResponse,
	routeWithOpenAICompatible,
	routingOutputTokenBudget,
} from "../server/src/ai-router.ts";

const input = {
	text: "Fix the login screen CSS.",
	context: ["Ralph: The API is already working."],
	routingMemory: "",
	candidates: [
		{
			id: "frontend",
			displayName: "Frontend",
			description: "Owns React UI and CSS.",
			adapter: "hermes" as const,
			routingScore: 1,
			matchedTerms: ["css"],
		},
		{
			id: "backend",
			displayName: "Backend",
			description: "Owns APIs and persistence.",
			adapter: "codex" as const,
			routingScore: 0,
			matchedTerms: [],
		},
	],
	projects: [{ id: "web", name: "Web App" }],
	inferProjects: false,
	maxAgents: 2,
};
const requestBodySchema = z.object({
	model: z.string(),
	max_tokens: z.number(),
	response_format: z.object({ type: z.string() }),
});

function expectTerseFollowupContinuity(): void {
	const prompt = buildRoutingPrompt({
		...input,
		text: "nice push",
		context: [
			"Ralph: @frontend fix the login screen CSS.",
			"Frontend: Fixed the login screen CSS.",
		],
		candidates: input.candidates.slice(0, 1),
		maxAgents: 1,
	});

	expect(prompt).toContain("Return at least one assignment");
	expect(prompt).toContain("terse follow-up");
	expect(prompt).toContain("existing thread participant");
}

function expectEmptyRoutingDecisionRejected(): void {
	expect(() =>
		parseRoutingResponse(
			'{"assignments":[],"confidence":1,"reason":"Acknowledgment only; no agent work requested."}',
		),
	).toThrow("routing response must contain at least one assignment");
}

describe("Commonspace AI router", () => {
	it("scales a bounded output budget with requested assignment complexity", () => {
		expect(routingOutputTokenBudget(1)).toBe(512);
		expect(routingOutputTokenBudget(2)).toBe(768);
		expect(routingOutputTokenBudget(8)).toBe(2_304);
		expect(routingOutputTokenBudget(8, 1)).toBe(4_096);
		expect(routingOutputTokenBudget(100)).toBe(2_304);
	});

	it("rejects router-authored replacement text in a participant decision", () => {
		expect(() =>
			parseRoutingResponse(
				JSON.stringify({
					mode: "parallel",
					assignments: [
						{
							agentId: "frontend",
							projectIds: [],
							subRequest: "Change the request",
						},
					],
					reason: "UI",
				}),
			),
		).toThrow(/required shape/);
	});

	it("builds a bounded classifier prompt with candidate responsibilities", () => {
		const prompt = buildRoutingPrompt(input);
		expect(prompt).toContain("Select one owner by default");
		expect(prompt).toContain('"id":"frontend"');
		expect(prompt).toContain('"harness":"Hermes"');
		expect(prompt).toContain('"routingScore":1');
		expect(prompt).toContain('"matchedTerms":["css"]');
		expect(prompt).toContain('"id":"web"');
		expect(prompt).toContain("original user message unchanged");
		expect(prompt).toContain("useful evidence");
		expect(prompt).toContain("Fix the login screen CSS.");
	});

	it("defines peer discussion as an ordered relay instead of parallel fan-out", () => {
		const prompt = buildRoutingPrompt({
			...input,
			text: "Talk to each other and agree on the ownership boundary.",
		});

		expect(prompt).toContain('Use mode "relay"');
		expect(prompt).toContain("first assignment starts the conversation");
		expect(prompt).toContain('"mode":"parallel"');
		expect(prompt).toContain(
			"Talk to each other and agree on the ownership boundary.",
		);
	});

	it("includes compacted explicit correction knowledge in later routing prompts", () => {
		const prompt = buildRoutingPrompt({
			...input,
			routingMemory: "Route review-only requests to Reviewer.",
		});

		expect(prompt).toContain(
			"Routing knowledge from explicit user corrections: Route review-only requests to Reviewer.",
		);
	});

	it(
		"requires terse thread follow-ups to keep an existing participant",
		expectTerseFollowupContinuity,
	);

	it("parses strict or fenced JSON routing results", () => {
		expect(
			parseRoutingResponse(
				'```json\n{"mode":"parallel","assignments":[{"agentId":"frontend","projectIds":["web"]}],"confidence":0.96,"reason":"UI work"}\n```',
			),
		).toEqual({
			mode: "parallel",
			assignments: [
				{
					agentId: "frontend",
					projectIds: ["web"],
				},
			],
			confidence: 0.96,
			reason: "UI work",
		});
	});

	it("preserves relay mode for sequential peer discussion", () => {
		expect(
			parseRoutingResponse(
				'{"mode":"relay","assignments":[{"agentId":"frontend","projectIds":[]},{"agentId":"backend","projectIds":[]}],"confidence":0.94,"reason":"The user asked agents to talk together."}',
			),
		).toEqual({
			mode: "relay",
			assignments: [
				{
					agentId: "frontend",
					projectIds: [],
				},
				{
					agentId: "backend",
					projectIds: [],
				},
			],
			confidence: 0.94,
			reason: "The user asked agents to talk together.",
		});
	});

	it("rejects a valid-looking routing response without an explicit mode", () => {
		expect(() =>
			parseRoutingResponse(
				'{"assignments":[{"agentId":"frontend","projectIds":[]}],"reason":"UI work"}',
			),
		).toThrow("routing response mode must be parallel or relay");
	});

	it("rejects a relay without two speakers", () => {
		expect(() =>
			parseRoutingResponse(
				'{"mode":"relay","assignments":[{"agentId":"frontend","projectIds":[]}],"reason":"Peer discussion"}',
			),
		).toThrow("relay routing requires at least two assignments");
	});

	it("round-trips a deterministic multi-assignment routing contract", () => {
		expect(
			parseRoutingResponse(
				'{"mode":"parallel","assignments":[{"agentId":"backend","projectIds":["api"]},{"agentId":"frontend","projectIds":["web","design"]}],"confidence":0.89,"reason":"Independent API and UI responsibilities"}',
			),
		).toEqual({
			mode: "parallel",
			assignments: [
				{
					agentId: "backend",
					projectIds: ["api"],
				},
				{
					agentId: "frontend",
					projectIds: ["web", "design"],
				},
			],
			confidence: 0.89,
			reason: "Independent API and UI responsibilities",
		});
	});

	it("rejects malformed JSON before a routing result is available", () => {
		expect(() => parseRoutingResponse('{"assignments":[')).toThrow(
			"routing response did not match the required shape",
		);
	});

	it("rejects routing assignments that fail the response schema", () => {
		expect(() =>
			parseRoutingResponse(
				JSON.stringify({
					mode: "parallel",
					assignments: [
						{
							agentId: "frontend",
							projectIds: [42],
						},
					],
					reason: "Invalid project reference",
				}),
			),
		).toThrow("routing response did not match the required shape");
	});

	it(
		"rejects an empty routing decision at the router boundary",
		expectEmptyRoutingDecisionRejected,
	);
});

describe("Commonspace AI router provider boundary", () => {
	it("calls an OpenAI-compatible chat completions endpoint without requiring an SDK", async () => {
		const request = vi.fn<typeof fetch>(
			async (resource: string | URL | Request, init?: RequestInit) => {
				void resource;
				void init;
				return new Response(
					JSON.stringify({
						choices: [
							{
								message: {
									content:
										'{"mode":"parallel","assignments":[{"agentId":"frontend","projectIds":["web"]}],"confidence":0.91,"reason":"CSS is frontend work"}',
								},
							},
						],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			},
		);

		await expect(
			routeWithOpenAICompatible(
				{
					baseUrl: "https://example.test/v1",
					model: "gpt-router",
					apiKey: "secret-key",
					fetch: request,
				},
				input,
			),
		).resolves.toEqual({
			mode: "parallel",
			assignments: [{ agentId: "frontend", projectIds: ["web"] }],
			confidence: 0.91,
			reason: "CSS is frontend work",
		});

		expect(request).toHaveBeenCalledWith(
			"https://example.test/v1/chat/completions",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					authorization: "Bearer secret-key",
				}),
			}),
		);
		const body = requestBodySchema.parse(
			JSON.parse(String(request.mock.calls[0]?.[1]?.body)),
		);
		expect(body).toMatchObject({
			model: "gpt-router",
			max_tokens: 768,
			response_format: { type: "json_object" },
		});
	});

	it("rejects a provider response explicitly truncated by its output limit", async () => {
		const request = vi.fn<typeof fetch>(async () =>
			Response.json({
				choices: [
					{
						finish_reason: "length",
						message: { content: '{"assignments":[' },
					},
				],
			}),
		);

		await expect(
			routeWithOpenAICompatible(
				{
					baseUrl: "https://example.test/v1",
					model: "gpt-router",
					fetch: request,
				},
				input,
			),
		).rejects.toThrow("inference provider truncated its response");
	});

	it("rejects malformed provider completion envelopes", async () => {
		const request = vi.fn<typeof fetch>(async () =>
			Response.json({ choices: [{ message: { content: 42 } }] }),
		);

		await expect(
			routeWithOpenAICompatible(
				{
					baseUrl: "https://example.test/v1",
					model: "gpt-router",
					fetch: request,
				},
				input,
			),
		).rejects.toThrow("inference provider returned no message");
	});

	it("aborts an oversized provider response without buffering the remaining body", async () => {
		let pulls = 0;
		let cancelled = false;
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				pulls += 1;
				controller.enqueue(new Uint8Array(40_000));
				if (pulls === 10) controller.close();
			},
			cancel() {
				cancelled = true;
			},
		});
		const request = vi.fn<typeof fetch>(
			async () => new Response(stream, { status: 200 }),
		);

		await expect(
			routeWithOpenAICompatible(
				{
					baseUrl: "https://example.test/v1",
					model: "gpt-router",
					fetch: request,
				},
				input,
			),
		).rejects.toThrow("routing provider response was too large");
		expect(cancelled).toBe(true);
		expect(pulls).toBeLessThanOrEqual(3);
	});
});
