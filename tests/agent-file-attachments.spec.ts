import { renameSync, symlinkSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { credentialBearingFileName } from "../server/src/credential-files.ts";
import {
	prepareAgentFileAttachments,
	readBoundedAttachmentBytes,
} from "../server/src/file-attachments.ts";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("Agent file attachment copy boundary", () => {
	it("normalizes credential-bearing names before applying policy", () => {
		expect(credentialBearingFileName("auth．json")).toBe(true);
		expect(credentialBearingFileName("report.txt")).toBe(false);
	});

	it("rejects credential-bearing artifact names while accepting a safe file", async () => {
		const root = await mkdtemp(
			join(tmpdir(), "commonspace-agent-file-policy-"),
		);
		roots.push(root);
		const workspace = join(root, "workspace");
		await mkdir(workspace);
		const names = [
			".pypirc",
			"auth.json",
			"id_ecdsa",
			"serviceaccountprod.json",
			"report.txt",
		];
		await Promise.all(
			names.map((name) =>
				writeFile(join(workspace, name), "synthetic test value"),
			),
		);

		const prepared = await prepareAgentFileAttachments(
			names.map((name) => ({
				name,
				uri: pathToFileURL(join(workspace, name)).href,
				mimeType: "text/plain",
			})),
			[await realpath(workspace)],
			() => undefined,
		);

		expect(prepared).toHaveLength(1);
		expect(prepared[0]?.metadata).toMatchObject({
			name: "report.txt",
			mimeType: "text/plain",
			size: 20,
		});
		expect(prepared[0]?.data.toString("utf8")).toBe("synthetic test value");
	});

	it("rejects a file that grows after its validated size", async () => {
		const requestedLengths: number[] = [];
		await expect(
			readBoundedAttachmentBytes(
				{
					read: async (buffer, offset, length) => {
						requestedLengths.push(length);
						buffer.fill(0x61, offset, offset + length);
						return length;
					},
					size: async () => 5,
				},
				4,
			),
		).resolves.toBeNull();
		expect(requestedLengths).toEqual([5]);
	});

	it("does not follow a source replaced after canonical validation", async () => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-agent-file-race-"));
		roots.push(root);
		const workspace = join(root, "workspace");
		await mkdir(workspace);
		const source = join(workspace, "report.txt");
		const original = join(workspace, "original-report.txt");
		const outside = join(root, "outside-credentials.txt");
		await Promise.all([
			writeFile(source, "safe synthetic report"),
			writeFile(outside, "synthetic outside bytes"),
		]);
		const allowedRoots = [workspace];
		const checkRoot = allowedRoots.some.bind(allowedRoots);
		Object.defineProperty(allowedRoots, "some", {
			value: (predicate: Parameters<typeof checkRoot>[0]) => {
				renameSync(source, original);
				symlinkSync(outside, source);
				return checkRoot(predicate);
			},
		});

		await expect(
			prepareAgentFileAttachments(
				[
					{
						name: "report.txt",
						uri: pathToFileURL(source).href,
						mimeType: "text/plain",
					},
				],
				allowedRoots,
				() => undefined,
			),
		).resolves.toEqual([]);
	});
});
