import type { Dirent } from "node:fs";
import { readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import type {
	CommonspaceBootstrap,
	CommonspaceLiveAgentActivity,
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

type CandidateSource =
	| "project"
	| "memory"
	| "agent"
	| "message"
	| "live-activity"
	| "filesystem";

const CANDIDATE_SOURCES_BY_KIND = {
	project: ["project"],
	channel: ["memory"],
	message: ["message"],
	dm: ["message"],
	agent: ["agent"],
	trace: ["message", "live-activity"],
	file: ["message", "filesystem"],
	decision: ["memory"],
	run: ["message", "live-activity"],
	brief: ["memory"],
} satisfies Record<CommonspaceSearchKind, readonly CandidateSource[]>;

interface Candidate extends Omit<CommonspaceSearchResult, "highlights"> {
	searchText?: string;
}

type CandidateKindSelection = ReadonlySet<CommonspaceSearchKind> | undefined;

function kindIsSelected(
	selection: CandidateKindSelection,
	kind: CommonspaceSearchKind,
): boolean {
	return selection === undefined || selection.has(kind);
}

function candidateSourceIsSelected(
	selection: CandidateKindSelection,
	source: CandidateSource,
): boolean {
	return (
		selection === undefined ||
		[...selection].some((kind) =>
			CANDIDATE_SOURCES_BY_KIND[kind].some(
				(candidateSource) => candidateSource === source,
			),
		)
	);
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

function messageAttachmentCandidates(
	message: CommonspaceMessage,
	location: string,
	projectIds: readonly string[],
): Candidate[] {
	return [...(message.files ?? []), ...(message.attachments ?? [])].map(
		(attachment) => ({
			id: `attachment:${attachment.id}`,
			kind: "file",
			title: attachment.name,
			detail: `${attachment.mimeType} · ${String(attachment.size)} bytes`,
			receipt: `${location} · ${message.authorName} attachment · ${message.createdAt}`,
			occurredAt: message.createdAt,
			...candidateProjectFields(projectIds),
			target: messageTarget(message),
			searchText: `${attachment.name} ${attachment.mimeType} ${message.authorName}`,
		}),
	);
}

function messageTraceCandidates(
	message: CommonspaceMessage,
	location: string,
	projectIds: readonly string[],
): Candidate[] {
	const results: Candidate[] = [];
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
	return results;
}

function candidatesForMessage(
	bootstrap: CommonspaceBootstrap,
	message: CommonspaceMessage,
	selectedKinds: CandidateKindSelection,
): Candidate[] {
	const results: Candidate[] = [];
	const location = conversationLabel(message.conversation, bootstrap);
	const projectIds = projectsForMessage(message, bootstrap.state);
	const messageKind = message.conversation.kind === "dm" ? "dm" : "message";
	if (kindIsSelected(selectedKinds, messageKind)) {
		results.push({
			id: `message:${message.id}`,
			kind: messageKind,
			title: message.authorName,
			detail: message.text,
			receipt: `${location} · ${message.authorName} · ${message.createdAt}`,
			occurredAt: message.createdAt,
			...candidateProjectFields(projectIds),
			target: messageTarget(message),
		});
	}
	if (kindIsSelected(selectedKinds, "file"))
		results.push(...messageAttachmentCandidates(message, location, projectIds));
	if (kindIsSelected(selectedKinds, "run") && message.authorType === "agent") {
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
	if (kindIsSelected(selectedKinds, "trace"))
		results.push(...messageTraceCandidates(message, location, projectIds));
	return results;
}

function messageCandidates(
	bootstrap: CommonspaceBootstrap,
	selectedKinds: CandidateKindSelection,
): Candidate[] {
	const results: Candidate[] = [];
	for (const messages of Object.values(bootstrap.state.messages)) {
		for (const message of messages) {
			results.push(...candidatesForMessage(bootstrap, message, selectedKinds));
		}
	}
	return results;
}

function candidatesForLiveActivity(
	bootstrap: CommonspaceBootstrap,
	activity: CommonspaceLiveAgentActivity,
	messagesById: ReadonlyMap<string, CommonspaceMessage>,
	selectedKinds: CandidateKindSelection,
): Candidate[] {
	const results: Candidate[] = [];
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
	if (kindIsSelected(selectedKinds, "run")) {
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
	}
	if (kindIsSelected(selectedKinds, "trace")) {
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

function liveActivityCandidates(
	bootstrap: CommonspaceBootstrap,
	selectedKinds: CandidateKindSelection,
): Candidate[] {
	const messagesById = new Map(
		Object.values(bootstrap.state.messages)
			.flat()
			.map((message) => [message.id, message]),
	);
	const results: Candidate[] = [];
	for (const activity of bootstrap.liveActivities ?? []) {
		results.push(
			...candidatesForLiveActivity(
				bootstrap,
				activity,
				messagesById,
				selectedKinds,
			),
		);
	}
	return results;
}

function memoryCandidates(
	bootstrap: CommonspaceBootstrap,
	selectedKinds: CandidateKindSelection,
): Candidate[] {
	const results: Candidate[] = [];
	const includeChannels = kindIsSelected(selectedKinds, "channel");
	const includeBriefs = kindIsSelected(selectedKinds, "brief");
	const includeDecisions = kindIsSelected(selectedKinds, "decision");
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
		if (includeChannels) {
			results.push({
				id: `channel:${channel.id}`,
				kind: "channel",
				title: `#${channel.name}`,
				detail: channel.instructions || "Channel",
				receipt: `Channel · #${channel.name}`,
				...candidateProjectFields(projectIds),
				target,
			});
		}
		if (includeBriefs && channel.memory.summary.trim() !== "") {
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
		if (includeDecisions) {
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

type SearchProject = CommonspaceState["projects"][number];

interface PendingFileDirectory {
	absolute: string;
	relative: string;
}

interface ProjectRootSearchInput {
	project: SearchProject;
	root: string;
	rootIndex: number;
	includedTerms: readonly string[];
	entryLimit: number;
	resultLimit: number;
}

interface ProjectRootSearchResult {
	candidates: Candidate[];
	scanned: number;
}

interface ProjectDirectorySearchInput {
	directory: PendingFileDirectory;
	entries: readonly Dirent[];
	projectRoot: ProjectRootSearchInput;
	entryLimit: number;
	resultLimit: number;
}

interface ProjectDirectorySearchResult extends ProjectRootSearchResult {
	directories: PendingFileDirectory[];
}

type ProjectEntryMatch =
	| { kind: "directory"; directory: PendingFileDirectory }
	| { kind: "candidate"; candidate: Candidate };

function projectEntryMatch(
	entry: Dirent,
	directory: PendingFileDirectory,
	input: ProjectRootSearchInput,
): ProjectEntryMatch | undefined {
	if (entry.name === ".git" || entry.isSymbolicLink()) return undefined;
	const path =
		directory.relative === ""
			? entry.name
			: `${directory.relative}/${entry.name}`;
	if (entry.isDirectory()) {
		return {
			kind: "directory",
			directory: {
				absolute: join(directory.absolute, entry.name),
				relative: path,
			},
		};
	}
	if (!entry.isFile()) return undefined;
	const searchable = normalized(`${input.project.name} ${path}`);
	if (!input.includedTerms.every((term) => searchable.includes(term)))
		return undefined;
	return {
		kind: "candidate",
		candidate: {
			id: `file:${input.project.id}:${String(input.rootIndex)}:${path}`,
			kind: "file",
			title: entry.name,
			detail: path,
			receipt: `${input.project.name} · root ${String(input.rootIndex + 1)} · ${path}`,
			projectIds: [input.project.id],
			projectId: input.project.id,
			target: {
				kind: "project-file",
				projectId: input.project.id,
				rootIndex: input.rootIndex,
				path,
			},
		},
	};
}

function searchBudgetExhausted(
	scanned: number,
	resultCount: number,
	entryLimit: number,
	resultLimit: number,
): boolean {
	return scanned >= entryLimit || resultCount >= resultLimit;
}

function searchProjectDirectory({
	directory,
	entries,
	projectRoot,
	entryLimit,
	resultLimit,
}: ProjectDirectorySearchInput): ProjectDirectorySearchResult {
	const candidates: Candidate[] = [];
	const directories: PendingFileDirectory[] = [];
	let scanned = 0;
	for (const entry of entries) {
		if (
			searchBudgetExhausted(scanned, candidates.length, entryLimit, resultLimit)
		)
			break;
		scanned += 1;
		const match = projectEntryMatch(entry, directory, projectRoot);
		if (match === undefined) continue;
		if (match.kind === "directory") directories.push(match.directory);
		else candidates.push(match.candidate);
	}
	return { candidates, directories, scanned };
}

async function searchProjectRoot(
	input: ProjectRootSearchInput,
): Promise<ProjectRootSearchResult> {
	const candidates: Candidate[] = [];
	let scanned = 0;
	const pending: PendingFileDirectory[] = [
		{ absolute: input.root, relative: "" },
	];
	for (let cursor = 0; cursor < pending.length; cursor += 1) {
		if (
			searchBudgetExhausted(
				scanned,
				candidates.length,
				input.entryLimit,
				input.resultLimit,
			)
		)
			break;
		const directory = pending[cursor];
		if (directory === undefined) break;
		const entries = await readdir(directory.absolute, {
			withFileTypes: true,
		}).catch(() => undefined);
		if (entries === undefined) continue;
		const directorySearch = searchProjectDirectory({
			directory,
			entries,
			projectRoot: input,
			entryLimit: input.entryLimit - scanned,
			resultLimit: input.resultLimit - candidates.length,
		});
		scanned += directorySearch.scanned;
		pending.push(...directorySearch.directories);
		candidates.push(...directorySearch.candidates);
	}
	return { candidates, scanned };
}

async function fileCandidates(
	state: CommonspaceState,
	includedTerms: readonly string[],
	projectFilter?: string,
): Promise<Candidate[]> {
	if (includedTerms.length === 0) return [];
	const results: Candidate[] = [];
	let scanned = 0;
	const projects =
		projectFilter === undefined
			? state.projects
			: state.projects.filter((project) => project.id === projectFilter);
	for (const project of projects) {
		for (const [rootIndex, path] of project.paths.entries()) {
			if (
				searchBudgetExhausted(
					scanned,
					results.length,
					MAX_FILE_ENTRIES_SCANNED,
					MAX_FILE_RESULTS,
				)
			)
				return results;
			const root = await realpath(path).catch(() => undefined);
			if (root === undefined) continue;
			const rootSearch = await searchProjectRoot({
				project,
				root,
				rootIndex,
				includedTerms,
				entryLimit: MAX_FILE_ENTRIES_SCANNED - scanned,
				resultLimit: MAX_FILE_RESULTS - results.length,
			});
			scanned += rootSearch.scanned;
			results.push(...rootSearch.candidates);
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
	const selectedKinds = hasKindFilter ? allowedKinds : undefined;
	const limit = Math.max(
		1,
		Math.min(MAX_LIMIT, Math.trunc(request.limit ?? DEFAULT_LIMIT)),
	);
	const all: Candidate[] = [];
	if (candidateSourceIsSelected(selectedKinds, "project"))
		all.push(...projectCandidates(bootstrap));
	if (candidateSourceIsSelected(selectedKinds, "memory"))
		all.push(...memoryCandidates(bootstrap, selectedKinds));
	if (candidateSourceIsSelected(selectedKinds, "agent"))
		all.push(...agentCandidates(bootstrap));
	if (candidateSourceIsSelected(selectedKinds, "message"))
		all.push(...messageCandidates(bootstrap, selectedKinds));
	if (candidateSourceIsSelected(selectedKinds, "live-activity"))
		all.push(...liveActivityCandidates(bootstrap, selectedKinds));
	if (candidateSourceIsSelected(selectedKinds, "filesystem"))
		all.push(
			...(await fileCandidates(
				bootstrap.state,
				includedTerms,
				request.projectId,
			)),
		);
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
