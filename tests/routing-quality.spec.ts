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
			client = new AcpAgentProcess({
				...launch,
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
				const input: AiRouteInput = {
					text,
					context: [],
					routingMemory: "",
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
				expect(route.mode, result.text).toBe(mode);
				const actual = route.assignments.map(
					(assignment) => assignment.agentId,
				);
				expect(
					mode === "relay" ? actual : actual.toSorted(),
					result.text,
				).toEqual(mode === "relay" ? recipients : recipients.toSorted());
				for (const assignment of route.assignments)
					expect(assignment.projectIds, result.text).toEqual([]);
			},
			40_000,
		);
	});
