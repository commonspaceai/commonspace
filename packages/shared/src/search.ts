import type { ConversationRef } from "./contracts.js";

export const COMMONSPACE_SEARCH_KINDS = [
	"project",
	"channel",
	"message",
	"dm",
	"agent",
	"trace",
	"file",
	"decision",
	"run",
	"brief",
] as const;

export type CommonspaceSearchKind = (typeof COMMONSPACE_SEARCH_KINDS)[number];

export interface CommonspaceSearchHighlight {
	field: "title" | "detail";
	start: number;
	end: number;
}

export type CommonspaceSearchTarget =
	| {
			kind: "conversation";
			conversation: ConversationRef;
			threadId?: string;
			messageId?: string;
	  }
	| { kind: "project-file"; projectId: string; rootIndex: number; path: string }
	| { kind: "project"; projectId: string }
	| { kind: "agent"; agentId: string };

export interface CommonspaceSearchResult {
	id: string;
	kind: CommonspaceSearchKind;
	title: string;
	detail: string;
	receipt: string;
	projectIds?: string[];
	/** @deprecated Compatibility mirror of the first projectIds entry. */
	projectId?: string;
	occurredAt?: string;
	highlights: CommonspaceSearchHighlight[];
	target: CommonspaceSearchTarget;
}

export interface CommonspaceSearchRequest {
	query: string;
	kinds?: CommonspaceSearchKind[];
	projectId?: string;
	limit?: number;
}

export interface CommonspaceSearchResponse {
	query: string;
	results: CommonspaceSearchResult[];
	appliedFilters: { kinds: CommonspaceSearchKind[]; projectId: string | null };
	truncated: boolean;
}
