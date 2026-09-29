import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AcpAgentProcess } from "../server/src/acp-runtime.ts";
import { createCodexAdapter } from "../server/src/adapters/codex.ts";
import {
	type AiRouteInput,
	buildRoutingPrompt,
	parseRoutingResponse,
	routingOutputTokenBudget,
} from "../server/src/ai-router.ts";
import { mustExist } from "./test-helpers.ts";

const cases = [
	{
		name: "runs independent frontend and backend work in parallel",
		text: "Frontend, build the signup form. Backend, add the signup endpoint. Work independently.",
		mode: "parallel",
		recipients: ["frontend", "backend"],
	},
	{
		name: "routes backend before frontend for dependent work",
		text: "Backend, add the signup endpoint first. Then Frontend, build the form using Backend's result.",
		mode: "relay",
		recipients: ["backend", "frontend"],
	},
	{
		name: "routes frontend before backend for dependent work",
		text: "Frontend, design the signup fields first. Then Backend, implement the API using Frontend's design.",
		mode: "relay",
		recipients: ["frontend", "backend"],
	},
	{
		name: "excludes completed backend work from a frontend request",
		text: "Frontend, fix the signup form spacing. The backend already works; leave it alone.",
		mode: "parallel",
		recipients: ["frontend"],
	},
	{
		name: "excludes completed frontend work from a backend request",
		text: "Backend, fix the signup API validation. The frontend already works; leave it alone.",
		mode: "parallel",
		recipients: ["backend"],
	},
	{
		name: "keeps independent work parallel despite the word then",
		text: "Frontend, fix form spacing, and then Backend, fix API logging. These changes are independent; neither needs to wait.",
		mode: "parallel",
		recipients: ["frontend", "backend"],
	},
] as const;

describe
	.skipIf(process.env.COMMONSPACE_ROUTING_EVAL !== "1")
	.sequential("real routing decisions", () => {
		let cwd: string | undefined;
		let client: AcpAgentProcess | undefined;

		async function runRoute(
			text: string,
			routingMemory = "",
			fixedAgentIds?: string[],
		) {
			const input: AiRouteInput = {
				text,
				context: [],
				routingMemory,
				projects: [],
				inferProjects: false,
				maxAgents: 3,
				candidates: [
					{
						id: "frontend",
						displayName: "Frontend",
						description: "Owns React UI, forms, and CSS.",
						adapter: "codex",
						routingScore: 0,
						matchedTerms: [],
					},
					{
						id: "backend",
						displayName: "Backend",
						description: "Owns backend APIs and persistence.",
						adapter: "codex",
						routingScore: 0,
						matchedTerms: [],
					},
					{
						id: "docs",
						displayName: "Docs",
						description: "Owns user documentation.",
						adapter: "codex",
						routingScore: 0,
						matchedTerms: [],
					},
				],
			};
			if (fixedAgentIds !== undefined) input.fixedAgentIds = fixedAgentIds;
			let permissionRequests = 0;
			const result = await mustExist(client).run({
				cwd: mustExist(cwd),
				message: `You are a bounded routing classifier. Return only the requested JSON object.\n\nOutput token budget: at most ${String(routingOutputTokenBudget(input.maxAgents))} tokens.\n\n${buildRoutingPrompt(input)}`,
				retainSession: false,
				modeId: "agent",
				mcpServers: [],
				signal: AbortSignal.timeout(30_000),
				onPermissionRequest: async () => {
					permissionRequests += 1;
					return {};
				},
			});
			const route = parseRoutingResponse(result.text);
			expect(permissionRequests).toBe(0);
			expect(
				result.trace?.entries.filter((entry) => entry.type === "tool") ?? [],
			).toHaveLength(0);
			for (const assignment of route.assignments)
				expect(assignment.projectIds, result.text).toEqual([]);
			return { route, responseText: result.text };
		}

		beforeAll(async () => {
			cwd = await mkdtemp(join(tmpdir(), "commonspace-routing-quality-"));
			const launch = await createCodexAdapter({}).launch(
				{
					id: "codex",
					displayName: "Codex",
					adapter: "codex",
					model: null,
					status: "stopped",
				},
				false,
				AbortSignal.timeout(30_000),
			);
			const env = { ...launch.env };
			if (process.env.COMMONSPACE_ROUTING_EVAL_MODEL !== undefined) {
				env.CODEX_CONFIG = JSON.stringify({
					model: process.env.COMMONSPACE_ROUTING_EVAL_MODEL,
					model_reasoning_effort: "medium",
				});
			}
			client = new AcpAgentProcess({
				...launch,
				env,
				cwd,
				requestTimeoutMs: 30_000,
				maxResponseChars: routingOutputTokenBudget(3) * 8,
				clientName: "commonspace-routing-quality",
			});
		});

		afterAll(async () => {
			try {
				await client?.close();
			} finally {
				if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
			}
		});

		it.each(cases)(
			"$name",
			async ({ text, mode, recipients }) => {
				const { route, responseText } = await runRoute(text);
				expect(route.mode, responseText).toBe(mode);
				const actual = route.assignments.map(
					(assignment) => assignment.agentId,
				);
				expect(
					mode === "relay" ? actual : actual.toSorted(),
					responseText,
				).toEqual(mode === "relay" ? recipients : recipients.toSorted());
			},
			40_000,
		);

		it("uses a relevant correction without changing unrelated or explicit routing", async () => {
			const request =
				"Clarify the validation errors shown by the React signup form.";
			const matchingMemory =
				"The user corrected a React signup form validation-error wording request from Frontend to Docs. Route later signup form validation-error wording requests to Docs.";
			const unrelatedMemory =
				"The user corrected an API reference documentation request from Backend to Docs. Route later API reference documentation requests to Docs.";
			for (let attempt = 0; attempt < 2; attempt += 1) {
				const { route, responseText } = await runRoute(request);
				expect(route.mode, responseText).toBe("parallel");
				expect(
					route.assignments.map(({ agentId }) => agentId),
					responseText,
				).toEqual(["frontend"]);
			}
			const matching = await runRoute(request, matchingMemory);
			expect(matching.route.mode, matching.responseText).toBe("parallel");
			expect(
				matching.route.assignments.map(({ agentId }) => agentId),
				matching.responseText,
			).toEqual(["docs"]);
			const unrelated = await runRoute(request, unrelatedMemory);
			expect(unrelated.route.mode, unrelated.responseText).toBe("parallel");
			expect(
				unrelated.route.assignments.map(({ agentId }) => agentId),
				unrelated.responseText,
			).toEqual(["frontend"]);
			const explicit = await runRoute(
				"@Frontend, clarify the validation errors shown by the React signup form.",
				matchingMemory,
				["frontend"],
			);
			expect(explicit.route.mode, explicit.responseText).toBe("parallel");
			expect(
				explicit.route.assignments.map(({ agentId }) => agentId),
				explicit.responseText,
			).toEqual(["frontend"]);
		}, 180_000);
	});
