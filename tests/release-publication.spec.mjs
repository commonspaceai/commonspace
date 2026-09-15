import { describe, expect, it } from "vitest";
import { releaseCreationRequired } from "../scripts/ensure-github-release.mjs";
import { verifyPublishedPackage } from "../scripts/verify-npm-publication.mjs";

describe("release recovery", () => {
	it("preserves a published release when a manual publication is retried", () => {
		expect(
			releaseCreationRequired(
				200,
				{ tagName: "v0.0.4", isDraft: false },
				"v0.0.4",
			),
		).toBe(false);
		expect(releaseCreationRequired(200, null, "v0.0.4")).toBe(true);
	});

	it("does not treat API failures or unpublished releases as completed recovery", () => {
		for (const status of [401, 403, 404, 429, 500])
			expect(() => releaseCreationRequired(status, null, "v0.0.4")).toThrow();
		for (const release of [
			{ tagName: "v0.0.4", isDraft: true },
			{ tagName: "v0.0.3", isDraft: false },
			undefined,
		])
			expect(() => releaseCreationRequired(200, release, "v0.0.4")).toThrow();
	});
});

describe("npm publication verification", () => {
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
