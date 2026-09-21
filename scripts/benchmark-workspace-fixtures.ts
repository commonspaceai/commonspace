import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
	CommonspaceAgentProfile,
	CommonspaceMessage,
	CommonspaceState,
} from "@commonspace/shared";
import { agentMentionName } from "@commonspace/shared";
import { projectChannelMemory } from "../server/src/memory.ts";
import type { CommonspaceHostDependencies } from "../server/src/service.ts";
import {
	createInitialState,
	emptyChannelMemory,
	emptyRoutingMemory,
} from "../server/src/state.ts";
import {
	createThreadContext,
	projectThreadMemoryFromMessages,
} from "../server/src/thread-context.ts";

export enum BenchmarkWorkspaceShape {
	Dm = "dm",
	MultiChannel = "multi-channel",
}

const benchmarkAgents: CommonspaceAgentProfile[] = [
	{
		id: "codex",
		displayName: "Benchmark Agent",
		adapter: "codex",
		model: null,
		status: "stopped",
		description: "Synthetic benchmark runtime.",
	},
	{
		id: "claude-code",
		displayName: "Benchmark Reviewer",
		adapter: "claude-code",
		model: null,
		status: "stopped",
	},
	{
		id: "gemini",
		displayName: "Benchmark Builder",
		adapter: "gemini",
		model: null,
		status: "stopped",
	},
];

export const benchmarkDependencies = {
	discoverAgents: async (adapter: CommonspaceAgentProfile["adapter"]) =>
		benchmarkAgents.filter((agent) => agent.adapter === adapter),
	runAgent: async () => ({ text: "Synthetic benchmark reply." }),
	routeAgents: async () => {
		throw new Error("Benchmark acceptance must use explicit routing");
	},
	notify: async () => undefined,
} satisfies Partial<CommonspaceHostDependencies>;

export interface BenchmarkFixture {
	state: CommonspaceState;
	files: { id: string; data: Buffer }[];
}

const createdAt = "2026-01-01T00:00:00.000Z";

function timestamp(index: number): string {
	return new Date(Date.parse(createdAt) + index).toISOString();
}

function message(index: number): CommonspaceMessage {
	const userTurn = index % 2 === 0;
	return {
		id: `benchmark-message-${String(index)}`,
		conversation: { kind: "dm", id: "codex" },
		authorType: userTurn ? "user" : "agent",
		authorId: userTurn ? "user" : "codex",
		authorName: userTurn ? "You" : "Benchmark Agent",
		text: `Synthetic benchmark needle message ${String(index)} with stable transcript content.`,
		createdAt: timestamp(index),
		...(userTurn
			? { replyStatus: "complete" }
			: { sourceMessageId: `benchmark-message-${String(index - 1)}` }),
	};
}

function addCorrectionAndAttachment(
	fixture: BenchmarkFixture,
	threadIndex: number,
	request: CommonspaceMessage,
): void {
	if (request.routing === undefined || request.threadId === undefined)
		throw new Error("Benchmark correction needs a routed Thread request");
	const assignment = request.routing.assignments[0];
	if (assignment === undefined)
		throw new Error("Benchmark correction needs an assignment");
	const { state, files } = fixture;
	const previousAgent = benchmarkAgents[(threadIndex + 1) % 3];
	if (previousAgent === undefined)
		throw new Error("Missing benchmark correction Agent");
	const previousAssignmentId = `previous-${assignment.id}`;
	request.routing.agentIds.push(previousAgent.id);
	request.routing.assignments.push({
		id: previousAssignmentId,
		agentId: previousAgent.id,
		projectIds: assignment.projectIds,
	});
	request.routing.corrections.push({
		id: `correction-${request.id}`,
		fromAssignmentId: previousAssignmentId,
		toAssignmentId: assignment.id,
		createdAt: request.createdAt,
	});
	const id = `10000000-0000-4000-8000-${String(threadIndex + 1).padStart(12, "0")}`;
	const data = Buffer.alloc(4096, threadIndex % 256);
	request.files = [
		{
			id,
			name: `benchmark-${String(threadIndex)}.bin`,
			mimeType: "application/octet-stream",
			size: data.length,
		},
	];
	files.push({ id, data });
	state.pins.push({
		id: `pin-${String(threadIndex)}`,
		scope: { kind: "thread", id: request.threadId },
		kind: "attachment",
		messageId: request.id,
		attachmentId: id,
		createdAt: request.createdAt,
		removedAt: null,
	});
}

function updateChannelProjection(
	state: CommonspaceState,
	channelId: string,
): void {
	const channel = state.channels.find((entry) => entry.id === channelId);
	if (channel === undefined) throw new Error("Missing benchmark Channel");
	const threads = state.threads
		.filter((entry) => entry.channelId === channelId)
		.slice(-state.defaults.memoryThreads);
	const threadIds = new Set(threads.map((thread) => thread.id));
	const key = `channel:${channelId}`;
	const messages = (state.messages[key] ?? []).filter(
		(entry) => entry.threadId !== undefined && threadIds.has(entry.threadId),
	);
	// Project only recent complete Threads during fixture preparation; retain the full transcript in state.
	channel.memory = projectChannelMemory(
		{ ...state, threads, messages: { [key]: messages } },
		channelId,
	);
}

function addThread(
	fixture: BenchmarkFixture,
	threadIndex: number,
	startIndex: number,
	pairCount: number,
): void {
	const { state } = fixture;
	const channel =
		state.channels[(threadIndex + Math.floor(threadIndex / 4)) % 4];
	if (channel === undefined) throw new Error("Missing benchmark Channel");
	const threadId = `20000000-0000-4000-8000-${String(threadIndex + 1).padStart(12, "0")}`;
	const rootMessageId = `benchmark-message-${String(startIndex)}`;
	const project = state.projects[threadIndex % 3];
	const otherProject = state.projects[(threadIndex + 1) % 3];
	if (project === undefined || otherProject === undefined)
		throw new Error("Missing benchmark Project");
	const projectIds = [project.id, otherProject.id];
	const messages: CommonspaceMessage[] = [];
	for (let pair = 0; pair < pairCount; pair += 1) {
		const index = startIndex + pair * 2;
		const agent = benchmarkAgents[(threadIndex + pair) % 3];
		if (agent === undefined) throw new Error("Missing benchmark Agent");
		const request = message(index);
		request.text = `@${agentMentionName(agent)} ${request.text}`;
		request.conversation = { kind: "channel", id: channel.id };
		request.threadId = threadId;
		request.projectIds = projectIds;
		request.projectId = project.id;
		if (pair > 0) request.parentMessageId = rootMessageId;
		const assignmentId = `assignment-${String(index)}`;
		request.routing = {
			source: "explicit",
			mode: "parallel",
			status: "resolved",
			startedAt: request.createdAt,
			resolvedAt: request.createdAt,
			durationMs: 0,
			agentIds: [agent.id],
			assignments: [
				{
					id: assignmentId,
					agentId: agent.id,
					projectIds,
				},
			],
			corrections: [],
			inferredProjectIds: [],
			reason: "Synthetic explicit assignment.",
		};
		if (pair === 0 && threadIndex % 5 === 0)
			addCorrectionAndAttachment(fixture, threadIndex, request);
		const reply = message(index + 1);
		reply.conversation = request.conversation;
		reply.threadId = threadId;
		reply.parentMessageId = rootMessageId;
		reply.authorId = agent.id;
		reply.authorName = agent.displayName;
		reply.projectIds = projectIds;
		reply.projectId = project.id;
		reply.routingAssignmentId = assignmentId;
		reply.trace = {
			adapter: agent.adapter,
			startedAt: request.createdAt,
			completedAt: reply.createdAt,
			entries: [
				{
					type: "tool",
					id: `tool-${String(index)}`,
					title: "Inspect benchmark fixture",
					toolName: "read_file",
					status: "completed",
					input: "Synthetic fixture input.",
					output: "Synthetic benchmark activity output.",
					createdAt: request.createdAt,
					updatedAt: reply.createdAt,
				},
			],
		};
		messages.push(request, reply);
	}
	const channelMessages = state.messages[`channel:${channel.id}`];
	if (channelMessages === undefined)
		throw new Error("Missing benchmark Channel transcript");
	channelMessages.push(...messages);
	state.threads.push({
		id: threadId,
		channelId: channel.id,
		projectIds,
		projectId: projectIds[0] ?? null,
		rootMessageId,
		agentIds: benchmarkAgents.map((agent) => agent.id),
		context: {
			...createThreadContext(channel.memory, timestamp(startIndex)),
			memory: projectThreadMemoryFromMessages(messages),
		},
		createdAt: timestamp(startIndex),
	});
	updateChannelProjection(state, channel.id);
}

export function createBenchmarkFixture(
	shape: BenchmarkWorkspaceShape,
	messageCount: number,
	root: string,
): BenchmarkFixture {
	if (
		!Number.isSafeInteger(messageCount) ||
		messageCount < 2 ||
		messageCount % 2 !== 0
	)
		throw new Error("Benchmark message count must be a positive even integer");
	const state = createInitialState();
	state.revision = messageCount;
	state.agents = (
		shape === BenchmarkWorkspaceShape.Dm
			? benchmarkAgents.slice(0, 1)
			: benchmarkAgents
	).map((agent) => ({
		id: agent.id,
		displayName: agent.displayName,
		adapter: agent.adapter,
		model: agent.model,
		createdAt,
	}));
	const fixture: BenchmarkFixture = { state, files: [] };
	if (shape === BenchmarkWorkspaceShape.Dm) {
		state.messages["dm:codex"] = Array.from(
			{ length: messageCount },
			(_, index) => message(index),
		);
		return fixture;
	}
	state.projects = Array.from({ length: 3 }, (_, index) => {
		const id = `benchmark-project-${String(index)}`;
		return {
			id,
			name: `Benchmark Project ${String(index)}`,
			paths: [join(root, "projects", id)],
			createdAt,
		};
	});
	state.channels = Array.from({ length: 4 }, (_, index) => ({
		id: `benchmark-channel-${String(index)}`,
		name: `benchmark-${String(index)}`,
		agentIds: state.agents.map((agent) => agent.id),
		instructions: "Use synthetic workspace context.",
		memory: emptyChannelMemory(),
		routingMemory: emptyRoutingMemory(),
		createdAt,
	}));
	for (const channel of state.channels)
		state.messages[`channel:${channel.id}`] = [];
	let index = 0;
	let threadIndex = 0;
	while (index < messageCount) {
		for (const length of [1, 3, 8, 16]) {
			if (index >= messageCount) break;
			const pairCount = Math.min(length, (messageCount - index) / 2);
			addThread(fixture, threadIndex, index, pairCount);
			index += pairCount * 2;
			threadIndex += 1;
		}
	}
	for (const channel of state.channels) {
		channel.memory = projectChannelMemory(state, channel.id);
		const corrections = (state.messages[`channel:${channel.id}`] ?? []).flatMap(
			(entry) => entry.routing?.corrections ?? [],
		);
		channel.routingMemory = {
			summary: "Prefer corrected synthetic assignments for related work.",
			status: "current",
			correctionCount: corrections.length,
			compactedThroughCorrectionId: corrections.at(-1)?.id ?? null,
			updatedAt: corrections.at(-1)?.createdAt ?? createdAt,
		};
	}
	return fixture;
}

export async function writeBenchmarkFixture(
	root: string,
	fixture: BenchmarkFixture,
): Promise<void> {
	await mkdir(root, { recursive: true });
	for (const project of fixture.state.projects) {
		for (const path of project.paths) await mkdir(path, { recursive: true });
	}
	await mkdir(join(root, "attachments"), { recursive: true, mode: 0o700 });
	for (const file of fixture.files)
		await writeFile(join(root, "attachments", file.id), file.data, {
			mode: 0o600,
		});
	await writeFile(join(root, "state.json"), JSON.stringify(fixture.state), {
		mode: 0o600,
	});
}

export function benchmarkWorkspaceCounts(state: CommonspaceState) {
	const messages = Object.values(state.messages).flat();
	return {
		messages: messages.length,
		agents: state.agents.length,
		channels: state.channels.length,
		threads: state.threads.length,
		projects: state.projects.length,
		pins: state.pins.length,
		routingReceipts: messages.filter((entry) => entry.routing !== undefined)
			.length,
		corrections: messages.reduce(
			(total, entry) => total + (entry.routing?.corrections.length ?? 0),
			0,
		),
		activityEntries: messages.reduce(
			(total, entry) => total + (entry.trace?.entries.length ?? 0),
			0,
		),
		attachments: messages.reduce(
			(total, entry) => total + (entry.files?.length ?? 0),
			0,
		),
		attachmentBytes: messages.reduce(
			(total, entry) =>
				total +
				(entry.files ?? []).reduce((bytes, file) => bytes + file.size, 0),
			0,
		),
	};
}
