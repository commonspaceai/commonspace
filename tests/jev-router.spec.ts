import { describe, expect, it } from "vitest";
import type { AiRouteInput } from "../server/src/ai-router.ts";
import {
	buildJevRequest,
	parseJevRoutingResponse,
} from "../server/src/jev-router.ts";

const input: AiRouteInput = {
	text: "Fix expired tokens without changing the UI.",
	context: [],
	routingMemory: "",
	candidates: [
		{
			id: "backend",
			displayName: "Backend",
			description: "APIs and authentication",
			routingScore: 0,
			matchedTerms: [],
		},
		{
			id: "frontend",
			displayName: "Frontend",
			description: "Screens and CSS",
			routingScore: 4,
			matchedTerms: ["UI"],
		},
	],
	projects: [{ id: "api", name: "API" }],
	inferProjects: true,
	maxAgents: 2,
};
const choice = (value: string, confidence = 0.95) => ({
	type: "choice",
	choice: value,
	confidence,
	probabilities: { [value]: 1 },
});
const noul = (value: number) => ({ type: "noul", noul: value });
function response() {
	return {
		model: "jev-1.13.0",
		answers: {
			mode: choice("single"),
			owner: choice("backend"),
			first: choice("backend"),
			"project:backend:api": noul(0.95),
			"project:frontend:api": noul(0.02),
			"needed:backend": noul(0.95),
			"needed:frontend": noul(0.02),
			"next:backend": choice("end"),
			"next:frontend": choice("end"),
		},
	};
}
describe("Jev routing policy", () => {
	it("delivers the original constraint-bearing request to a single semantic owner despite lexical rank", () => {
		const decision = parseJevRoutingResponse(JSON.stringify(response()), input);
		expect(decision.assignments).toEqual([
			{ agentId: "backend", projectIds: ["api"] },
		]);
		expect(decision.mode).toBe("parallel");
	});
	it("keeps every eligible owner available and asks branch questions together", () => {
		const request = buildJevRequest(input, "jev-1.13.0");
		expect(request.questions.owner.criteria).toHaveProperty("backend");
		expect(request.questions).toHaveProperty("project:backend:api");
		expect(request.questions).toHaveProperty("needed:frontend");
	});
	it("fails uncertain ownership visibly instead of guessing or broadcasting", () => {
		const value = response();
		value.answers.owner = choice("backend", 0.4);
		expect(() => parseJevRoutingResponse(JSON.stringify(value), input)).toThrow(
			/uncertain/,
		);
	});
	it("does not treat uncertainty on an unused branch as a single-owner failure", () => {
		const value = response();
		value.answers["needed:frontend"] = noul(0.5);
		expect(
			parseJevRoutingResponse(JSON.stringify(value), input).agentIds,
		).toEqual(["backend"]);
	});
	it("rejects out-of-candidate owners and uncertain Project scope", () => {
		const value = response();
		value.answers.owner = choice("outsider");
		expect(() => parseJevRoutingResponse(JSON.stringify(value), input)).toThrow(
			/owner/,
		);
		value.answers.owner = choice("backend");
		value.answers["project:backend:api"] = noul(0.5);
		expect(() => parseJevRoutingResponse(JSON.stringify(value), input)).toThrow(
			/uncertain/,
		);
	});
	it("returns participant scopes for every independently necessary owner without wording", () => {
		const value = response();
		value.answers.mode = choice("parallel");
		value.answers["needed:frontend"] = noul(0.95);
		const decision = parseJevRoutingResponse(JSON.stringify(value), input);
		expect(decision.agentIds).toEqual(["backend", "frontend"]);
		expect(decision.assignments).toEqual([
			{ agentId: "backend", projectIds: ["api"] },
			{ agentId: "frontend", projectIds: [] },
		]);
	});
	it("rejects relay cycles and keeps the Jev-selected order authoritative", () => {
		const value = response();
		value.answers.mode = choice("relay");
		value.answers["needed:frontend"] = noul(0.95);
		value.answers["next:backend"] = choice("frontend");
		expect(
			parseJevRoutingResponse(JSON.stringify(value), input).agentIds,
		).toEqual(["backend", "frontend"]);
		value.answers["next:frontend"] = choice("backend");
		expect(() => parseJevRoutingResponse(JSON.stringify(value), input)).toThrow(
			/relay/,
		);
	});
	it("selects the first relay speaker independently of single-owner ambiguity", () => {
		const value = response();
		value.answers.mode = choice("relay");
		value.answers.owner = choice("unresolved", 0.4);
		value.answers["needed:frontend"] = noul(0.95);
		value.answers["next:backend"] = choice("frontend");
		expect(
			parseJevRoutingResponse(JSON.stringify(value), input).agentIds,
		).toEqual(["backend", "frontend"]);
	});
});
