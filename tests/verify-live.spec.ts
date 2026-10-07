import { describe, expect, it } from "vitest";
import { findStartupUrl } from "../scripts/startup-output.mjs";

describe("live verifier startup output", () => {
	it("finds a Vite preview URL in ANSI-colored output", () => {
		const output =
			"\u001b[32m➜\u001b[39m  \u001b[1mLocal\u001b[22m:   \u001b[36mhttp://127.0.0.1:\u001b[1m33351\u001b[22m/\u001b[39m";

		expect(findStartupUrl(output, /Local:\s+(http:\/\/127\.0\.0\.1:\d+)/)).toBe(
			"http://127.0.0.1:33351",
		);
	});

	it("keeps matching plain server output", () => {
		expect(
			findStartupUrl(
				"Commonspace is running at http://127.0.0.1:47321",
				/Commonspace is running at (http:\/\/127\.0\.0\.1:\d+)/,
			),
		).toBe("http://127.0.0.1:47321");
	});
});
