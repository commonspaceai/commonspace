// @vitest-environment node

import { expect, it } from "vitest";

it("blocks accidental calls to external services", async () => {
	await expect(fetch("https://example.test/path")).rejects.toThrow(
		"External network access is disabled in tests (https://example.test)",
	);
});
