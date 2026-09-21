import {
	type AddPinRequest,
	COMMONSPACE_EXPORT_VERSION,
	COMMONSPACE_SEARCH_KINDS,
	type CommonspaceArchiveAttachment,
	type CommonspaceBootstrap,
	type CommonspaceMessage,
	type CommonspaceMutation,
	CommonspaceMutationSchema,
	type CommonspaceRetentionPreview,
	CommonspaceRoutingProvider,
	type CommonspaceSearchResult,
	type CommonspaceSearchTarget,
	type CommonspaceThreadMemory,
	type CommonspaceWorkspaceArchive,
	type ConversationRef,
	type EditMessageRequest,
	type ProjectFileEntry,
	type RerouteAssignmentRequest,
	type RetryRoutingRequest,
	RoutingConfigurationIssue,
	referencedProjectIds,
	type SendMessageRequest,
	type UpdateRoutingConfigurationRequest,
	type UpdateThreadContextRequest,
} from "@commonspace/shared";
import { HttpResponse, http } from "msw";
import {
	discoveryStoryBootstrap,
	populatedCapabilityInventory,
	runtimeStoryBootstrap,
	storyBootstrap,
} from "./story-fixtures";

/** One disposable workspace per story. Only the HTTP boundary is simulated. */
export function createWorkspaceMockApi(
	scenario:
		| "ready"
		| "empty"
		| "routing-failed"
		| "offline"
		| "queued" = "ready",
) {
	const data: CommonspaceBootstrap = structuredClone(storyBootstrap);
	const now = () => new Date().toISOString();
	const id = () => crypto.randomUUID();
	const uploads = new Map<string, CommonspaceArchiveAttachment>();
	function saveAttachment<Mime extends string>(
		file: { name: string; mimeType: Mime; data: string },
		kind: "image" | "file",
	) {
		const attachment = {
			id: id(),
			name: file.name,
			mimeType: file.mimeType,
			size: atob(file.data).length,
		};
		uploads.set(attachment.id, { ...attachment, kind, data: file.data });
		return attachment;
	}
	const emptyMemory = (): CommonspaceThreadMemory => ({
		summary: "",
		decisions: [],
		openQuestions: [],
		updatedAt: null,
		origin: "user",
		status: "empty",
		sourceMessageCount: 0,
		estimatedTokens: 0,
		compactedThroughMessageId: null,
	});
	const emptyContext = () => ({
		memory: emptyMemory(),
		channelSnapshot: { ...emptyMemory(), capturedAt: now() },
	});
	data.discoveredAgents = structuredClone(
		discoveryStoryBootstrap.discoveredAgents,
	);
	const primaryChannel = data.state.channels[0];
	const primaryAgent = data.agents[0];
	const secondaryAgent = data.agents[1];
	const channelMessages = data.state.messages["channel:channel-design"];
	const root = channelMessages?.[0];
	const reply = channelMessages?.[1];
	if (
		primaryChannel === undefined ||
		primaryAgent === undefined ||
		secondaryAgent === undefined ||
		channelMessages === undefined ||
		root === undefined ||
		root.routing === undefined ||
		reply === undefined ||
		reply.trace === undefined
	)
		throw new Error("Workspace story fixture is incomplete.");
	primaryChannel.name = "general";
	primaryAgent.displayName = "Agentops";
	secondaryAgent.displayName = "Codex";
	for (const agent of data.agents) {
		delete agent.avatarEmoji;
		agent.accentColor = "#9bc4ff";
		agent.status = "stopped";
	}
	data.state.agents = data.agents.map((agent) => ({
		...agent,
		createdAt: now(),
	}));
	root.text = "Are you available to review the agent workflow?";
	root.replyStatus = "complete";
	root.routing.reason =
		"Agentops handles Hermes and local agent infrastructure in this channel.";
	const plainRoot = structuredClone(root);
	delete plainRoot.routing;
	reply.authorName = "Agentops";
	reply.text =
		"I’m here and ready to help with agent workflows, local tooling, and session infrastructure.";
	delete reply.runAttribution;
	reply.trace.entries = reply.trace.entries.filter(
		(entry) => entry.type === "reasoning" || entry.type === "usage",
	);
	for (const entry of reply.trace.entries)
		if (entry.type === "reasoning")
			entry.text =
				"Confirming the response approach. No tools were needed for this reply.";
	channelMessages.unshift(
		{
			...plainRoot,
			id: "greeting",
			text: "Morning, everyone.",
			createdAt: "2026-09-03T09:55:00Z",
		},
		{
			...plainRoot,
			id: "workflow",
			text: "Can you check the agent workflow?",
			createdAt: "2026-09-03T09:56:00Z",
		},
	);
	channelMessages.push({
		...plainRoot,
		id: "followup",
		text: "Let’s keep the conversation here while we work through it.",
		createdAt: "2026-09-03T09:59:55Z",
	});
	for (const message of channelMessages) {
		if (
			message.authorType === "user" &&
			!data.state.threads.some((thread) => thread.rootMessageId === message.id)
		)
			data.state.threads.push({
				id: `thread-${message.id}`,
				channelId: "channel-design",
				rootMessageId: message.id,
				agentIds: [],
				projectId: null,
				projectIds: [],
				context: emptyContext(),
				createdAt: message.createdAt,
			});
	}
	if (scenario === "queued") {
		data.liveActivities = structuredClone(
			runtimeStoryBootstrap.liveActivities ?? [],
		);
		data.queuedFollowups = structuredClone(
			runtimeStoryBootstrap.queuedFollowups ?? [],
		);
		for (const [index, item] of (data.queuedFollowups ?? []).entries()) {
			item.text =
				index === 0
					? "Summarize the changes when you finish."
					: "Then draft the release notes.";
			item.position = index;
			const key = `dm:${item.conversation.id}`;
			const queuedMessages = data.state.messages[key] ?? [];
			data.state.messages[key] = queuedMessages;
			queuedMessages.push({
				id: item.messageId,
				conversation: item.conversation,
				text: item.text,
				authorId: "sample-user",
				authorName: "You",
				authorType: "user",
				createdAt: now(),
				replyStatus: "queued",
				projectIds: [],
			});
		}
	}
	if (scenario === "empty") {
		data.state.channels = [];
		data.state.projects = [];
		data.state.messages = {};
		data.state.threads = [];
		data.state.agents = [];
		data.agents = [];
		data.state.inboxUnreadMessageIds = [];
		data.state.inboxSavedItemIds = [];
		data.state.followedSessionIds = [];
	}
	if (scenario === "routing-failed") {
		root.replyStatus = "failed";
		root.replyError =
			"The routing service did not respond. Retry or choose an agent.";
		root.routing.status = "failed";
		root.routing.agentIds = [];
		root.routing.assignments = [];
		data.state.messages["channel:channel-design"] = channelMessages.filter(
			(message) => message.id !== reply.id,
		);
	}
	const touch = () => {
		data.state.revision += 1;
	};
	const json = <Body>(value: Body) =>
		new HttpResponse(JSON.stringify(value), {
			headers: { "content-type": "application/json" },
		});
	async function trustedRequestJson<Body>(request: Request): Promise<Body> {
		const value = await request.json();
		// biome-ignore lint/nursery/noUnsafeTypeAssertion: This local Storybook boundary only receives requests from the typed Commonspace client.
		return value as Body;
	}
	const messages = () => Object.values(data.state.messages).flat();
	const findMessage = (messageId: string) => {
		const message = messages().find((item) => item.id === messageId);
		if (!message) throw new Error("Mock message no longer exists.");
		return message;
	};
	function setMembership(items: string[], value: string, included: boolean) {
		return included
			? [...new Set([...items, value])]
			: items.filter((item) => item !== value);
	}
	function channelAgentIds(agentIds: readonly string[]): string[] {
		const unique = [...new Set(agentIds)];
		const known = new Set(data.state.agents.map((agent) => agent.id));
		if (unique.some((agentId) => !known.has(agentId)))
			throw new Error("Channel references an unknown Agent.");
		return unique;
	}
	function removeProjectReference(
		message: CommonspaceMessage,
		projectId: string,
	): CommonspaceMessage {
		const previousProjectIds = referencedProjectIds(message);
		const projectIds = previousProjectIds.filter(
			(candidate) => candidate !== projectId,
		);
		const updated = { ...message };
		const primaryProjectId = projectIds[0];
		if (primaryProjectId === undefined) {
			delete updated.projectIds;
			delete updated.projectId;
		} else {
			updated.projectIds = projectIds;
			updated.projectId = primaryProjectId;
		}
		if (updated.runAttribution === undefined) return updated;
		const roots =
			previousProjectIds.length === 1 && previousProjectIds[0] === projectId
				? []
				: updated.runAttribution.roots.filter(
						(root) => root.projectId !== projectId,
					);
		if (roots.length === 0) delete updated.runAttribution;
		else updated.runAttribution = { ...updated.runAttribution, roots };
		return updated;
	}
	function mutate(mutation: CommonspaceMutation) {
		const state = data.state;
		switch (mutation.action) {
			case "mark-inbox-read":
				state.inboxReadAt = now();
				state.inboxUnreadMessageIds = [];
				state.inboxReadMessageIds = messages().map((item) => item.id);
				break;
			case "mark-inbox-item-read":
				state.inboxReadMessageIds = setMembership(
					state.inboxReadMessageIds,
					mutation.messageId,
					true,
				);
				state.inboxUnreadMessageIds = setMembership(
					state.inboxUnreadMessageIds ?? [],
					mutation.messageId,
					false,
				);
				break;
			case "set-inbox-item-unread":
				state.inboxUnreadMessageIds = setMembership(
					state.inboxUnreadMessageIds ?? [],
					mutation.messageId,
					mutation.unread,
				);
				state.inboxReadMessageIds = setMembership(
					state.inboxReadMessageIds,
					mutation.messageId,
					!mutation.unread,
				);
				break;
			case "set-inbox-item-saved":
				state.inboxSavedItemIds = setMembership(
					state.inboxSavedItemIds ?? [],
					mutation.messageId,
					mutation.saved,
				);
				break;
			case "set-session-followed":
				state.followedSessionIds = setMembership(
					state.followedSessionIds ?? [],
					mutation.sessionId,
					mutation.followed,
				);
				break;
			case "set-session-muted":
				state.mutedSessionIds = setMembership(
					state.mutedSessionIds ?? [],
					mutation.sessionId,
					mutation.muted,
				);
				break;
			case "set-notifications":
				state.notifications = mutation.notifications;
				break;
			case "set-defaults": {
				if (mutation.model !== undefined) state.defaults.model = mutation.model;
				if (mutation.reasoning !== undefined)
					state.defaults.reasoning = mutation.reasoning;
				if (mutation.maxAgentsPerTurn !== undefined)
					state.defaults.maxAgentsPerTurn = mutation.maxAgentsPerTurn;
				if (mutation.memoryThreads !== undefined)
					state.defaults.memoryThreads = mutation.memoryThreads;
				break;
			}
			case "create-project":
				state.projects.push({
					id: id(),
					name: mutation.name,
					paths: mutation.paths,
					createdAt: now(),
				});
				break;
			case "add-project-path":
				state.projects
					.find((project) => project.id === mutation.projectId)
					?.paths.push(mutation.path);
				break;
			case "remove-project":
				state.projects = state.projects.filter(
					(project) => project.id !== mutation.projectId,
				);
				state.threads = state.threads.map((thread) => {
					const projectIds = referencedProjectIds(thread).filter(
						(projectId) => projectId !== mutation.projectId,
					);
					return {
						...thread,
						projectIds,
						projectId: projectIds[0] ?? null,
					};
				});
				state.messages = Object.fromEntries(
					Object.entries(state.messages).map(([key, entries]) => [
						key,
						entries.map((message) =>
							removeProjectReference(message, mutation.projectId),
						),
					]),
				);
				break;
			case "create-channel":
				state.channels.push({
					id: id(),
					name: mutation.name,
					agentIds: channelAgentIds(mutation.agentIds),
					instructions: "",
					memory: { ...emptyMemory(), threadIds: [] },
					routingMemory: {
						summary: "",
						status: "empty",
						correctionCount: 0,
						compactedThroughCorrectionId: null,
						updatedAt: null,
					},
					createdAt: now(),
				});
				break;
			case "remove-channel":
				state.channels = state.channels.filter(
					(channel) => channel.id !== mutation.channelId,
				);
				delete state.messages[`channel:${mutation.channelId}`];
				state.threads = state.threads.filter(
					(thread) => thread.channelId !== mutation.channelId,
				);
				break;
			case "set-channel-agents": {
				const channel = state.channels.find(
					(item) => item.id === mutation.channelId,
				);
				if (channel) channel.agentIds = channelAgentIds(mutation.agentIds);
				break;
			}
			case "set-channel-context": {
				const channel = state.channels.find(
					(item) => item.id === mutation.channelId,
				);
				if (channel) channel.instructions = mutation.instructions;
				break;
			}
			case "set-channel-memory":
			case "set-channel-configuration": {
				const channel = state.channels.find(
					(item) => item.id === mutation.channelId,
				);
				if (!channel) throw new Error("Channel not found.");
				channel.memory = {
					summary: mutation.summary,
					decisions: mutation.decisions ?? [],
					openQuestions: mutation.openQuestions ?? [],
					threadIds: [],
					updatedAt: now(),
					origin: "user",
					status: "current",
					sourceMessageCount: 0,
					estimatedTokens: 0,
				};
				if (mutation.action === "set-channel-configuration") {
					channel.agentIds = channelAgentIds(mutation.agentIds);
					channel.instructions = mutation.instructions;
				}
				break;
			}
			case "update-agent-profile": {
				for (const agent of [...data.agents, ...state.agents])
					if (agent.id === mutation.agentId) {
						agent.displayName = mutation.displayName;
						if (mutation.avatarEmoji !== undefined)
							agent.avatarEmoji = mutation.avatarEmoji;
						if (mutation.accentColor !== undefined)
							agent.accentColor = mutation.accentColor;
						if (mutation.fullAccess !== undefined)
							agent.fullAccess = mutation.fullAccess;
					}
				break;
			}
			case "add-discovered-agent": {
				const agent = data.discoveredAgents.find(
					(item) => item.id === mutation.agentId,
				);
				if (!agent) throw new Error("Choose a discovered agent.");
				if (!data.agents.some((item) => item.id === agent.id)) {
					data.agents.push({ ...agent });
					state.agents.push({ ...agent, createdAt: now() });
				}
				break;
			}
			case "remove-agent":
				data.agents = data.agents.filter(
					(agent) => agent.id !== mutation.agentId,
				);
				state.agents = state.agents.filter(
					(agent) => agent.id !== mutation.agentId,
				);
				for (const channel of state.channels)
					channel.agentIds = channel.agentIds.filter(
						(agentId) => agentId !== mutation.agentId,
					);
				for (const thread of state.threads)
					thread.agentIds = thread.agentIds.filter(
						(agentId) => agentId !== mutation.agentId,
					);
				delete state.dmSessions[mutation.agentId];
				delete state.agentSessions[mutation.agentId];
				delete state.messages[`dm:${mutation.agentId}`];
				if (
					data.routing?.provider === CommonspaceRoutingProvider.Harness &&
					data.routing.harnessAgentId === mutation.agentId
				) {
					data.routing = {
						provider: CommonspaceRoutingProvider.Unconfigured,
						reason: RoutingConfigurationIssue.Missing,
						message: "Choose a workspace inference agent.",
					};
				}
				break;
			case "reset-dm":
				state.messages[`dm:${mutation.agentId}`] = [];
				delete state.dmSessions[mutation.agentId];
				break;
		}
		touch();
	}
	function send(request: SendMessageRequest) {
		const key = `${request.conversation.kind}:${request.conversation.id}`;
		const list = data.state.messages[key] ?? [];
		data.state.messages[key] = list;
		const accepted: CommonspaceMessage = {
			id: id(),
			conversation: request.conversation,
			text: request.text,
			authorType: "user",
			authorId: "sample-user",
			authorName: "You",
			createdAt: now(),
			projectIds: request.projectIds ?? [],
			replyStatus: "complete",
		};
		let thread = request.threadId
			? data.state.threads.find((item) => item.id === request.threadId)
			: undefined;
		const agentId =
			request.targetAgentId ??
			(request.conversation.kind === "dm"
				? request.conversation.id
				: data.state.channels.find(
						(item) => item.id === request.conversation.id,
					)?.agentIds[0]);
		const agent = data.agents.find((item) => item.id === agentId);
		if (request.conversation.kind === "channel" && !thread) {
			thread = {
				id: id(),
				channelId: request.conversation.id,
				rootMessageId: accepted.id,
				projectId: accepted.projectIds?.[0] ?? null,
				context: emptyContext(),
				agentIds: agent ? [agent.id] : [],
				projectIds: accepted.projectIds ?? [],
				createdAt: now(),
			};
			data.state.threads.push(thread);
		}
		if (request.threadId && thread) {
			accepted.threadId = thread.id;
			accepted.parentMessageId = thread.rootMessageId;
		}
		if (agent && request.conversation.kind === "channel")
			accepted.routing = {
				source: "explicit",
				status: "resolved",
				agentIds: [agent.id],
				inferredProjectIds: [],
				assignments: [
					{
						id: id(),
						agentId: agent.id,
						projectIds: accepted.projectIds ?? [],
					},
				],
				corrections: [],
				reason: "Preview delivery to the selected channel agent.",
			};
		if (request.attachments?.length)
			accepted.attachments = request.attachments.map((file) =>
				saveAttachment(file, "image"),
			);
		if (request.files?.length)
			accepted.files = request.files.map((file) =>
				saveAttachment(file, "file"),
			);
		list.push(accepted);
		if (agent) {
			const response: CommonspaceMessage = {
				id: id(),
				conversation: request.conversation,
				text: "Got it. I’ll keep the follow-up in this conversation. This is a simulated reply for the Storybook workspace.",
				authorType: "agent",
				authorId: agent.id,
				authorName: agent.displayName,
				createdAt: now(),
				projectIds: accepted.projectIds ?? [],
				sourceMessageId: accepted.id,
				replyStatus: "complete",
			};
			if (thread) {
				response.threadId = thread.id;
				response.parentMessageId = thread.rootMessageId;
			}
			list.push(response);
			data.state.inboxUnreadMessageIds = [
				...(data.state.inboxUnreadMessageIds ?? []),
				response.id,
			];
		}
		touch();
		return { accepted, thread, state: data.state };
	}
	function appendReply(source: CommonspaceMessage, agentId: string) {
		const agent = data.agents.find((item) => item.id === agentId);
		if (!agent) throw new Error("Choose an agent in this workspace.");
		const thread = data.state.threads.find(
			(item) => item.id === source.threadId || item.rootMessageId === source.id,
		);
		if (thread) thread.agentIds = [...new Set([...thread.agentIds, agentId])];
		const response: CommonspaceMessage = {
			id: id(),
			conversation: source.conversation,
			authorId: agentId,
			authorName: agent.displayName,
			authorType: "agent",
			text: "I’ve received the request. This reply is simulated in the preview.",
			createdAt: now(),
			sourceMessageId: source.id,
			projectIds: source.projectIds ?? [],
			replyStatus: "complete",
		};
		if (thread !== undefined) {
			response.threadId = thread.id;
			response.parentMessageId = thread.rootMessageId;
		}
		const key = `${source.conversation.kind}:${source.conversation.id}`;
		const conversationMessages = data.state.messages[key] ?? [];
		data.state.messages[key] = conversationMessages;
		conversationMessages.push(response);
		data.state.inboxUnreadMessageIds = [
			...(data.state.inboxUnreadMessageIds ?? []),
			response.id,
		];
	}
	function retention(
		conversation: ConversationRef,
	): CommonspaceRetentionPreview {
		const list =
			data.state.messages[`${conversation.kind}:${conversation.id}`] ?? [];
		const messageIds = new Set(list.map((message) => message.id));
		const threadIds = new Set(
			conversation.kind === "channel"
				? data.state.threads
						.filter((thread) => thread.channelId === conversation.id)
						.map((thread) => thread.id)
				: [],
		);
		return {
			revision: data.state.revision,
			conversation,
			messages: list.length,
			threads: threadIds.size,
			attachments: list.reduce(
				(count, message) =>
					count +
					(message.attachments?.length ?? 0) +
					(message.files?.length ?? 0),
				0,
			),
			pins: data.state.pins.filter((pin) => {
				const messageId = pin.kind === "note" ? undefined : pin.messageId;
				return (
					(pin.scope.kind === "channel" &&
						conversation.kind === "channel" &&
						pin.scope.id === conversation.id) ||
					(pin.scope.kind === "thread" && threadIds.has(pin.scope.id)) ||
					(messageId !== undefined && messageIds.has(messageId))
				);
			}).length,
			permissions: data.state.permissions.filter((permission) =>
				messageIds.has(permission.sourceMessageId),
			).length,
		};
	}
	function archive(): CommonspaceWorkspaceArchive {
		const {
			version: _version,
			revision: _revision,
			dmSessions: _dm,
			agentSessions: _agents,
			projects,
			...workspace
		} = structuredClone(data.state);
		void _version;
		void _revision;
		void _dm;
		void _agents;
		return {
			format: "commonspace-workspace",
			version: COMMONSPACE_EXPORT_VERSION,
			exportedAt: now(),
			workspace: {
				...workspace,
				projects: projects.map(({ paths, ...project }) => ({
					...project,
					rootCount: paths.length,
				})),
			},
			attachments: [...uploads.values()],
		};
	}
	function downloadAttachment(attachmentId: string) {
		const file = uploads.get(attachmentId);
		if (!file)
			return HttpResponse.json(
				{ error: "Attachment not found." },
				{ status: 404 },
			);
		const bytes = Uint8Array.from(atob(file.data), (character) =>
			character.charCodeAt(0),
		);
		return new HttpResponse(bytes, {
			headers: {
				"content-type": file.mimeType,
				"content-disposition": `${file.kind === "image" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
			},
		});
	}
	const diagnostics = () => ({
		service: {
			status: "ready",
			storage: "ready",
			stateVersion: data.state.version,
			projectlessWorkspace: "ready",
		},
		inference: {
			provider: CommonspaceRoutingProvider.Harness,
			location: "runtime-managed",
			configured: true,
			sends: ["Storybook mock: no external requests"],
		},
		harnesses: data.agents.map((agent) => ({
			adapter: agent.adapter,
			installed: true,
			rostered: true,
			recordedRunStatus: "has-replies",
			recovery: "",
		})),
	});
	return [
		http.get("/api/bootstrap", () =>
			scenario === "offline"
				? HttpResponse.json(
						{
							error: "The local service is unavailable in this preview state.",
						},
						{ status: 503 },
					)
				: json(data),
		),
		http.post("/api/mutate", async ({ request }) => {
			try {
				const mutation = CommonspaceMutationSchema.parse(await request.json());
				mutate(mutation);
				return json(data);
			} catch (error) {
				return HttpResponse.json(
					{
						code: "invalid_mutation",
						error: error instanceof Error ? error.message : String(error),
					},
					{ status: 400 },
				);
			}
		}),
		http.post("/api/send", async ({ request }) => {
			const input = await trustedRequestJson<SendMessageRequest>(request);
			return json(send(input));
		}),
		http.post("/api/select-directory", () =>
			json({ path: "/mock/workspace/new-project" }),
		),
		http.post("/api/discover-agents", async ({ request }) => {
			const { adapter } = await trustedRequestJson<{ adapter: string }>(
				request,
			);
			data.discoveredAgents = structuredClone(
				discoveryStoryBootstrap.discoveredAgents.filter(
					(agent) => agent.adapter === adapter,
				),
			);
			return json(data);
		}),
		http.get("/api/agents/:agentId/capabilities", ({ params }) =>
			json({ ...populatedCapabilityInventory, agentId: params.agentId }),
		),
		http.get("/api/diagnostics", () => json(diagnostics())),
		http.post("/api/notifications/verify", () =>
			json({
				status: "delivered",
				message:
					"Preview notification simulated. No system notification was sent.",
			}),
		),
		http.put("/api/routing", async ({ request }) => {
			const update =
				await trustedRequestJson<UpdateRoutingConfigurationRequest>(request);
			data.routing = {
				provider: update.provider,
				harnessAgentId: update.harnessAgentId,
			};
			touch();
			return json(data.routing);
		}),
		http.post("/api/routing/validate", () => json(diagnostics().inference)),
		http.post("/api/pins", async ({ request }) => {
			const input = await trustedRequestJson<AddPinRequest>(request);
			const pin = {
				...input,
				id: id(),
				createdAt: now(),
				removedAt: null,
			};
			data.state.pins.push(pin);
			touch();
			return json(pin);
		}),
		http.post("/api/pins/:pinId/remove", ({ params }) => {
			const pin = data.state.pins.find((item) => item.id === params.pinId);
			if (pin) pin.removedAt = now();
			touch();
			return json(pin);
		}),
		http.put("/api/threads/:threadId/context", async ({ request, params }) => {
			const update =
				await trustedRequestJson<UpdateThreadContextRequest>(request);
			const thread = data.state.threads.find(
				(item) => item.id === params.threadId,
			);
			if (thread?.context)
				Object.assign(thread.context.memory, update, {
					updatedAt: now(),
					origin: "user",
				});
			touch();
			return json(thread);
		}),
		http.post("/api/threads/:threadId/context/compact", ({ params }) => {
			const thread = data.state.threads.find(
				(item) => item.id === params.threadId,
			);
			if (thread?.context) {
				thread.context.memory.status = "current";
				thread.context.memory.updatedAt = now();
			}
			touch();
			return json(thread);
		}),
		http.post("/api/channels/:channelId/context/compact", ({ params }) => {
			const channel = data.state.channels.find(
				(item) => item.id === params.channelId,
			);
			if (channel?.memory) {
				channel.memory.status = "current";
				channel.memory.updatedAt = now();
			}
			touch();
			return json(channel);
		}),
		http.post("/api/messages/:messageId/delete", ({ params }) => {
			const message = findMessage(String(params.messageId));
			for (const file of [
				...(message.attachments ?? []),
				...(message.files ?? []),
			])
				uploads.delete(file.id);
			message.text = "";
			delete message.attachments;
			delete message.files;
			delete message.trace;
			message.deletedAt = now();
			touch();
			return json(message);
		}),
		http.post("/api/stop", () => {
			data.liveActivities = [];
			touch();
			return json({ stoppedAgentIds: data.agents.map((agent) => agent.id) });
		}),
		http.get("/api/search", ({ request }) => {
			const url = new URL(request.url);
			const query = url.searchParams.get("q") ?? "";
			const kinds = COMMONSPACE_SEARCH_KINDS.filter((kind) =>
				url.searchParams.get("types")?.split(",").includes(kind),
			);
			const projectId = url.searchParams.get("project");
			const candidates: CommonspaceSearchResult[] = [
				...data.state.channels.map((channel) => ({
					id: channel.id,
					kind: "channel" as const,
					title: `#${channel.name}`,
					detail: `${channel.agentIds.length} ${channel.agentIds.length === 1 ? "agent" : "agents"}`,
					receipt: "Channel",
					highlights: [],
					target: {
						kind: "conversation" as const,
						conversation: { kind: "channel" as const, id: channel.id },
					},
				})),
				...data.state.projects.map((project) => ({
					id: project.id,
					kind: "project" as const,
					title: project.name,
					detail: `${project.paths.length} folders`,
					receipt: "Project",
					highlights: [],
					projectIds: [project.id],
					target: { kind: "project" as const, projectId: project.id },
				})),
				...data.agents.map((agent) => ({
					id: agent.id,
					kind: "agent" as const,
					title: agent.displayName,
					detail: agent.description ?? "",
					receipt: "Agent",
					highlights: [],
					target: { kind: "agent" as const, agentId: agent.id },
				})),
				...messages()
					.filter((message) => !message.deletedAt)
					.map((message) => {
						const location =
							message.conversation.kind === "channel"
								? `#${data.state.channels.find((channel) => channel.id === message.conversation.id)?.name ?? message.conversation.id}`
								: (data.agents.find(
										(agent) => agent.id === message.conversation.id,
									)?.displayName ?? message.conversation.id);
						const target: CommonspaceSearchTarget = {
							kind: "conversation" as const,
							conversation: message.conversation,
							messageId: message.id,
						};
						if (message.threadId !== undefined)
							target.threadId = message.threadId;
						return {
							id: message.id,
							kind: "message" as const,
							title: message.authorName,
							detail: message.text,
							receipt: `${location} · ${message.authorName} · ${message.createdAt}`,
							occurredAt: message.createdAt,
							projectIds: message.projectIds ?? [],
							highlights: [],
							target,
						};
					}),
			];
			return json({
				query,
				results: candidates.filter(
					(result) =>
						`${result.title} ${result.detail}`
							.toLowerCase()
							.includes(query.toLowerCase()) &&
						(!kinds.length || kinds.includes(result.kind)) &&
						(!projectId || result.projectIds?.includes(projectId)),
				),
				appliedFilters: { kinds, projectId },
				truncated: false,
			});
		}),
		http.post("/api/messages/:messageId/edit", async ({ request, params }) => {
			const update =
				await trustedRequestJson<Omit<EditMessageRequest, "messageId">>(
					request,
				);
			const original = findMessage(String(params.messageId));
			const result = send({
				conversation: original.conversation,
				text: update.text,
				projectIds: update.projectIds ?? original.projectIds,
			});
			result.accepted.supersedesMessageId = original.id;
			return json(result);
		}),
		http.post("/api/routing/retry", async ({ request }) => {
			const retry = await trustedRequestJson<RetryRoutingRequest>(request);
			const accepted = findMessage(retry.sourceMessageId);
			const agentId =
				retry.mode === "manual" ? retry.agentId : data.agents[0]?.id;
			if (!agentId)
				return HttpResponse.json(
					{ error: "Add an agent before retrying." },
					{ status: 400 },
				);
			accepted.replyStatus = "complete";
			delete accepted.replyError;
			accepted.routing = {
				source: retry.mode === "manual" ? "explicit" : "ai",
				status: "resolved",
				agentIds: [agentId],
				inferredProjectIds: [],
				assignments: [
					{ id: id(), agentId, projectIds: accepted.projectIds ?? [] },
				],
				corrections: [],
				reason: "Preview retry delivered to the selected agent.",
			};
			const thread = data.state.threads.find(
				(item) => item.rootMessageId === accepted.id,
			);
			if (thread) thread.agentIds = [agentId];
			appendReply(accepted, agentId);
			touch();
			return json({ accepted, thread, state: data.state });
		}),
		http.post("/api/reroute", async ({ request }) => {
			const reroute =
				await trustedRequestJson<RerouteAssignmentRequest>(request);
			const source = findMessage(reroute.sourceMessageId);
			if (!source.routing)
				return HttpResponse.json(
					{ error: "This message has no routing decision." },
					{ status: 400 },
				);
			const assignment = {
				id: id(),
				agentId: reroute.agentId,
				projectIds: reroute.projectIds,
			};
			const correction = {
				id: id(),
				fromAssignmentId: reroute.assignmentId,
				toAssignmentId: assignment.id,
				createdAt: now(),
			};
			source.routing.assignments.push(assignment);
			source.routing.corrections.push(correction);
			appendReply(source, reroute.agentId);
			touch();
			return json({
				sourceMessageId: source.id,
				assignment,
				correction,
				state: data.state,
			});
		}),
		http.post(
			"/api/permissions/:permissionId/respond",
			async ({ request, params }) => {
				const { optionId } = await trustedRequestJson<{ optionId: string }>(
					request,
				);
				const permission = data.state.permissions.find(
					(item) => item.id === params.permissionId,
				);
				if (permission) {
					permission.selectedOptionId = optionId;
					permission.status = "resolved";
					permission.resolvedAt = now();
				}
				touch();
				return json(permission);
			},
		),
		http.post("/api/followups/remove", async ({ request }) => {
			const { messageId } = await trustedRequestJson<{ messageId: string }>(
				request,
			);
			data.queuedFollowups =
				data.queuedFollowups?.filter((item) => item.messageId !== messageId) ??
				[];
			const removed = messages().find((message) => message.id === messageId);
			if (removed) removed.replyStatus = "cancelled";
			data.queuedFollowups.forEach((entry, position) => {
				entry.position = position;
			});
			touch();
			return json({ queuedFollowups: data.queuedFollowups });
		}),
		http.get("/api/attachments/:attachmentId", ({ params }) =>
			downloadAttachment(String(params.attachmentId)),
		),
		http.get("/api/files/:fileId", ({ params }) =>
			downloadAttachment(String(params.fileId)),
		),
		http.get("/api/export", () => json(archive())),
		http.post("/api/import", async ({ request }) => {
			const input = await trustedRequestJson<{
				archive: CommonspaceWorkspaceArchive;
				projectMappings: Record<string, string[]>;
			}>(request);
			if (
				data.state.channels.length ||
				data.state.projects.length ||
				data.state.agents.length ||
				messages().length
			)
				return HttpResponse.json(
					{
						error:
							"Import requires an empty workspace. Use Workspace / Empty Workspace.",
					},
					{ status: 409 },
				);
			const saved = input.archive;
			if (
				saved?.format !== "commonspace-workspace" ||
				saved.version !== COMMONSPACE_EXPORT_VERSION ||
				!saved.workspace ||
				!Array.isArray(saved.attachments) ||
				!Array.isArray(saved.workspace.projects) ||
				!Array.isArray(saved.workspace.agents) ||
				!Array.isArray(saved.workspace.channels) ||
				!Array.isArray(saved.workspace.threads) ||
				!saved.workspace.messages
			)
				return HttpResponse.json(
					{ error: "Invalid workspace archive." },
					{ status: 400 },
				);
			for (const project of saved.workspace.projects)
				if (input.projectMappings[project.id]?.length !== project.rootCount)
					return HttpResponse.json(
						{
							error: `Choose ${project.rootCount} folders for ${project.name}.`,
						},
						{ status: 400 },
					);
			const imported = structuredClone(saved.workspace);
			const projects = imported.projects.map((project) => ({
				id: project.id,
				name: project.name,
				createdAt: project.createdAt,
				paths: input.projectMappings[project.id] ?? [],
			}));
			data.state = {
				...imported,
				version: data.state.version,
				revision: data.state.revision + 1,
				projects,
				dmSessions: {},
				agentSessions: {},
			};
			data.agents = imported.agents.map((agent) => ({
				...agent,
				status: "stopped",
			}));
			uploads.clear();
			for (const file of saved.attachments)
				uploads.set(file.id, structuredClone(file));
			return json(data.state);
		}),
		http.post("/api/retention/preview", async ({ request }) => {
			const { conversation } = await trustedRequestJson<{
				conversation: ConversationRef;
			}>(request);
			return json(retention(conversation));
		}),
		http.post("/api/retention/apply", async ({ request }) => {
			const { conversation, expectedRevision } = await trustedRequestJson<{
				conversation: ConversationRef;
				expectedRevision: number;
			}>(request);
			if (expectedRevision !== data.state.revision)
				return HttpResponse.json(
					{ error: "The workspace changed. Preview retention again." },
					{ status: 409 },
				);
			const preview = retention(conversation);
			const key = `${conversation.kind}:${conversation.id}`;
			const list = data.state.messages[key] ?? [];
			const messageIds = new Set(list.map((message) => message.id));
			const threadIds = new Set(
				data.state.threads
					.filter((thread) => messageIds.has(thread.rootMessageId))
					.map((thread) => thread.id),
			);
			for (const message of list)
				for (const file of [
					...(message.attachments ?? []),
					...(message.files ?? []),
				])
					uploads.delete(file.id);
			delete data.state.messages[key];
			data.state.threads = data.state.threads.filter(
				(thread) => !threadIds.has(thread.id),
			);
			data.state.pins = data.state.pins.filter((pin) => {
				const referencesRemovedMessage =
					pin.kind !== "note" && messageIds.has(pin.messageId);
				return !(
					referencesRemovedMessage ||
					(pin.scope.kind === "channel" &&
						conversation.kind === "channel" &&
						pin.scope.id === conversation.id) ||
					(pin.scope.kind === "thread" && threadIds.has(pin.scope.id))
				);
			});
			data.state.permissions = data.state.permissions.filter(
				(permission) => !messageIds.has(permission.sourceMessageId),
			);
			data.state.inboxUnreadMessageIds = (
				data.state.inboxUnreadMessageIds ?? []
			).filter((id) => !messageIds.has(id));
			data.state.inboxReadMessageIds = data.state.inboxReadMessageIds.filter(
				(id) => !messageIds.has(id),
			);
			data.state.inboxSavedItemIds = data.state.inboxSavedItemIds.filter(
				(id) => !messageIds.has(id),
			);
			touch();
			return json(preview);
		}),
		http.post("/api/followups/reorder", async ({ request }) => {
			const { messageId, direction } = await trustedRequestJson<{
				messageId: string;
				direction: "up" | "down";
			}>(request);
			const queue = data.queuedFollowups ?? [];
			const index = queue.findIndex((item) => item.messageId === messageId);
			const destination = index + (direction === "up" ? -1 : 1);
			const item = queue[index],
				neighbor = queue[destination];
			if (item && neighbor) {
				queue[index] = neighbor;
				queue[destination] = item;
			}
			queue.forEach((entry, position) => {
				entry.position = position;
			});
			touch();
			return json({ queuedFollowups: queue });
		}),
		http.post("/api/projects/:projectId/open", () =>
			json({ opened: false, simulated: true }),
		),
		http.get("/api/projects/:projectId/:surface", ({ request, params }) => {
			const url = new URL(request.url),
				path = url.searchParams.get("path") ?? "";
			const rootIndex = Number(url.searchParams.get("root") ?? 0);
			const project = data.state.projects.find(
				(item) => item.id === params.projectId,
			);
			if (!project?.paths[rootIndex])
				return HttpResponse.json(
					{ error: "Project folder not found." },
					{ status: 404 },
				);
			const files: Record<string, string> = {
				"README.md": `# ${project.name}\n\nA local workspace for conversations with coding agents.\n\n## Development\n\nOpen Storybook and edit the shared UI components.\n`,
				"ui/src/CommonspaceApp.tsx":
					"export function CommonspaceApp() {\n  return <Workspace />;\n}\n",
				"docs/release-notes.md":
					"# Release notes\n\n- Simplified conversation layout\n- Routing and activity in message headers\n",
			};
			if (params.surface === "files") {
				const prefix = path ? `${path}/` : "";
				const entries = new Map<string, ProjectFileEntry>();
				for (const [filePath, content] of Object.entries(files)) {
					if (!filePath.startsWith(prefix)) continue;
					const remainder = filePath.slice(prefix.length);
					const name = remainder.split("/")[0];
					if (name === undefined) continue;
					entries.set(
						name,
						remainder.includes("/")
							? { name, path: `${prefix}${name}`, kind: "directory" }
							: {
									name,
									path: filePath,
									kind: "file",
									preview: "text",
									contentType: "text/plain",
									size: new TextEncoder().encode(content).length,
								},
					);
				}
				return json({
					projectId: project.id,
					rootIndex,
					path,
					entries: [...entries.values()],
					truncated: false,
				});
			}
			if (params.surface === "file") {
				const content = files[path];
				return content === undefined
					? HttpResponse.json({ error: "File not found." }, { status: 404 })
					: new HttpResponse(content, {
							headers: { "content-type": "text/plain" },
						});
			}
			if (params.surface === "changes")
				return json({
					available: true,
					branch: "main",
					head: "preview",
					clean: false,
					truncated: false,
					files: [
						{
							path: "docs/release-notes.md",
							status: "modified",
							indexStatus: " ",
							worktreeStatus: "M",
							additions: 2,
							deletions: 0,
							preview: "text",
						},
					],
				});
			if (params.surface === "diff")
				return json({
					path,
					binary: false,
					truncated: false,
					patch:
						"@@ -1 +1,3 @@\n # Release notes\n+Simplified conversation layout\n+Routing and activity in message headers",
				});
			return HttpResponse.json(
				{ error: "Unknown project view." },
				{ status: 404 },
			);
		}),
		// Never let an unsupported preview action reach a running local service.
		http.all("/api/*", ({ request }) =>
			HttpResponse.json(
				{
					error: `This preview does not simulate ${request.method} ${new URL(request.url).pathname} yet.`,
				},
				{ status: 501 },
			),
		),
	];
}
