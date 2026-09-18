import type {
	CommonspaceCredentialStatus,
	CommonspaceRoutingConfiguration,
	UnconfiguredRouting,
	UpdateRoutingConfigurationRequest,
} from "@commonspace/shared";
import {
	CommonspaceRoutingProvider,
	CredentialSource,
	RoutingConfigurationIssue,
} from "@commonspace/shared";
import { z } from "zod";

const modelSchema = z.string().trim().min(1).max(200);
const keySchema = z.string().trim().min(1).max(10_000);
const baseUrlSchema = z
	.url()
	.max(2_000)
	.refine((value) => {
		const url = new URL(value);
		return (
			(url.protocol === "http:" || url.protocol === "https:") &&
			url.username === "" &&
			url.password === "" &&
			url.search === "" &&
			url.hash === ""
		);
	}, "Use an HTTP(S) base URL without credentials, a query, or a fragment")
	.transform((value) => new URL(value).toString().replace(/\/$/u, ""));
const jevSchema = z.strictObject({
	version: z.literal(2),
	enabled: z.boolean(),
	model: modelSchema,
	apiKey: keySchema.optional(),
});
const savedSchema = z.discriminatedUnion("provider", [
	z.strictObject({
		version: z.literal(2),
		provider: z.literal(CommonspaceRoutingProvider.Harness),
		harnessAgentId: modelSchema,
		jev: jevSchema.optional(),
	}),
	z.strictObject({
		version: z.literal(2),
		provider: z.literal(CommonspaceRoutingProvider.OpenAiCompatible),
		model: modelSchema,
		baseUrl: baseUrlSchema,
		apiKey: keySchema.optional(),
		jev: jevSchema.optional(),
	}),
]);
const legacyJevSchema = z.object({
	version: z.literal(1),
	model: modelSchema,
	apiKey: keySchema.optional(),
});
const legacySchema = z.discriminatedUnion("provider", [
	z.object({
		provider: z.literal(CommonspaceRoutingProvider.Harness),
		harnessAgentId: modelSchema,
		jev: legacyJevSchema.optional(),
	}),
	z.object({
		provider: z.literal(CommonspaceRoutingProvider.OpenAiCompatible),
		model: modelSchema,
		baseUrl: baseUrlSchema,
		apiKey: keySchema.optional(),
		jev: legacyJevSchema.optional(),
	}),
]);
export type SavedRoutingConfiguration = z.infer<typeof savedSchema>;
export type PrivateRoutingConfiguration =
	| SavedRoutingConfiguration
	| UnconfiguredRouting;
export const missingRouting: UnconfiguredRouting = {
	provider: CommonspaceRoutingProvider.Unconfigured,
	reason: RoutingConfigurationIssue.Missing,
	message: "Choose and save an inference provider in Commonspace settings.",
};
export const invalidRouting: UnconfiguredRouting = {
	provider: CommonspaceRoutingProvider.Unconfigured,
	reason: RoutingConfigurationIssue.Invalid,
	message:
		"Saved inference configuration could not be read or is invalid. No replacement provider was selected. Review and save the configuration in Commonspace settings.",
};

export function parseSavedRoutingConfiguration(
	serialized: string,
): PrivateRoutingConfiguration {
	let value: unknown;
	try {
		value = JSON.parse(serialized);
	} catch {
		return invalidRouting;
	}
	const envelope = z
		.object({ version: z.unknown().optional() })
		.safeParse(value);
	if (!envelope.success) return invalidRouting;
	if (envelope.data.version === 2) {
		const result = savedSchema.safeParse(value);
		return result.success ? result.data : invalidRouting;
	}
	if (envelope.data.version !== undefined) return invalidRouting;
	const legacy = legacySchema.safeParse(value);
	if (!legacy.success) return invalidRouting;
	const { jev, ...text } = legacy.data;
	const migrated: SavedRoutingConfiguration = { version: 2, ...text };
	if (jev !== undefined) migrated.jev = { ...jev, version: 2, enabled: true };
	return migrated;
}

export function openAiEnvironmentKey(
	baseUrl: string,
	environment: NodeJS.ProcessEnv,
): string | undefined {
	return new URL(baseUrl).origin === "https://api.openai.com"
		? environment.OPENAI_API_KEY?.trim() || undefined
		: undefined;
}
export function credentialStatus(
	savedKey: string | undefined,
	environmentKey: string | undefined,
): CommonspaceCredentialStatus {
	if (savedKey !== undefined)
		return { apiKeyConfigured: true, apiKeySource: CredentialSource.Saved };
	if (environmentKey?.trim())
		return {
			apiKeyConfigured: true,
			apiKeySource: CredentialSource.Environment,
		};
	return { apiKeyConfigured: false, apiKeySource: CredentialSource.None };
}
export function publicRoutingConfiguration(
	configuration: PrivateRoutingConfiguration,
	environment: NodeJS.ProcessEnv,
): CommonspaceRoutingConfiguration {
	if (configuration.provider === CommonspaceRoutingProvider.Unconfigured)
		return { ...configuration };
	const { jev } = configuration;
	const common =
		jev === undefined
			? {}
			: {
					jev: {
						enabled: jev.enabled,
						model: jev.model,
						...credentialStatus(jev.apiKey, environment.TYPESAFE_API_KEY),
					},
				};
	switch (configuration.provider) {
		case CommonspaceRoutingProvider.Harness:
			return {
				provider: CommonspaceRoutingProvider.Harness,
				harnessAgentId: configuration.harnessAgentId,
				...common,
			};
		case CommonspaceRoutingProvider.OpenAiCompatible:
			return {
				provider: CommonspaceRoutingProvider.OpenAiCompatible,
				model: configuration.model,
				baseUrl: configuration.baseUrl,
				...credentialStatus(
					configuration.apiKey,
					openAiEnvironmentKey(configuration.baseUrl, environment),
				),
				...common,
			};
		default:
			return unreachableRoutingProvider(configuration);
	}
}

function unreachableRoutingProvider(configuration: never): never {
	void configuration;
	throw new Error("Unsupported routing provider");
}

function updatedKey(
	previous: string | undefined,
	requested: string | null | undefined,
): string | undefined {
	if (requested === undefined) return previous;
	if (requested === null) return undefined;
	return keySchema.parse(requested);
}
function prepareTextProvider(
	request: UpdateRoutingConfigurationRequest,
	previous: PrivateRoutingConfiguration,
	agentIds: readonly string[],
): SavedRoutingConfiguration {
	switch (request.provider) {
		case CommonspaceRoutingProvider.Harness: {
			const id = modelSchema.parse(request.harnessAgentId);
			if (!agentIds.includes(id))
				throw new Error("Routing harness must be a configured agent");
			return {
				version: 2,
				provider: CommonspaceRoutingProvider.Harness,
				harnessAgentId: id,
			};
		}
		case CommonspaceRoutingProvider.OpenAiCompatible: {
			const baseUrl = baseUrlSchema.parse(
				request.baseUrl ?? "https://api.openai.com/v1",
			);
			const previousKey =
				previous.provider === CommonspaceRoutingProvider.OpenAiCompatible &&
				previous.baseUrl === baseUrl
					? previous.apiKey
					: undefined;
			const apiKey = updatedKey(previousKey, request.apiKey);
			return {
				version: 2,
				provider: CommonspaceRoutingProvider.OpenAiCompatible,
				model: modelSchema.parse(request.model),
				baseUrl,
				apiKey,
			};
		}
		default:
			return unreachableRoutingProvider(request);
	}
}

function prepareJevConfiguration(
	requested: UpdateRoutingConfigurationRequest["jev"],
	previous: SavedRoutingConfiguration["jev"],
): SavedRoutingConfiguration["jev"] {
	if (requested === undefined) return previous;
	if (requested === null)
		return previous === undefined ? undefined : { ...previous, enabled: false };
	const apiKey = updatedKey(previous?.apiKey, requested.apiKey);
	return {
		version: 2,
		enabled: true,
		model: modelSchema.parse(requested.model),
		apiKey,
	};
}

export function prepareRoutingConfiguration(
	request: UpdateRoutingConfigurationRequest,
	previous: PrivateRoutingConfiguration,
	agentIds: readonly string[],
): SavedRoutingConfiguration {
	const text = prepareTextProvider(request, previous, agentIds);
	const previousJev =
		previous.provider === CommonspaceRoutingProvider.Unconfigured
			? undefined
			: previous.jev;
	const jev = prepareJevConfiguration(request.jev, previousJev);
	return { ...text, jev };
}
