import type {
	CommonspaceAgentDefinition,
	CommonspaceAgentProfile,
	CommonspaceReasoning,
	HarnessCapabilityGroup,
} from "@commonspace/shared";
import type { AcpAgentProcessOptions, AcpRunInput } from "../acp-runtime.js";

/** Host-private configuration. It is never part of bootstrap or workspace exports. */
export interface AgentAdapterConfig {
	hermesPath?: string;
	codexPath?: string;
	claudeCodePath?: string;
	geminiPath?: string;
	opencodePath?: string;
	hermesAcpCommand?: string;
	hermesAcpArgs?: readonly string[];
	codexAcpCommand?: string;
	codexAcpArgs?: readonly string[];
	claudeCodeAcpCommand?: string;
	claudeCodeAcpArgs?: readonly string[];
	geminiAcpCommand?: string;
	geminiAcpArgs?: readonly string[];
	opencodeAcpCommand?: string;
	opencodeAcpArgs?: readonly string[];
}

export interface AgentSessionSettings {
	fullAccess: boolean;
	model: string | undefined;
	reasoning: CommonspaceReasoning | undefined;
}

export type NativeAgentLaunch = Pick<
	AcpAgentProcessOptions,
	"command" | "args" | "env" | "validateInitialization" | "validateSessionLoad"
>;

/** Adapter policy only; AcpAgentProcess and the host own execution and sessions. */
export interface NativeAgentAdapter {
	readonly privatePaths: readonly string[];
	/** Read existing identities without starting a model turn or changing native config. */
	discover(): Promise<CommonspaceAgentProfile[]>;
	/** Inspect browser-safe native metadata without starting a model turn. */
	inspectCapabilities(
		agent: CommonspaceAgentDefinition,
	): Promise<HarnessCapabilityGroup[]>;
	launch(
		agent: CommonspaceAgentProfile,
		fullAccess: boolean,
		signal: AbortSignal,
	): NativeAgentLaunch | Promise<NativeAgentLaunch>;
	sessionSettings(
		input: AgentSessionSettings,
	): Pick<AcpRunInput, "modeId" | "modelId" | "configOptions">;
}
