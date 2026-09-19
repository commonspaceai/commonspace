import type {
	CommonspaceAgentProfile,
	CommonspaceBootstrap,
	HarnessCapabilityGroup,
	HarnessCapabilityInventory,
} from "@commonspace/shared";
import { AGENT_ADAPTERS } from "@commonspace/shared";
import {
	ChevronDownIcon,
	LoaderCircleIcon,
	RefreshCwIcon,
	SearchIcon,
	XIcon,
} from "lucide-react";
import {
	type FormEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Button } from "@/components/ui/button";
import { AgentAvatar } from "@/design-system/AgentAvatar";
import { ConfirmActionDialog } from "@/design-system/ConfirmActionDialog";
import { cn } from "@/lib/utils";
import { ChannelContextBrief } from "./ChannelContextBrief.tsx";
import type { CommonspaceStore } from "./commonspace-store.ts";

interface SettingsPaneProps {
	bootstrap: CommonspaceBootstrap;
	id: string;
	store: CommonspaceStore;
	onClose: () => void;
}

function useSettingsDraftValue<Value extends string | boolean | string[]>(
	savedValue: Value,
) {
	const [draft, setDraft] = useState<{ value: Value } | null>(null);
	const value = draft === null ? savedValue : draft.value;
	const setValue = (next: Value | ((previous: Value) => Value)) => {
		setDraft((current) => ({
			value:
				typeof next === "function"
					? next(current === null ? savedValue : current.value)
					: next,
		}));
	};
	const acceptSavedValue = (submitted: Value) => {
		setDraft((current) =>
			current !== null && current.value === submitted ? null : current,
		);
	};
	return [value, setValue, acceptSavedValue] as const;
}

function runtimeLabel(agent: CommonspaceAgentProfile): string {
	return AGENT_ADAPTERS[agent.adapter].label;
}

const AVATAR_EMOJIS = [
	["🤖", "robot agent"],
	["🧠", "brain thinking"],
	["🧭", "compass direction"],
	["🛠️", "tools builder"],
	["⚙️", "gear systems"],
	["✨", "sparkles"],
	["🚀", "rocket launch"],
	["⚡", "lightning fast"],
	["🔥", "fire hot"],
	["🌐", "globe web"],
	["🔬", "microscope research"],
	["🔎", "search inspect"],
	["🎨", "palette design"],
	["💻", "computer code"],
	["🧩", "puzzle solve"],
	["🛰️", "satellite infrastructure"],
	["🦾", "robot arm"],
	["🦉", "owl wisdom"],
	["🐙", "octopus"],
	["🦊", "fox"],
	["🐝", "bee"],
	["🌱", "seed growth"],
	["💡", "lightbulb idea"],
	["🛡️", "shield safety"],
] as const;

function AvatarEmojiPicker({
	value,
	onChange,
}: {
	value: string;
	onChange: (value: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const picker = useRef<HTMLDivElement>(null);
	const visible = AVATAR_EMOJIS.filter(([, keywords]) =>
		`${keywords}`
			.toLocaleLowerCase()
			.includes(query.trim().toLocaleLowerCase()),
	);

	useEffect(() => {
		if (!open) return;
		const close = (event: PointerEvent) => {
			if (
				!(event.target instanceof Node) ||
				picker.current?.contains(event.target) !== true
			)
				setOpen(false);
		};
		document.addEventListener("pointerdown", close);
		return () => {
			document.removeEventListener("pointerdown", close);
		};
	}, [open]);

	return (
		<div ref={picker} className="relative">
			<button
				type="button"
				className="flex min-h-9 w-full items-center justify-between rounded-sm border bg-background px-3 text-left text-xl hover:bg-muted"
				aria-label="Choose avatar emoji"
				aria-expanded={open}
				onClick={() => {
					setOpen((current) => !current);
				}}
			>
				<span>{value || "🤖"}</span>
				<ChevronDownIcon
					className="size-4 text-muted-foreground"
					aria-hidden="true"
				/>
			</button>
			{open && (
				<section
					className="absolute top-[calc(100%+6px)] left-0 z-30 w-full min-w-[240px] rounded-md border bg-popover p-2 text-popover-foreground shadow-lg"
					aria-label="Avatar emoji picker"
				>
					<input
						type="search"
						className="mb-2 min-h-10 w-full rounded-sm border bg-background px-2 text-sm"
						aria-label="Search avatar emoji"
						placeholder="Search emoji"
						value={query}
						onChange={(event) => {
							setQuery(event.target.value);
						}}
					/>
					<div className="grid max-h-44 grid-cols-6 gap-1 overflow-y-auto">
						{visible.map(([emoji, keywords]) => (
							<button
								key={emoji}
								type="button"
								className="grid size-9 place-items-center rounded-sm border-0 text-lg hover:bg-muted aria-pressed:bg-primary/10"
								aria-label={`Use ${keywords} avatar`}
								aria-pressed={value === emoji}
								onClick={() => {
									onChange(emoji);
									setOpen(false);
								}}
							>
								{emoji}
							</button>
						))}
					</div>
				</section>
			)}
		</div>
	);
}

interface ChannelSettingsEditorProps extends SettingsPaneProps {
	channel: CommonspaceBootstrap["state"]["channels"][number];
}

export function ChannelSettingsPane(props: SettingsPaneProps) {
	const channel = props.bootstrap.state.channels.find(
		(candidate) => candidate.id === props.id,
	);
	if (channel === undefined) return null;
	return (
		<ChannelSettingsEditor key={channel.id} {...props} channel={channel} />
	);
}

function ChannelSettingsEditor({
	bootstrap,
	id,
	store,
	onClose,
	channel,
}: ChannelSettingsEditorProps) {
	const agents = bootstrap.agents;
	const [agentIds, setAgentIds] = useSettingsDraftValue(channel.agentIds);
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState<"all" | "included" | "available">("all");
	const [pinNote, setPinNote] = useState("");
	const [pinning, setPinning] = useState(false);
	const [pinError, setPinError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);

	const visibleAgents = useMemo(() => {
		const normalized = query.trim().toLocaleLowerCase();
		return agents.filter((agent) => {
			if (filter === "included" && !agentIds.includes(agent.id)) return false;
			if (filter === "available" && agentIds.includes(agent.id)) return false;
			return (
				normalized === "" ||
				`${agent.displayName} ${agent.adapter} ${agent.model ?? ""} ${agent.description ?? ""}`
					.toLocaleLowerCase()
					.includes(normalized)
			);
		});
	}, [agentIds, agents, filter, query]);
	const pins = bootstrap.state.pins.filter(
		(pin) =>
			pin.removedAt === null &&
			pin.scope.kind === "channel" &&
			pin.scope.id === id,
	);

	const messagesById = useMemo(
		() =>
			new Map(
				(bootstrap.state.messages[`channel:${id}`] ?? []).map((message) => [
					message.id,
					message,
				]),
			),
		[bootstrap.state.messages, id],
	);

	const save = async (event: FormEvent) => {
		event.preventDefault();
		if (saving) return;
		setSaving(true);
		try {
			await store.mutate({
				action: "set-channel-agents",
				channelId: id,
				agentIds,
			});
			onClose();
		} finally {
			setSaving(false);
		}
	};

	const addNote = async () => {
		const submittedDraft = pinNote;
		const note = submittedDraft.trim();
		if (pinning || note === "") return;
		setPinning(true);
		setPinError(null);
		try {
			await store.addPin({
				scope: { kind: "channel", id },
				kind: "note",
				note,
			});
			setPinNote((current) => (current === submittedDraft ? "" : current));
		} catch (error) {
			setPinError(error instanceof Error ? error.message : String(error));
		} finally {
			setPinning(false);
		}
	};

	const updateVisible = (include: boolean) => {
		const visibleIds = new Set(visibleAgents.map((agent) => agent.id));
		setAgentIds((current) =>
			include
				? [
						...current,
						...visibleAgents
							.map((agent) => agent.id)
							.filter((agentId) => !current.includes(agentId)),
					]
				: current.filter((agentId) => !visibleIds.has(agentId)),
		);
	};

	return (
		<aside
			className="commonspace-context-settings flex min-h-0 min-w-[340px] flex-col border-l bg-card"
			aria-label="Channel settings"
		>
			<header className="flex min-h-[72px] items-center gap-3 border-b py-2.5 pr-3.5 pl-5">
				<div className="min-w-0 flex-1">
					<h2 className="truncate font-heading text-base font-semibold">
						# {channel.name}
					</h2>
					<p className="mt-0.5 text-xs text-muted-foreground">
						Manage who can participate in this shared room.
					</p>
				</div>
				<button
					type="button"
					className="grid size-8 shrink-0 place-items-center rounded-sm border-0 bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
					aria-label="Close channel settings"
					onClick={onClose}
				>
					<XIcon className="size-[18px]" aria-hidden="true" />
				</button>
			</header>
			<form
				className="flex min-h-0 flex-1 flex-col"
				onSubmit={(event) => {
					void save(event);
				}}
			>
				<fieldset
					disabled={saving}
					className="min-h-0 min-w-0 flex-1 overflow-y-auto border-0 p-6"
				>
					<section aria-labelledby="channel-members-heading">
						<header className="mb-4 flex items-start justify-between gap-3">
							<div>
								<h3
									id="channel-members-heading"
									className="font-heading text-sm font-bold"
								>
									Members
								</h3>
								<p className="mt-1 text-xs text-muted-foreground">
									Choose which agents can be mentioned in this channel.
								</p>
							</div>
							<span className="shrink-0 rounded-full border px-2 py-1 text-xs text-muted-foreground">
								{String(agentIds.length)} of {String(agents.length)} included
							</span>
						</header>
						<div className="overflow-hidden rounded-md border">
							<div className="border-b bg-muted p-3">
								<label className="flex min-h-9 items-center gap-2 rounded-sm border bg-background px-3 text-muted-foreground focus-within:border-primary">
									<SearchIcon className="size-4" aria-hidden="true" />
									<span className="sr-only">Search agents</span>
									<input
										className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-foreground outline-none"
										type="search"
										aria-label="Search agents"
										placeholder="Search agents by name or role"
										value={query}
										onChange={(event) => {
											setQuery(event.target.value);
										}}
									/>
								</label>
								<fieldset
									className="mt-2 flex min-w-0 gap-1 border-0 p-0"
									aria-label="Filter channel members"
								>
									{(["all", "included", "available"] as const).map((value) => (
										<button
											key={value}
											type="button"
											className="min-h-9 rounded-md border-0 px-3 text-xs font-medium capitalize text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground"
											aria-pressed={filter === value}
											onClick={() => {
												setFilter(value);
											}}
										>
											{value}
										</button>
									))}
								</fieldset>
							</div>
							<div className="flex min-h-9 items-center justify-between gap-3 border-b px-3 text-xs text-muted-foreground">
								<span>
									{String(visibleAgents.length)}{" "}
									{visibleAgents.length === 1 ? "agent" : "agents"}
								</span>
								<span>
									<button
										type="button"
										className="min-h-9 px-2 font-semibold text-primary"
										onClick={() => {
											updateVisible(true);
										}}
									>
										Include visible
									</button>
									<button
										type="button"
										className="min-h-9 px-2 font-semibold text-muted-foreground"
										onClick={() => {
											updateVisible(false);
										}}
									>
										Remove visible
									</button>
								</span>
							</div>
							<div>
								{visibleAgents.map((agent) => {
									const included = agentIds.includes(agent.id);
									return (
										<label
											key={agent.id}
											className="grid min-h-[62px] grid-cols-[18px_36px_minmax(0,1fr)_auto] items-center gap-3 border-b px-3 py-2 last:border-b-0 hover:bg-muted"
										>
											<input
												type="checkbox"
												checked={included}
												onChange={(event) => {
													setAgentIds((current) =>
														event.target.checked
															? [...current, agent.id]
															: current.filter(
																	(agentId) => agentId !== agent.id,
																),
													);
												}}
											/>
											<AgentAvatar agent={agent} />
											<span className="min-w-0">
												<strong className="block truncate text-[13px]">
													{agent.displayName}
												</strong>
												<small className="block truncate text-xs text-muted-foreground">
													{runtimeLabel(agent)} ·{" "}
													{agent.description ?? agent.model ?? "native profile"}
												</small>
											</span>
											<span
												className={cn(
													"rounded-full border px-2 py-1 text-[10px]",
													agent.status === "running"
														? "border-[var(--status-success)]/30 text-[var(--status-success)]"
														: "text-muted-foreground",
												)}
											>
												{agent.status === "running" ? "Working" : "Available"}
											</span>
										</label>
									);
								})}
								{visibleAgents.length === 0 && (
									<div className="p-8 text-center">
										<strong className="block text-[13px]">
											No agents found
										</strong>
										<span className="mt-1 block text-xs text-muted-foreground">
											Try another name or role, or show all agents.
										</span>
									</div>
								)}
							</div>
						</div>
					</section>

					<section
						className="mt-7 border-t pt-6"
						aria-labelledby="channel-pins-heading"
					>
						<div className="flex items-center justify-between">
							<h3
								id="channel-pins-heading"
								className="font-heading text-sm font-bold"
							>
								Pinned messages & notes
							</h3>
							<span className="text-xs text-muted-foreground">
								{pins.length}
							</span>
						</div>
						<p className="mt-2 text-xs text-muted-foreground">
							Keep useful messages, files, and notes available to everyone in
							this channel.
						</p>
						<div className="mt-3 grid gap-2">
							{pins.length === 0 && (
								<p className="text-xs text-muted-foreground">
									No pins yet. Open a message’s menu and choose Pin message, or
									add a note below.
								</p>
							)}
							{pins.map((pin) => {
								const source =
									pin.messageId === undefined
										? undefined
										: messagesById.get(pin.messageId);
								const attachment =
									pin.kind === "attachment"
										? [
												...(source?.attachments ?? []),
												...(source?.files ?? []),
											].find((file) => file.id === pin.attachmentId)
										: undefined;
								const label =
									pin.kind === "note"
										? pin.note
										: source?.deletedAt !== undefined
											? "Deleted message"
											: pin.kind === "attachment"
												? (attachment?.name ?? "Unavailable attachment")
												: source?.text || "Attachment message";

								return (
									<div
										key={pin.id}
										className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-sm border bg-muted p-3 text-xs"
									>
										<div className="min-w-0">
											{source !== undefined && (
												<p className="mb-1 font-semibold">
													{source.authorName}
												</p>
											)}
											<p className="whitespace-pre-wrap break-words">{label}</p>
										</div>
										<button
											type="button"
											className="text-destructive"
											aria-label={`Remove channel pin ${label}`}
											onClick={() => {
												void store.removePin(pin.id);
											}}
										>
											Remove
										</button>
									</div>
								);
							})}
							<div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
								<input
									className="min-h-9 rounded-sm border px-3 text-[13px]"
									aria-label="New channel pin note"
									placeholder="Pin a channel note"
									value={pinNote}
									onChange={(event) => {
										setPinNote(event.target.value);
									}}
								/>
								<Button
									type="button"
									variant="outline"
									disabled={pinning || pinNote.trim() === ""}
									onClick={() => {
										void addNote();
									}}
								>
									{pinning ? "Pinning..." : "Pin"}
								</Button>
							</div>
							{pinError === null ? null : (
								<p role="alert" className="text-xs text-destructive">
									{pinError}
								</p>
							)}
						</div>
					</section>

					<ChannelContextBrief channel={channel} store={store} />

					<section className="mt-7 border-t pt-6">
						<Button
							type="button"
							variant="destructive"
							onClick={() => {
								setRemoveConfirmOpen(true);
							}}
						>
							Remove channel
						</Button>
					</section>
				</fieldset>
				<footer className="flex justify-end gap-2 border-t bg-muted px-5 py-3">
					<Button type="button" variant="outline" onClick={onClose}>
						Cancel
					</Button>
					<Button type="submit" disabled={saving}>
						{saving ? "Saving…" : "Save changes"}
					</Button>
				</footer>
			</form>
			<ConfirmActionDialog
				open={removeConfirmOpen}
				title={`Remove ${channel.name}?`}
				description="This can be added again later. Existing local agent credentials stay untouched."
				onOpenChange={setRemoveConfirmOpen}
				onConfirm={async () => {
					await store.mutate({ action: "remove-channel", channelId: id });
					onClose();
				}}
			/>
		</aside>
	);
}

const capabilityGroupLabels = {
	tools: "Tools",
	mcp: "MCP servers",
	skills: "Skills",
	plugins: "Plugins",
	memory: "Memory",
	agents: "Agents",
} satisfies Record<HarnessCapabilityGroup["id"], string>;

enum CapabilityRequestStatus {
	Loading = "loading",
	Success = "success",
	Error = "error",
}

interface LoadingCapabilities {
	status: CapabilityRequestStatus.Loading;
}

interface LoadedCapabilities {
	status: CapabilityRequestStatus.Success;
	inventory: HarnessCapabilityInventory;
}

interface FailedCapabilities {
	status: CapabilityRequestStatus.Error;
	message: string;
}

type CapabilityRequest =
	| LoadingCapabilities
	| LoadedCapabilities
	| FailedCapabilities;

function capabilityStatusLabel(
	status: HarnessCapabilityGroup["status"],
): string {
	switch (status) {
		case "available":
			return "Available";
		case "unavailable":
			return "Unavailable";
		case "error":
			return "Inspection failed";
	}
}

export function HarnessCapabilities({
	agentId,
	store,
}: {
	agentId: string;
	store: CommonspaceStore;
}) {
	const [request, setRequest] = useState<CapabilityRequest>({
		status: CapabilityRequestStatus.Loading,
	});
	const [query, setQuery] = useState("");
	const requestId = useRef(0);

	const inspect = useCallback(() => {
		const currentRequest = ++requestId.current;
		setRequest({ status: CapabilityRequestStatus.Loading });
		void store
			.inspectAgentCapabilities(agentId)
			.then((inventory) => {
				if (
					requestId.current === currentRequest &&
					inventory.agentId === agentId
				) {
					setRequest({
						status: CapabilityRequestStatus.Success,
						inventory,
					});
				}
			})
			.catch((cause: unknown) => {
				if (requestId.current === currentRequest) {
					setRequest({
						status: CapabilityRequestStatus.Error,
						message: cause instanceof Error ? cause.message : String(cause),
					});
				}
			});
	}, [agentId, store]);

	useEffect(() => {
		inspect();
		return () => {
			requestId.current += 1;
		};
	}, [inspect]);

	if (request.status === CapabilityRequestStatus.Loading) {
		return (
			<div
				className="mt-4 flex min-h-24 items-center justify-center gap-2 rounded-md border bg-muted text-xs text-muted-foreground"
				role="status"
			>
				<LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />
				Inspecting native capabilities…
			</div>
		);
	}

	if (request.status === CapabilityRequestStatus.Error) {
		return (
			<div className="mt-4 rounded-md border bg-muted p-3 text-xs" role="alert">
				<strong className="block text-foreground">
					Capability inspection failed
				</strong>
				<p className="mt-1 text-muted-foreground">{request.message}</p>
				<Button className="mt-3" size="sm" variant="outline" onClick={inspect}>
					<RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
					Try again
				</Button>
			</div>
		);
	}

	const normalized = query.trim().toLocaleLowerCase();
	const groups = request.inventory.groups.map((group) => ({
		...group,
		items: group.items.filter((item) =>
			normalized === ""
				? true
				: `${item.name} ${item.description ?? ""} ${item.status}`
						.toLocaleLowerCase()
						.includes(normalized),
		),
	}));
	const itemCount = request.inventory.groups.reduce(
		(total, group) => total + group.items.length,
		0,
	);

	return (
		<div className="mt-4 grid gap-3">
			<div className="flex items-center gap-2">
				<label className="relative min-w-0 flex-1">
					<SearchIcon
						className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
						aria-hidden="true"
					/>
					<input
						className="min-h-10 w-full rounded-sm border bg-background pr-3 pl-9 text-xs"
						type="search"
						aria-label="Search capabilities"
						placeholder={`Search ${String(itemCount)} capabilities`}
						value={query}
						onChange={(event) => setQuery(event.target.value)}
					/>
				</label>
				<Button
					size="icon"
					variant="outline"
					aria-label="Refresh capabilities"
					onClick={inspect}
				>
					<RefreshCwIcon aria-hidden="true" />
				</Button>
			</div>
			<p className="text-[11px] leading-4 text-muted-foreground">
				Read-only metadata from native harness. Configured entries may still
				require runtime approval or authentication.
			</p>
			<div className="grid gap-2">
				{groups.map((group, index) => (
					<details
						key={group.id}
						open={normalized !== "" || index === 0}
						className="rounded-md border bg-background p-3"
					>
						<summary className="cursor-pointer list-none">
							<span className="flex items-center justify-between gap-3">
								<span>
									<strong className="block text-[13px]">
										{capabilityGroupLabels[group.id]}
									</strong>
									<small className="block text-xs text-muted-foreground">
										{group.source}
									</small>
								</span>
								<span className="text-right">
									<b className="block font-mono text-[10px] text-muted-foreground">
										{group.status === "available"
											? `${String(group.items.length)} items`
											: "— items"}
									</b>
									<small className="text-[10px] text-muted-foreground">
										{capabilityStatusLabel(group.status)}
									</small>
								</span>
							</span>
						</summary>
						<div className="mt-3 grid gap-2 border-t pt-3 text-xs">
							<p className="text-muted-foreground">{group.notice}</p>
							{group.items.length > 0 ? (
								group.items.map((item) => (
									<div
										key={item.name}
										className="flex items-start justify-between gap-3 rounded-sm bg-muted px-2.5 py-2"
									>
										<span className="min-w-0">
											<strong className="block break-words text-foreground">
												{item.name}
											</strong>
											{item.description === undefined ? null : (
												<small className="mt-0.5 block leading-4 text-muted-foreground">
													{item.description}
												</small>
											)}
										</span>
										<span className="shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
											{item.status}
										</span>
									</div>
								))
							) : (
								<p className="rounded-sm bg-muted px-2.5 py-2 text-muted-foreground">
									{normalized === ""
										? "No capability names reported."
										: "No capabilities match this search."}
								</p>
							)}
						</div>
					</details>
				))}
			</div>
			<small className="font-mono text-[10px] text-muted-foreground">
				Checked {new Date(request.inventory.checkedAt).toLocaleString()}
			</small>
		</div>
	);
}

interface AgentSettingsEditorProps extends SettingsPaneProps {
	agent: CommonspaceAgentProfile;
}

export function AgentSettingsPane(props: SettingsPaneProps) {
	const agent = props.bootstrap.agents.find(
		(candidate) => candidate.id === props.id,
	);
	if (agent === undefined) return null;
	return <AgentSettingsEditor key={agent.id} {...props} agent={agent} />;
}

function AgentSettingsEditor({
	id,
	store,
	onClose,
	agent,
}: AgentSettingsEditorProps) {
	const [displayName, setDisplayName, acceptDisplayName] =
		useSettingsDraftValue(agent.displayName);
	const [avatarEmoji, setAvatarEmoji, acceptAvatarEmoji] =
		useSettingsDraftValue(agent.avatarEmoji ?? "");
	const [accentColor, setAccentColor, acceptAccentColor] =
		useSettingsDraftValue(agent.accentColor ?? "#4a154b");
	const [fullAccess, setFullAccess, acceptFullAccess] = useSettingsDraftValue(
		agent.fullAccess === true,
	);
	const [saving, setSaving] = useState(false);
	const [saveState, setSaveState] = useState("Changes apply after saving.");
	const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
	const agentAdapter = agent.adapter;

	useEffect(() => {
		void store.discoverAgents(agentAdapter);
	}, [agentAdapter, store]);

	const previewAgent: CommonspaceAgentProfile = {
		...agent,
		displayName: displayName || agent.displayName,
		accentColor,
	};
	if (avatarEmoji !== "") previewAgent.avatarEmoji = avatarEmoji;

	const save = async () => {
		if (saving || displayName.trim() === "") return;
		setSaving(true);
		try {
			await store.mutate({
				action: "update-agent-profile",
				agentId: id,
				displayName: displayName.trim(),
				avatarEmoji,
				accentColor,
				fullAccess,
			});
			acceptDisplayName(displayName);
			acceptAvatarEmoji(avatarEmoji);
			acceptAccentColor(accentColor);
			acceptFullAccess(fullAccess);
			setSaveState(
				"Agent settings saved. Native runtime connectivity has not been tested.",
			);
		} catch (error) {
			setSaveState(error instanceof Error ? error.message : String(error));
		} finally {
			setSaving(false);
		}
	};

	return (
		<aside
			className="commonspace-context-settings flex min-h-0 min-w-[420px] flex-col border-l bg-card"
			aria-label="Agent profile"
		>
			<header className="flex min-h-[76px] items-center gap-3 border-b bg-muted px-4 py-2.5">
				<AgentAvatar agent={previewAgent} />
				<span className="min-w-0 flex-1">
					<h2 className="block truncate text-[13px] font-bold">
						{previewAgent.displayName}
					</h2>
					<small className="block truncate text-xs text-muted-foreground">
						{runtimeLabel(agent)} ·{" "}
						{agent.status === "running" ? "online" : "configured"}
					</small>
				</span>
				<span className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2 py-1 text-[10px] text-muted-foreground">
					<i
						className="size-1.5 rounded-full bg-[var(--status-success)]"
						aria-hidden="true"
					/>
					Native profile
				</span>
				<button
					type="button"
					className="grid size-8 shrink-0 place-items-center rounded-sm border-0 bg-transparent text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
					aria-label="Close agent profile"
					onClick={onClose}
				>
					<XIcon className="size-[18px]" aria-hidden="true" />
				</button>
			</header>
			<fieldset
				disabled={saving}
				className="min-h-0 min-w-0 flex-1 overflow-y-auto border-0 p-0"
			>
				<section className="border-b p-5">
					<header className="mb-3 flex items-start justify-between gap-3">
						<div>
							<p className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground uppercase">
								Commonspace identity
							</p>
							<h3 className="font-heading text-base font-semibold">
								Workspace configuration
							</h3>
						</div>
						<span className="text-xs">Local</span>
					</header>
					<p className="text-xs leading-5 text-muted-foreground">
						Customize how this agent appears in Commonspace. These settings do
						not change the native harness profile.
					</p>
					<div className="mt-4 grid gap-3 [&_input]:min-h-9 [&_input]:rounded-sm [&_input]:border [&_input]:px-3 [&_label]:grid [&_label]:gap-1.5 [&_label]:text-xs [&_label]:font-semibold">
						<div className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-4">
							<AgentAvatar agent={previewAgent} size="profile" />
							<label>
								Workspace name
								<input
									aria-label="Workspace name"
									value={displayName}
									onChange={(event) => {
										setDisplayName(event.target.value);
										setSaveState("Changes apply after saving.");
									}}
								/>
							</label>
						</div>
						<div className="grid grid-cols-2 gap-3">
							<div className="grid gap-1.5 text-xs font-semibold">
								<span>Avatar emoji</span>
								<AvatarEmojiPicker
									value={avatarEmoji}
									onChange={(value) => {
										setAvatarEmoji(value);
										setSaveState("Changes apply after saving.");
									}}
								/>
							</div>
							<label>
								Background color
								<span className="grid grid-cols-[44px_minmax(0,1fr)] gap-2">
									<input
										className="p-1"
										type="color"
										aria-label="Avatar background color"
										value={accentColor}
										onChange={(event) => {
											setAccentColor(event.target.value);
											setSaveState("Changes apply after saving.");
										}}
									/>
									<input
										aria-label="Avatar background hex value"
										value={accentColor.toLocaleUpperCase()}
										onChange={(event) => {
											if (/^#[0-9a-f]{6}$/iu.test(event.target.value)) {
												setAccentColor(event.target.value);
												setSaveState("Changes apply after saving.");
											}
										}}
									/>
								</span>
							</label>
						</div>
					</div>
				</section>

				<section className="border-b p-5">
					<header className="mb-3 flex items-start justify-between gap-3">
						<div>
							<p className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground uppercase">
								Harness profile
							</p>
							<h3 className="font-heading text-base font-semibold">
								Harness configuration
							</h3>
						</div>
						<span className="rounded-full border px-2 py-1 font-mono text-[10px] text-muted-foreground">
							Read from {runtimeLabel(agent)}
						</span>
					</header>
					<p className="text-xs leading-5 text-muted-foreground">
						Model, reasoning, and credentials stay owned by the selected native
						profile. Access mode below applies only to Commonspace runs.
					</p>
					<div className="mt-4 grid grid-cols-2 gap-3 [&_input]:min-h-9 [&_input]:rounded-sm [&_input]:border [&_input]:bg-muted [&_input]:px-3 [&_label]:grid [&_label]:gap-1.5 [&_label]:text-xs [&_label]:font-semibold">
						<label>
							Model
							<input
								aria-label="Native model"
								readOnly
								value={agent.model ?? "Profile default"}
							/>
						</label>
						<label>
							Runtime
							<input
								aria-label="Native runtime"
								readOnly
								value={runtimeLabel(agent)}
							/>
						</label>
					</div>
					<label className="mt-4 flex items-start gap-3 rounded-md border bg-muted p-3 text-left">
						<input
							type="checkbox"
							className="mt-0.5 size-4"
							checked={
								agent.permissionPolicy?.source === "server"
									? agent.permissionPolicy.fullAccess
									: fullAccess
							}
							disabled={agent.permissionPolicy?.source === "server"}
							onChange={(event) => {
								setFullAccess(event.target.checked);
								setSaveState("Changes apply after saving.");
							}}
						/>
						<span>
							<strong className="block text-sm">Full access</strong>
							<small className="block text-xs leading-5 text-muted-foreground">
								{agent.permissionPolicy?.source === "server" &&
									"Full access is enabled by server configuration and cannot be disabled here. "}
								Bypass approval prompts for this agent's Commonspace runs. The
								agent can execute commands and modify files without asking
								first.
							</small>
						</span>
					</label>
					<p className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground">
						Native model information comes from discovery; it does not verify
						this session or model access.
					</p>
				</section>

				<section className="border-b p-5">
					<header className="mb-3 flex items-start justify-between gap-3">
						<div>
							<p className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground uppercase">
								Harness inventory
							</p>
							<h3 className="font-heading text-base font-semibold">
								Capabilities
							</h3>
						</div>
						<span className="text-xs">Native</span>
					</header>
					<p className="text-xs leading-5 text-muted-foreground">
						Commonspace shows capability ownership without recreating a second
						permission system.
					</p>
					<HarnessCapabilities
						key={agent.id}
						agentId={agent.id}
						store={store}
					/>
				</section>

				<section className="p-5">
					<Button
						variant="destructive"
						onClick={() => {
							setRemoveConfirmOpen(true);
						}}
					>
						Remove from Commonspace
					</Button>
					<p className="mt-2 text-xs text-muted-foreground">
						The native harness profile and its credentials remain untouched.
					</p>
				</section>
			</fieldset>
			<footer className="flex min-h-[68px] items-center gap-3 border-t bg-muted px-[18px] py-2.5">
				<span className="min-w-0 flex-1 text-xs text-muted-foreground">
					{saveState}
				</span>
				<Button
					disabled={saving || displayName.trim() === ""}
					onClick={() => {
						void save();
					}}
				>
					{saving ? "Saving…" : "Save agent settings"}
				</Button>
			</footer>
			<ConfirmActionDialog
				open={removeConfirmOpen}
				title={`Remove ${agent.displayName}?`}
				description="This can be added again later. The native harness profile and its credentials remain untouched."
				onOpenChange={setRemoveConfirmOpen}
				onConfirm={async () => {
					await store.mutate({ action: "remove-agent", agentId: id });
					onClose();
				}}
			/>
		</aside>
	);
}
