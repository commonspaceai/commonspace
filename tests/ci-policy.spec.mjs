import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const repoRoot = new URL("../", import.meta.url);

async function readJson(path) {
	return JSON.parse(await readFile(new URL(path, repoRoot), "utf8"));
}

describe("CI policy", () => {
	it("runs independent checks in parallel and gates on every component", async () => {
		const workflow = parse(
			await readFile(new URL(".github/workflows/ci.yml", repoRoot), "utf8"),
		);
		const requiredJobs = [
			"static",
			"unit",
			"browser",
			"visual",
			"windows",
			"package-windows",
		];

		expect(workflow.jobs.windows.needs).toBeUndefined();
		expect(workflow.jobs["package-windows"].needs).toBe("static");
		expect(workflow.jobs.check).toMatchObject({
			name: "Required CI gate",
			needs: requiredJobs,
		});
	});

	it("keeps branch protection coupled to the aggregate workflow check", async () => {
		const workflow = parse(
			await readFile(new URL(".github/workflows/ci.yml", repoRoot), "utf8"),
		);
		const protection = await readJson(".github/main-branch-protection.json");

		expect(protection.enforce_admins).toBe(false);
		expect(protection.allow_force_pushes).toBe(false);
		expect(protection.required_status_checks).toMatchObject({
			strict: true,
			checks: [{ context: workflow.jobs.check.name, app_id: 15368 }],
		});
	});

	it("makes release tags immutable", async () => {
		const ruleset = await readJson(".github/release-tag-ruleset.json");

		expect(ruleset).toMatchObject({
			target: "tag",
			enforcement: "active",
			bypass_actors: [],
			conditions: { ref_name: { include: ["refs/tags/v*"] } },
		});
		expect(ruleset.rules.map(({ type }) => type).sort()).toEqual([
			"deletion",
			"update",
		]);
	});

	it("keeps the npm environment file within GitHub's writable API contract", async () => {
		const environment = await readJson(".github/npm-release-environment.json");
		const mainPolicy = await readJson(".github/npm-release-main-policy.json");
		const tagPolicy = await readJson(".github/npm-release-tag-policy.json");

		expect(Object.keys(environment).sort()).toEqual([
			"deployment_branch_policy",
			"prevent_self_review",
			"reviewers",
			"wait_timer",
		]);
		expect(environment.deployment_branch_policy).toEqual({
			protected_branches: false,
			custom_branch_policies: true,
		});
		expect([mainPolicy, tagPolicy]).toEqual([
			{ name: "main", type: "branch" },
			{ name: "v*", type: "tag" },
		]);
	});
});
