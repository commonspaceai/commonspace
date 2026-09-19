import type {
	CommonspaceRoutingConfiguration,
	UnconfiguredRouting,
	UpdateRoutingConfigurationRequest,
} from "@commonspace/shared";
import {
	CommonspaceRoutingProvider,
	RoutingConfigurationIssue,
} from "@commonspace/shared";
import { z } from "zod";

const agentIdSchema = z.string().trim().min(1).max(200);
export const RoutingConfigurationRequest = z.strictObject({
	provider: z.literal(CommonspaceRoutingProvider.Harness),
	harnessAgentId: agentIdSchema,
}) satisfies z.ZodType<UpdateRoutingConfigurationRequest>;
export type RoutingConfigurationRequest = z.infer<
	typeof RoutingConfigurationRequest
>;
const SavedRoutingConfiguration = RoutingConfigurationRequest.extend({
	version: z.literal(3),
});
export type SavedRoutingConfiguration = z.infer<
	typeof SavedRoutingConfiguration
>;
export type PrivateRoutingConfiguration =
	| SavedRoutingConfiguration
	| UnconfiguredRouting;

export const missingRouting: UnconfiguredRouting = {
	provider: CommonspaceRoutingProvider.Unconfigured,
	reason: RoutingConfigurationIssue.Missing,
	message:
		"Choose an inference agent in Commonspace settings for Channel routing and context compaction.",
};
export const invalidRouting: UnconfiguredRouting = {
	provider: CommonspaceRoutingProvider.Unconfigured,
	reason: RoutingConfigurationIssue.Invalid,
	message:
		"Saved inference configuration could not be read or is invalid. Choose an inference agent in Commonspace settings.",
};

export function loadSavedRoutingConfiguration(
	serialized: string,
): SavedRoutingConfiguration | undefined {
	let value: unknown;
	try {
		value = JSON.parse(serialized);
	} catch {
		return undefined;
	}
	const current = SavedRoutingConfiguration.safeParse(value);
	return current.success ? current.data : undefined;
}

export function publicRoutingConfiguration(
	configuration: PrivateRoutingConfiguration,
): CommonspaceRoutingConfiguration {
	if (configuration.provider === CommonspaceRoutingProvider.Unconfigured)
		return { ...configuration };
	return {
		provider: CommonspaceRoutingProvider.Harness,
		harnessAgentId: configuration.harnessAgentId,
	};
}

export function prepareRoutingConfiguration(
	request: RoutingConfigurationRequest,
	agentIds: readonly string[],
): SavedRoutingConfiguration {
	const id = request.harnessAgentId;
	if (!agentIds.includes(id))
		throw new Error("Inference agent must be a configured agent");
	return {
		version: 3,
		provider: CommonspaceRoutingProvider.Harness,
		harnessAgentId: id,
	};
}
