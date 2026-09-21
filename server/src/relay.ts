import {
	agentMentionName,
	type CommonspaceAgentProfile,
} from "@commonspace/shared";

const ESCAPE = String.fromCharCode(27);

export interface CommonspaceTags {
	agents: string[];
	projects: string[];
	channels: string[];
}

function unique(values: string[]): string[] {
	return [...new Set(values.map((value) => value.toLocaleLowerCase()))];
}

function stripAnsi(input: string): string {
	return input
		.split(ESCAPE)
		.map((part, index) =>
			index === 0 ? part : part.replace(/^\[[0-9;]*m/u, ""),
		)
		.join("");
}

function profileDisplayName(id: string): string {
	return id
		.split(/[-_]/u)
		.filter(Boolean)
		.map((part) => `${part.slice(0, 1).toLocaleUpperCase()}${part.slice(1)}`)
		.join(" ");
}

export function parseTags(text: string): CommonspaceTags {
	const agents: string[] = [];
	const projects: string[] = [];
	const channels: string[] = [];
	const token = /(^|[^\p{L}\p{N}_@])(@@|@|#)([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu;
	for (const match of text.matchAll(token)) {
		const kind = match[2];
		const value = match[3];
		if (kind === undefined || value === undefined) continue;
		if (kind === "@@") projects.push(value);
		else if (kind === "@") agents.push(value);
		else if (kind === "#") channels.push(value);
	}
	return {
		agents: unique(agents),
		projects: unique(projects),
		channels: unique(channels),
	};
}

function hermesProfileFromLine(
	raw: string,
): CommonspaceAgentProfile | undefined {
	const line = raw.trim().replace(/^◆\s?/u, "");
	if (line === "" || line.startsWith("Profile") || /^[─\-\s]+$/u.test(line))
		return undefined;

	const primary = /^(.*?)\s+\(default\)\s+(\S+)\s+(running|stopped)\b/u.exec(
		line,
	);
	if (primary !== null) {
		const [, displayName, model, status] = primary;
		if (
			displayName === undefined ||
			model === undefined ||
			status === undefined
		)
			return undefined;
		return {
			id: "default",
			displayName: displayName.trim(),
			adapter: "hermes",
			model,
			status: status === "running" ? "running" : "stopped",
		};
	}

	const named = /^(\S+)\s+(\S+)\s+(running|stopped)\b/u.exec(line);
	if (named === null) return undefined;
	const [, id, model, status] = named;
	if (id === undefined || model === undefined || status === undefined)
		return undefined;
	return {
		id,
		displayName: profileDisplayName(id),
		adapter: "hermes",
		model,
		status: status === "running" ? "running" : "stopped",
	};
}

export function parseHermesProfileList(
	output: string,
): CommonspaceAgentProfile[] {
	return stripAnsi(output)
		.split(/\r?\n/u)
		.flatMap((line) => {
			const profile = hermesProfileFromLine(line);
			return profile === undefined ? [] : [profile];
		});
}

export function parseHermesProfileDescription(
	output: string,
): string | undefined {
	const value = stripAnsi(output).trim();
	if (value === "" || /\bhas no description\.?$/iu.test(value))
		return undefined;
	return value.slice(0, 4_000);
}

export function mentionedChannelAgents(
	memberIds: readonly string[],
	text: string,
	agents: readonly Pick<CommonspaceAgentProfile, "id" | "displayName">[],
): string[] {
	const members = new Set(memberIds);
	const knownAgents = new Set(agents.map((agent) => agent.id));
	const mentionedTags = parseTags(text).agents;
	if (mentionedTags.includes("all"))
		return memberIds.filter((id) => knownAgents.has(id));
	return mentionedAgents(text, agents).filter((id) => members.has(id));
}

export function mentionedAgents(
	text: string,
	agents: readonly Pick<CommonspaceAgentProfile, "id" | "displayName">[],
): string[] {
	const mentionedTags = parseTags(text).agents.filter((tag) => tag !== "all");
	const agentByMention = new Map(
		agents.map((agent) => [agentMentionName(agent), agent.id]),
	);
	return [
		...new Set(
			mentionedTags
				.map((id) => agentByMention.get(id))
				.filter((id): id is string => id !== undefined),
		),
	];
}

export function finalHandoffAgent(
	memberIds: readonly string[],
	text: string,
	agents: readonly Pick<CommonspaceAgentProfile, "id" | "displayName">[],
): string | undefined {
	const finalParagraph = text
		.trim()
		.split(/\r?\n[\t ]*\r?\n/u)
		.at(-1)
		?.trim();
	if (finalParagraph === undefined || !finalParagraph.startsWith("@"))
		return undefined;
	if (parseTags(finalParagraph).agents.includes("all")) return undefined;
	return mentionedChannelAgents(memberIds, finalParagraph, agents)[0];
}

const ROUTING_STOP_WORDS = new Set([
	"about",
	"after",
	"again",
	"also",
	"and",
	"are",
	"can",
	"could",
	"for",
	"from",
	"have",
	"how",
	"into",
	"like",
	"please",
	"that",
	"the",
	"their",
	"this",
	"through",
	"want",
	"with",
	"work",
	"would",
	"you",
	"your",
]);

function routingTerms(value: string): string[] {
	return [
		...new Set(
			(
				value
					.normalize("NFKC")
					.toLocaleLowerCase()
					.match(/[\p{L}\p{N}]+/gu) ?? []
			).filter((term) => term.length >= 3 && !ROUTING_STOP_WORDS.has(term)),
		),
	];
}

function relatedRoutingTerm(left: string, right: string): boolean {
	if (left === right) return true;
	const sharedPrefix = Math.min(left.length, right.length, 7);
	return (
		sharedPrefix >= 4 &&
		left.slice(0, sharedPrefix) === right.slice(0, sharedPrefix)
	);
}

export interface ChannelAgentRoutingSignal {
	id: string;
	score: number;
	matchedTerms: string[];
}

export function rankChannelAgents(
	memberIds: readonly string[],
	text: string,
	agents: readonly Pick<
		CommonspaceAgentProfile,
		"id" | "displayName" | "description"
	>[],
): ChannelAgentRoutingSignal[] {
	const messageTerms = routingTerms(text);
	const members = new Set(memberIds);
	return agents
		.filter((agent) => members.has(agent.id))
		.map((agent) => {
			const identityTerms = routingTerms(agent.displayName);
			const descriptionTerms = routingTerms(agent.description ?? "");
			const matchedTerms: string[] = [];
			const score = messageTerms.reduce((total, term) => {
				if (
					identityTerms.some((candidate) => relatedRoutingTerm(term, candidate))
				) {
					matchedTerms.push(term);
					return total + 4;
				}
				if (
					descriptionTerms.some((candidate) =>
						relatedRoutingTerm(term, candidate),
					)
				) {
					matchedTerms.push(term);
					return total + 1;
				}
				return total;
			}, 0);
			return { id: agent.id, score, matchedTerms };
		})
		.sort(
			(left, right) =>
				right.score - left.score ||
				memberIds.indexOf(left.id) - memberIds.indexOf(right.id),
		);
}
