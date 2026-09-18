import { describe, expect, it } from "vitest";
import { permitsLiveRoutingRequest } from "./test-setup.ts";

describe("live routing evaluation network boundary", () => {
	it("keeps external requests blocked without an explicit evaluation run", () => {
		expect(
			permitsLiveRoutingRequest(
				new URL("https://api.typesafe.ai/v1/systemone"),
				{
					COMMONSPACE_ROUTING_JEV_MODEL: "jev-1.13.0",
				},
			),
		).toBe(false);
	});
	it("permits only the configured text-provider origin during evaluation", () => {
		const configuration = {
			COMMONSPACE_ROUTING_EVAL: "1",
			COMMONSPACE_ROUTING_BASE_URL: "https://router.example:8443/v1",
		};
		expect(
			permitsLiveRoutingRequest(
				new URL("https://router.example:8443/v1/chat/completions"),
				configuration,
			),
		).toBe(true);
		expect(
			permitsLiveRoutingRequest(
				new URL("https://router.example/v1"),
				configuration,
			),
		).toBe(false);
		expect(
			permitsLiveRoutingRequest(
				new URL("https://unrelated.example"),
				configuration,
			),
		).toBe(false);
	});
	it("permits the canonical TypeSafe origin only when Jev evaluation is selected", () => {
		const endpoint = new URL("https://api.typesafe.ai/v1/systemone");
		expect(
			permitsLiveRoutingRequest(endpoint, { COMMONSPACE_ROUTING_EVAL: "1" }),
		).toBe(false);
		expect(
			permitsLiveRoutingRequest(endpoint, {
				COMMONSPACE_ROUTING_EVAL: "1",
				COMMONSPACE_ROUTING_JEV_MODEL: "jev-1.13.0",
			}),
		).toBe(true);
		expect(
			permitsLiveRoutingRequest(
				new URL("http://api.typesafe.ai/v1/systemone"),
				{
					COMMONSPACE_ROUTING_EVAL: "1",
					COMMONSPACE_ROUTING_JEV_MODEL: "jev-1.13.0",
				},
			),
		).toBe(false);
	});
	it("keeps malformed provider configuration closed", () => {
		expect(
			permitsLiveRoutingRequest(new URL("https://router.example"), {
				COMMONSPACE_ROUTING_EVAL: "1",
				COMMONSPACE_ROUTING_BASE_URL: "invalid",
			}),
		).toBe(false);
	});
});
