import type { Dirent } from "node:fs";
import { readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import type {
	CommonspaceBootstrap,
	CommonspaceMessage,
	CommonspaceSearchHighlight,
	CommonspaceSearchKind,
	CommonspaceSearchRequest,
	CommonspaceSearchResponse,
	CommonspaceSearchResult,
	CommonspaceState,
	CommonspaceTraceEntry,
	ConversationRef,
} from "@commonspace/shared";
import {
	COMMONSPACE_SEARCH_KINDS,
	referencedProjectIds,
} from "@commonspace/shared";

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;
const MAX_FILE_ENTRIES_SCANNED = 3_000;
const MAX_FILE_RESULTS = 40;

interface Candidate extends Omit<CommonspaceSearchResult, "highlights"> {
	searchText?: string;
}

function normalized(value: string): string {
	return value.normalize("NFKC").toLocaleLowerCase();
}

function terms(query: string): string[] {
	return [...new Set(normalized(query).trim().split(/\s+/u).filter(Boolean))];
}

function highlightRanges(
	title: string,
	detail: string,
	includedTerms: readonly string[],
): CommonspaceSearchHighlight[] {
	const ranges: CommonspaceSearchHighlight[] = [];
	for (const [field, value] of [
		["title", title],
		["detail", detail],
	] as const) {
		const searchable = normalized(value);
		for (const term of includedTerms) {
			const start = searchable.indexOf(term);
			if (start >= 0) ranges.push({ field, start, end: start + term.length });
		}
	}
	return ranges.sort(
		(left, right) =>
			left.field.localeCompare(right.field) || left.start - right.start,
	);
}

function traceText(
	entry: CommonspaceTraceEntry,
): { title: string; detail: string } | null {
	if (entry.type === "reasoning")
		return { title: "Reasoning trace", detail: entry.text };
	if (entry.type === "plan")
		return {
			title: "Plan trace",
			detail:
				entry.markdown ?? entry.steps.map((step) => step.text).join(" · "),
		};
	if (entry.type === "tool")
		return {
			title: entry.title,
			detail: [entry.toolName, entry.input, entry.output]
				.filter(Boolean)
				.join(" · "),
		};
	return null;
}

function conversationLabel(
	conversation: ConversationRef,
	bootstrap: CommonspaceBootstrap,
): string {
	if (conversation.kind === "channel") {
		return `#${bootstrap.state.channels.find((channel) => channel.id === conversation.id)?.name ?? conversation.id}`;
	}
	return (
		bootstrap.agents.find((agent) => agent.id === conversation.id)
			?.displayName ?? conversation.id
	);
}

function projectsForMessage(
	message: CommonspaceMessage,
	state: CommonspaceState,
): string[] {
	const direct = referencedProjectIds(message);
	if (direct.length > 0 || message.threadId === undefined) return direct;
	const thread = state.threads.find(
		(candidate) => candidate.id === message.threadId,
	);
	return thread === undefined ? [] : referencedProjectIds(thread);
}

function candidateProjectFields(
	projectIds: readonly string[],
): Pick<Candidate, "projectIds" | "projectId"> {
	const fields: Pick<Candidate, "projectIds" | "projectId"> = {};
	const primaryProjectId = projectIds[0];
	if (primaryProjectId === undefined) return fields;
	fields.projectIds = [...projectIds];
	fields.projectId = primaryProjectId;
	return fields;
}

function messageTarget(
	message: CommonspaceMessage,
): Extract<Candidate["target"], { kind: "conversation" }> {
	const target: Extract<Candidate["target"], { kind: "conversation" }> = {
		kind: "conversation" as const,
		conversation: message.conversation,
		messageId: message.id,
	};
	if (message.threadId !== undefined) target.threadId = message.threadId;
	return target;
}

function messageCandidates(bootstrap: CommonspaceBootstrap): Candidate[] {
	const results: Candidate[] = [];
	for (const messages of Object.values(bootstrap.state.messages)) {
		for (const message of messages) {
			const location = conversationLabel(message.conversation, bootstrap);
			const projectIds = projectsForMessage(message, bootstrap.state);
			results.push({
				id: `message:${message.id}`,
				kind: message.conversation.kind === "dm" ? "dm" : "message",
				title: message.authorName,
				detail: message.text,
				receipt: `${location} · ${message.authorName} · ${message.createdAt}`,
				occurredAt: message.createdAt,
				...candidateProjectFields(projectIds),
				target: messageTarget(message),
			});
			for (const attachment of [
				...(message.files ?? []).map((file) => ({
					id: file.id,
					name: file.name,
					mimeType: file.mimeType,
					size: file.size,
				})),
				...(message.attachments ?? []).map((image) => ({
					id: image.id,
					name: image.name,
					mimeType: image.mimeType,
					size: image.size,
				})),
			]) {
				results.push({
					id: `attachment:${attachment.id}`,
					kind: "file",
					title: attachment.name,
					detail: `${attachment.mimeType} · ${String(attachment.size)} bytes`,
					receipt: `${location} · ${message.authorName} attachment · ${message.createdAt}`,
					occurredAt: message.createdAt,
					...candidateProjectFields(projectIds),
					target: messageTarget(message),
					searchText: `${attachment.name} ${attachment.mimeType} ${message.authorName}`,
				});
			}
			if (message.authorType === "agent") {
				const status = message.replyStatus ?? "complete";
				results.push({
					id: `run:${message.id}`,
					kind: "run",
					title: `${message.authorName} run · ${status}`,
					detail: message.replyError ?? message.text,
					receipt: `${location} · run ${status} · ${message.trace?.completedAt ?? message.createdAt}`,
					occurredAt: message.trace?.completedAt ?? message.createdAt,
					...candidateProjectFields(projectIds),
					target: messageTarget(message),
					searchText: `${message.authorName} ${status} ${message.replyError ?? ""} ${message.text}`,
				});
			}
			for (const entry of message.trace?.entries ?? []) {
				const trace = traceText(entry);
				if (trace === null) continue;
				results.push({
					id: `trace:${message.id}:${entry.id}`,
					kind: "trace",
					title: trace.title,
					detail: trace.detail,
					receipt: `${location} · ${message.authorName} trace · ${entry.updatedAt}`,
					occurredAt: entry.updatedAt,
					...candidateProjectFields(projectIds),
					target: messageTarget(message),
				});
			}
		}
	}
	return results;
}

function liveActivityCandidates(bootstrap: CommonspaceBootstrap): Candidate[] {
	const messagesById = new Map(
		Object.values(bootstrap.state.messages)
			.flat()
			.map((message) => [message.id, message]),
	);
	const results: Candidate[] = [];
	for (const activity of bootstrap.liveActivities ?? []) {
		const source = messagesById.get(activity.sourceMessageId);
		const projectIds =
			source === undefined ? [] : projectsForMessage(source, bootstrap.state);
		const target: Extract<Candidate["target"], { kind: "conversation" }> = {
			kind: "conversation" as const,
			conversation: activity.conversation,
			messageId: source?.id ?? activity.sourceMessageId,
		};
		if (activity.threadId !== undefined) target.threadId = activity.threadId;
		const location = conversationLabel(activity.conversation, bootstrap);
		const latest = activity.entries.at(-1);
		results.push({
			id: `live-run:${activity.id}`,
			kind: "run",
			title: `${activity.agentName} run · running`,
			detail: latest?.type === "tool" ? latest.title : "Working…",
			receipt: `${location} · run running · ${activity.startedAt}`,
			occurredAt: activity.startedAt,
			...candidateProjectFields(projectIds),
			target,
			searchText: `${activity.agentName} running ${activity.entries.map((entry) => JSON.stringify(entry)).join(" ")}`,
		});
		for (const entry of activity.entries) {
			const trace = traceText(entry);
			if (trace === null) continue;
			results.push({
				id: `live-trace:${activity.id}:${entry.id}`,
				kind: "trace",
				title: trace.title,
				detail: trace.detail,
				receipt: `${location} · ${activity.agentName} live trace · ${entry.updatedAt}`,
				occurredAt: entry.updatedAt,
				...candidateProjectFields(projectIds),
				target,
			});
		}
	}
	return results;
}

function memoryCandidates(bootstrap: CommonspaceBootstrap): Candidate[] {
	const results: Candidate[] = [];
	for (const channel of bootstrap.state.channels) {
		const projectIds = [
			...new Set(
				bootstrap.state.threads
					.filter((thread) => thread.channelId === channel.id)
					.flatMap((thread) => referencedProjectIds(thread)),
			),
		];
		const target = {
			kind: "conversation" as const,
			conversation: { kind: "channel" as const, id: channel.id },
		};
		results.push({
			id: `channel:${channel.id}`,
			kind: "channel",
			title: `#${channel.name}`,
			detail: channel.instructions || "Channel",
			receipt: `Channel · #${channel.name}`,
			...candidateProjectFields(projectIds),
			target,
		});
		if (channel.memory.summary.trim() !== "") {
			const candidate: Candidate = {
				id: `brief:${channel.id}`,
				kind: "brief",
				title: `#${channel.name} brief`,
				detail: channel.memory.summary,
				receipt: `#${channel.name} · brief · ${channel.memory.updatedAt ?? "saved"}`,
				...candidateProjectFields(projectIds),
				target,
			};
			if (channel.memory.updatedAt !== null)
				candidate.occurredAt = channel.memory.updatedAt;
			results.push(candidate);
		}
		channel.memory.decisions.forEach((decision, index) => {
			const candidate: Candidate = {
				id: `decision:${channel.id}:${String(index)}`,
				kind: "decision",
				title: `Decision in #${channel.name}`,
				detail: decision,
				receipt: `#${channel.name} · decision · ${channel.memory.updatedAt ?? "saved"}`,
				...candidateProjectFields(projectIds),
				target,
			};
			if (channel.memory.updatedAt !== null)
				candidate.occurredAt = channel.memory.updatedAt;
			results.push(candidate);
		});
	}
	return results;
}

function agentCandidates(bootstrap: CommonspaceBootstrap): Candidate[] {
	return bootstrap.agents.map((agent) => ({
		id: `agent:${agent.id}`,
		kind: "agent",
		title: agent.displayName,
		detail: [agent.description, agent.adapter, agent.model, agent.status]
			.filter(Boolean)
			.join(" · "),
		receipt: `Agent · ${agent.adapter} · ${agent.status}`,
		target: { kind: "agent", agentId: agent.id },
	}));
}

function projectCandidates(bootstrap: CommonspaceBootstrap): Candidate[] {
	return bootstrap.state.projects.map((project) => ({
		id: `project:${project.id}`,
		kind: "project",
		title: project.name,
		detail: `${project.paths.length} ${project.paths.length === 1 ? "folder" : "folders"}`,
		receipt: "Project",
		...candidateProjectFields([project.id]),
		target: { kind: "project", projectId: project.id },
	}));
}

function searchKindPriority(kind: CommonspaceSearchKind): number {
	switch (kind) {
		case "message":
		case "dm":
			return 4;
		case "channel":
		case "agent":
		case "project":
			return 3;
		case "run":
			return 2;
		case "file":
		case "decision":
		case "brief":
			return 1;
		case "trace":
			return 0;
	}
}

async function fileCandidates(
	state: CommonspaceState,
	includedTerms: readonly string[],
	projectFilter?: string,
): Promise<Candidate[]> {
	if (includedTerms.length === 0) return [];
	const results: Candidate[] = [];
	let scanned = 0;
	for (const project of state.projects) {
		if (projectFilter !== undefined && project.id !== projectFilter) continue;
		for (let rootIndex = 0; rootIndex < project.paths.length; rootIndex += 1) {
			let root: string;
			const projectPath = project.paths[rootIndex];
			if (projectPath === undefined) continue;
			try {
				root = await realpath(projectPath);
			} catch {
				continue;
			}
			const pending: Array<{ absolute: string; relative: string }> = [
				{ absolute: root, relative: "" },
			];
			while (
				pending.length > 0 &&
				scanned < MAX_FILE_ENTRIES_SCANNED &&
				results.length < MAX_FILE_RESULTS
			) {
				const directory = pending.shift();
				if (directory === undefined) break;
				let entries: Dirent[];
				try {
					entries = await readdir(directory.absolute, { withFileTypes: true });
				} catch {
					continue;
				}
				for (const entry of entries) {
					if (
						scanned >= MAX_FILE_ENTRIES_SCANNED ||
						results.length >= MAX_FILE_RESULTS
					)
						break;
					scanned += 1;
					if (entry.name === ".git" || entry.isSymbolicLink()) continue;
					const path =
						directory.relative === ""
							? entry.name
							: `${directory.relative}/${entry.name}`;
					if (entry.isDirectory()) {
						pending.push({
							absolute: join(directory.absolute, entry.name),
							relative: path,
						});
						continue;
					}
					if (!entry.isFile()) continue;
					const searchable = normalized(`${project.name} ${path}`);
					if (!includedTerms.every((term) => searchable.includes(term)))
						continue;
					results.push({
						id: `file:${project.id}:${String(rootIndex)}:${path}`,
						kind: "file",
						title: entry.name,
						detail: path,
						receipt: `${project.name} · root ${String(rootIndex + 1)} · ${path}`,
						projectIds: [project.id],
						projectId: project.id,
						target: {
							kind: "project-file",
							projectId: project.id,
							rootIndex,
							path,
						},
					});
				}
			}
		}
	}
	return results;
}

export async function searchCommonspace(
	bootstrap: CommonspaceBootstrap,
	request: CommonspaceSearchRequest,
): Promise<CommonspaceSearchResponse> {
	const query = request.query.trim().slice(0, 500);
	const includedTerms = terms(query);
	const allowedKinds = new Set<CommonspaceSearchKind>(
		request.kinds?.filter((kind) => COMMONSPACE_SEARCH_KINDS.includes(kind)) ??
			[],
	);
	const hasKindFilter = allowedKinds.size > 0;
	const limit = Math.max(
		1,
		Math.min(MAX_LIMIT, Math.trunc(request.limit ?? DEFAULT_LIMIT)),
	);
	const all = [
		...projectCandidates(bootstrap),
		...memoryCandidates(bootstrap),
		...agentCandidates(bootstrap),
		...messageCandidates(bootstrap),
		...liveActivityCandidates(bootstrap),
		...(!hasKindFilter || allowedKinds.has("file")
			? await fileCandidates(bootstrap.state, includedTerms, request.projectId)
			: []),
	];
	const matching = all
		.filter((candidate) => {
			if (hasKindFilter && !allowedKinds.has(candidate.kind)) return false;
			if (
				request.projectId !== undefined &&
				!(
					candidate.projectIds ??
					(candidate.projectId === undefined ? [] : [candidate.projectId])
				).includes(request.projectId)
			)
				return false;
			if (includedTerms.length === 0)
				return (
					candidate.kind === "channel" ||
					candidate.kind === "agent" ||
					candidate.kind === "project"
				);
			const searchable = normalized(
				`${candidate.title} ${candidate.detail} ${candidate.searchText ?? ""}`,
			);
			return includedTerms.every((term) => searchable.includes(term));
		})
		.map((candidate): CommonspaceSearchResult => {
			const result = { ...candidate };
			delete result.searchText;
			return {
				...result,
				highlights: highlightRanges(result.title, result.detail, includedTerms),
			};
		})
		.sort((left, right) => {
			const leftKindPriority = searchKindPriority(left.kind);
			const rightKindPriority = searchKindPriority(right.kind);
			if (leftKindPriority !== rightKindPriority)
				return rightKindPriority - leftKindPriority;
			const leftTitle = includedTerms.some((term) =>
				normalized(left.title).includes(term),
			)
				? 1
				: 0;
			const rightTitle = includedTerms.some((term) =>
				normalized(right.title).includes(term),
			)
				? 1
				: 0;
			if (leftTitle !== rightTitle) return rightTitle - leftTitle;
			return (
				(right.occurredAt ?? "").localeCompare(left.occurredAt ?? "") ||
				left.id.localeCompare(right.id)
			);
		});
	return {
		query,
		results: matching.slice(0, limit),
		appliedFilters: {
			kinds: [...allowedKinds],
			projectId: request.projectId ?? null,
		},
		truncated: matching.length > limit,
	};
}
