import { z } from "zod";
import { AGENT_ADAPTER_KINDS } from "./agent-adapters.js";
import type { CommonspaceMutation } from "./contracts.js";

const notificationSettingsSchema = z.strictObject({
	enabled: z.boolean(),
	replies: z.boolean(),
	mentions: z.boolean(),
	permissions: z.boolean(),
	failures: z.boolean(),
	sound: z.boolean(),
});

export const CommonspaceMutationSchema = z.discriminatedUnion(
	"action",
	[
		z.strictObject({ action: z.literal("mark-inbox-read") }),
		z.strictObject({
			action: z.literal("mark-inbox-item-read"),
			messageId: z.string(),
		}),
		z.strictObject({
			action: z.literal("set-inbox-item-unread"),
			messageId: z.string(),
			unread: z.boolean(),
		}),
		z.strictObject({
			action: z.literal("set-inbox-item-saved"),
			messageId: z.string(),
			saved: z.boolean(),
		}),
		z.strictObject({
			action: z.literal("set-session-followed"),
			sessionId: z.string(),
			followed: z.boolean(),
		}),
		z.strictObject({
			action: z.literal("set-session-muted"),
			sessionId: z.string(),
			muted: z.boolean(),
		}),
		z.strictObject({
			action: z.literal("set-notifications"),
			notifications: notificationSettingsSchema,
		}),
		z.strictObject({
			action: z.literal("create-project"),
			name: z.string(),
			paths: z.array(z.string()),
		}),
		z.strictObject({
			action: z.literal("add-project-path"),
			projectId: z.string(),
			path: z.string(),
		}),
		z.strictObject({
			action: z.literal("remove-project"),
			projectId: z.string(),
		}),
		z.strictObject({
			action: z.literal("create-channel"),
			name: z.string(),
			agentIds: z.array(z.string()),
		}),
		z.strictObject({
			action: z.literal("set-channel-agents"),
			channelId: z.string(),
			agentIds: z.array(z.string()),
		}),
		z.strictObject({
			action: z.literal("set-channel-context"),
			channelId: z.string(),
			instructions: z.string(),
		}),
		z.strictObject({
			action: z.literal("set-channel-memory"),
			channelId: z.string(),
			summary: z.string(),
			decisions: z.array(z.string()).optional(),
			openQuestions: z.array(z.string()).optional(),
		}),
		z.strictObject({
			action: z.literal("set-channel-configuration"),
			channelId: z.string(),
			agentIds: z.array(z.string()),
			instructions: z.string(),
			summary: z.string(),
			decisions: z.array(z.string()).optional(),
			openQuestions: z.array(z.string()).optional(),
		}),
		z.strictObject({
			action: z.literal("set-defaults"),
			maxAgentsPerTurn: z.number().optional(),
			memoryThreads: z.number().optional(),
		}),
		z.strictObject({
			action: z.literal("add-discovered-agent"),
			agentId: z.string(),
			adapter: z.enum(AGENT_ADAPTER_KINDS).optional(),
			fullAccess: z.boolean().optional(),
		}),
		z.strictObject({
			action: z.literal("update-agent-profile"),
			agentId: z.string(),
			displayName: z.string(),
			avatarEmoji: z.string().optional(),
			accentColor: z.string().optional(),
			fullAccess: z.boolean().optional(),
		}),
		z.strictObject({ action: z.literal("remove-agent"), agentId: z.string() }),
		z.strictObject({ action: z.literal("reset-dm"), agentId: z.string() }),
		z.strictObject({
			action: z.literal("remove-channel"),
			channelId: z.string(),
		}),
	],
	{ error: "unknown mutation" },
) satisfies z.ZodType<CommonspaceMutation>;
