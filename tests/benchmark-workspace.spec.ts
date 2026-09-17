import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
	BenchmarkWorkspaceShape,
	benchmarkDependencies,
	createBenchmarkFixture,
	writeBenchmarkFixture,
} from "../scripts/benchmark-workspace-fixtures.ts";
import { searchCommonspace } from "../server/src/search.ts";
import { CommonspaceHostService } from "../server/src/service.ts";

const roots: string[] = [];
const services: CommonspaceHostService[] = [];

afterEach(async () => {
	await Promise.all(services.splice(0).map((service) => service.close()));
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

it("restores a new Thread after capturing a clipped Channel projection", async () => {
	const root = await mkdtemp(join(tmpdir(), "commonspace-benchmark-context-"));
	const targetRoot = await mkdtemp(
		join(tmpdir(), "commonspace-benchmark-context-target-"),
	);
	roots.push(root, targetRoot);
	const fixture = createBenchmarkFixture(
		BenchmarkWorkspaceShape.MultiChannel,
		10000,
		root,
	);
	await writeBenchmarkFixture(root, fixture);
	const source = new CommonspaceHostService(
		{},
		{ root },
		benchmarkDependencies,
	);
	const target = new CommonspaceHostService(
		{},
		{ root: targetRoot },
		benchmarkDependencies,
	);
	services.push(source, target);
	await source.initialize();
	await source.send({
		conversation: { kind: "channel", id: "benchmark-channel-0" },
		text: "@benchmark-agent Synthetic benchmark acceptance turn.",
	});
	await source.whenIdle();
	const mappings: Record<string, string[]> = {};
	for (const project of fixture.state.projects) {
		const path = join(targetRoot, project.id);
		await mkdir(path);
		mappings[project.id] = [path];
	}
	await target.initialize();
	const archive = await source.exportWorkspace();
	await expect(
		target.importWorkspace(JSON.parse(JSON.stringify(archive)), mappings),
	).resolves.toBeDefined();
	expect(target.snapshot().threads).toEqual(source.snapshot().threads);
});

it.each([BenchmarkWorkspaceShape.Dm, BenchmarkWorkspaceShape.MultiChannel])(
	"retains the %s benchmark workload through loading and portable restore",
	async (shape) => {
		const root = await mkdtemp(join(tmpdir(), "commonspace-benchmark-test-"));
		const targetRoot = await mkdtemp(
			join(tmpdir(), "commonspace-benchmark-target-"),
		);
		roots.push(root, targetRoot);
		const fixture = createBenchmarkFixture(shape, 120, root);
		await writeBenchmarkFixture(root, fixture);
		const source = new CommonspaceHostService(
			{},
			{ root },
			benchmarkDependencies,
		);
		const target = new CommonspaceHostService(
			{},
			{ root: targetRoot },
			benchmarkDependencies,
		);
		services.push(source, target);
		await source.initialize();
		const loaded = source.snapshot();
		const messages = Object.values(loaded.messages).flat();
		expect(messages).toHaveLength(120);
		expect(loaded.channels).toHaveLength(fixture.state.channels.length);
		expect(loaded.threads).toHaveLength(fixture.state.threads.length);
		expect(loaded.pins).toEqual(fixture.state.pins);
		for (const message of messages) {
			const seeded = Object.values(fixture.state.messages)
				.flat()
				.find((entry) => entry.id === message.id);
			expect(message.routing).toEqual(seeded?.routing);
			expect(message.trace).toEqual(seeded?.trace);
			expect(message.files).toEqual(seeded?.files);
		}
		if (shape === BenchmarkWorkspaceShape.MultiChannel) {
			expect(loaded.channels).toHaveLength(4);
			expect(loaded.projects).toHaveLength(3);
			expect(
				new Set(
					loaded.threads.map(
						(thread) =>
							messages.filter((message) => message.threadId === thread.id)
								.length,
					),
				).size,
			).toBeGreaterThan(1);
			expect(
				messages.some(
					(message) => (message.routing?.corrections.length ?? 0) > 0,
				),
			).toBe(true);
			expect(
				messages.some((message) => (message.projectIds?.length ?? 0) > 1),
			).toBe(true);
			expect(fixture.files.length).toBeGreaterThan(0);
			for (const thread of loaded.threads) {
				expect(
					messages.find((message) => message.id === thread.rootMessageId)
						?.threadId,
				).toBe(thread.id);
				expect(thread.context.memory.sourceMessageCount).toBeGreaterThan(0);
			}
			expect(
				loaded.threads.some(
					(thread) => thread.context.channelSnapshot.summary !== "",
				),
			).toBe(true);
		}
		const results = await searchCommonspace(await source.bootstrap(), {
			query: "benchmark needle",
			limit: 24,
		});
		expect(results.results).toHaveLength(24);
		const archive = await source.exportWorkspace();
		expect(archive.attachments.map((attachment) => attachment.data)).toEqual(
			fixture.files.map((file) => file.data.toString("base64")),
		);
		await target.initialize();
		const targetFixture = createBenchmarkFixture(shape, 120, targetRoot);
		for (const project of targetFixture.state.projects) {
			for (const path of project.paths) await mkdir(path, { recursive: true });
		}
		await target.importWorkspace(
			JSON.parse(JSON.stringify(archive)),
			Object.fromEntries(
				targetFixture.state.projects.map((project) => [
					project.id,
					project.paths,
				]),
			),
		);
		const restored = target.snapshot();
		expect(restored.messages).toEqual(loaded.messages);
		expect(restored.threads).toEqual(loaded.threads);
		expect(restored.pins).toEqual(loaded.pins);
		for (const file of fixture.files) {
			expect((await target.readFileAttachment(file.id)).data).toEqual(
				file.data,
			);
		}
	},
);
