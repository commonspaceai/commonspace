import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
	classifyNightly,
	isLaterNightly,
	nightlyNotes,
	parseRecommendedNightly,
	prepareNightly,
} from "../scripts/nightly-release.mjs";

const sha = "abcdef0123456789abcdef0123456789abcdef01";
const nightly = prepareNightly({
	version: "0.2.0",
	sha,
	date: new Date("2026-09-28T18:00:00.000Z"),
	runNumber: "42",
	attempt: "1",
});

describe("nightly releases", () => {
	it("gives each run an immutable tag and installable prerelease version", () => {
		expect(nightly).toEqual({
			sha,
			tag: "nightly-2026-09-28-abcdef0-42-1",
			version: "0.2.0-nightly.20260928.gabcdef0.42.1",
		});
		expect(
			prepareNightly({
				version: "0.2.0",
				sha,
				date: new Date("2026-09-28T18:00:00.000Z"),
				runNumber: "42",
				attempt: "2",
			}).tag,
		).not.toBe(nightly.tag);
	});

	it("promotes only complete passing checks and labels failed checks for debugging", () => {
		const green = classifyNightly(nightly, {
			linux: "success",
			macos: "success",
			windows: "success",
		});
		expect(green.status).toBe("nightly-green");
		expect(green.tag).toBe(nightly.tag);

		const broken = classifyNightly(nightly, {
			linux: "success",
			macos: "failure",
			windows: "success",
		});
		expect(broken.status).toBe("nightly-broken");
		expect(broken.tag).toBe("nightly-broken-2026-09-28-abcdef0-42-1");
		expect(
			nightlyNotes(
				{
					...broken,
					runUrl:
						"https://github.com/commonspaceai/commonspace/actions/runs/42",
				},
				"commonspaceai/commonspace",
				`commonspace-${broken.version}.tgz`,
				"a".repeat(64),
			),
		).toContain("not the recommended nightly");
		expect(() =>
			classifyNightly(nightly, { linux: "success", macos: "success" }),
		).toThrow("Every nightly platform");
		expect(() =>
			classifyNightly(nightly, {
				linux: "success",
				macos: "success",
				windows: "cancelled",
			}),
		).toThrow("Every nightly platform");
	});

	it("does not recommend an older run or attempt of the same commit", () => {
		expect(
			isLaterNightly(
				"nightly-2026-09-29-abcdef0-43-1",
				"nightly-2026-09-28-abcdef0-42-2",
			),
		).toBe(true);
		expect(
			isLaterNightly(
				"nightly-2026-09-28-abcdef0-42-2",
				"nightly-2026-09-28-abcdef0-42-1",
			),
		).toBe(true);
		expect(
			isLaterNightly(
				"nightly-2026-09-28-abcdef0-41-2",
				"nightly-2026-09-29-abcdef0-42-1",
			),
		).toBe(false);
	});

	it("reads the recommendation from its release notes", () => {
		const notes = `# Latest recommended nightly\n\nRecommended build: \`${nightly.tag}\` at \`${sha}\`.\n`;
		expect(parseRecommendedNightly(notes)).toEqual({ tag: nightly.tag, sha });
		expect(() =>
			parseRecommendedNightly("# Latest recommended nightly\n"),
		).toThrow("Invalid recommended nightly notes");
	});

	it("publishes only after the package and platform jobs finish", async () => {
		const workflow = parse(
			await readFile(
				new URL("../.github/workflows/nightly.yml", import.meta.url),
				"utf8",
			),
		);
		expect(workflow.on.schedule[0].cron).toBe("0 18 * * *");
		expect(workflow.jobs.publish.needs).toEqual([
			"prepare",
			"linux",
			"macos",
			"windows",
		]);
		expect(workflow.jobs.publish.permissions).toEqual({ contents: "write" });
		expect(workflow.jobs.windows.needs).toContain("linux");
		const eventSha = `\${{ github.sha }}`;
		for (const job of Object.values(workflow.jobs)) {
			for (const step of job.steps) {
				if (step.uses?.startsWith("actions/checkout@"))
					expect(step.with.ref).toBe(eventSha);
			}
		}
		for (const step of workflow.jobs.publish.steps) {
			if (step.env?.SHA !== undefined) expect(step.env.SHA).toBe(eventSha);
		}
		expect(
			workflow.jobs.publish.steps.find(
				(step) => step.name === "Update recommended nightly",
			).if,
		).toBe("steps.classify.outputs.status == 'nightly-green'");
	});

	it("keeps nightly releases out of stable npm publication", async () => {
		const workflow = parse(
			await readFile(
				new URL("../.github/workflows/release.yml", import.meta.url),
				"utf8",
			),
		);
		expect(workflow.jobs.verify.if).toContain(
			"github.event_name == 'workflow_dispatch'",
		);
		expect(workflow.jobs.verify.if).toContain(
			"startsWith(github.event.release.tag_name, 'v')",
		);
	});
});
