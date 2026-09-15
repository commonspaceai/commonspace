import { describe, expect, it } from "vitest";
import {
	publicationRetryDelay,
	verifyPublishedPackage,
} from "../scripts/verify-npm-publication.mjs";

describe("npm publication verification", () => {
	it("waits only for a missing version within the publication visibility deadline", () => {
		expect(publicationRetryDelay(404, 300_000)).toBe(10_000);
		expect(publicationRetryDelay(404, 250)).toBe(250);
		expect(publicationRetryDelay(200, 0)).toBe(null);
		for (const status of [401, 403, 429, 500])
			expect(() => publicationRetryDelay(status, 300_000)).toThrow();
		for (const remaining of [0, -1])
			expect(() => publicationRetryDelay(404, remaining)).toThrow(
				"five minutes",
			);
	});
	const expected = {
		name: "commonspace",
		version: "0.0.4",
		integrity: "sha512-tested-archive",
	};

	it("accepts only the tested archive under the expected package identity", () => {
		expect(() =>
			verifyPublishedPackage(
				{
					name: "commonspace",
					version: "0.0.4",
					dist: { integrity: expected.integrity },
				},
				expected,
			),
		).not.toThrow();
		for (const metadata of [
			{
				name: "commonspace",
				version: "0.0.4",
				dist: { integrity: "sha512-other-archive" },
			},
			{
				name: "commonspace",
				version: "0.0.3",
				dist: { integrity: expected.integrity },
			},
			{
				name: "another-package",
				version: "0.0.4",
				dist: { integrity: expected.integrity },
			},
			{ name: "commonspace", version: "0.0.4" },
			null,
		])
			expect(() => verifyPublishedPackage(metadata, expected)).toThrow();
	});
});
