import { McpAuthenticationStatus } from "@commonspace/shared";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import {
	AgentSettingsPane,
	ChannelSettingsPane,
	HarnessCapabilities,
} from "../CommonspaceContextSettings";
import {
	codexCapabilityInventory,
	createStoryStore,
	populatedCapabilityInventory,
	storyBootstrap,
} from "./story-fixtures";

const meta = {
	title: "Pages/CommonspaceContextSettings",
	component: ChannelSettingsPane,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className="min-h-screen w-full bg-background">
				<Story />
			</div>
		),
	],
	args: {
		bootstrap: storyBootstrap,
		id: "channel-design",
		store: createStoryStore(storyBootstrap),
		onClose: fn(),
	},
} satisfies Meta<typeof ChannelSettingsPane>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ChannelSettings: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.queryByLabelText("Channel model"),
		).not.toBeInTheDocument();
		await expect(
			canvas.queryByLabelText("Channel reasoning"),
		).not.toBeInTheDocument();
		await expect(
			canvas.queryByLabelText("Channel instructions"),
		).not.toBeInTheDocument();
		await expect(canvas.getByText("Pinned messages & notes")).toBeVisible();
		await expect(
			canvas.getByRole("region", { name: "Context brief" }),
		).toBeVisible();
		await expect(
			canvas.queryByLabelText("Channel summary"),
		).not.toBeInTheDocument();
		await userEvent.click(canvas.getByRole("button", { name: "Edit context" }));
		await expect(canvas.getByLabelText("Channel summary")).toBeVisible();
		await userEvent.click(canvas.getByRole("button", { name: "Cancel edit" }));
		await expect(
			canvas.queryByLabelText("Channel summary"),
		).not.toBeInTheDocument();
	},
};

export const AgentSettings: Story = {
	render: () => (
		<AgentSettingsPane
			bootstrap={storyBootstrap}
			id="agent-hermes"
			store={createStoryStore(storyBootstrap, {
				inspectAgentCapabilities: async () => populatedCapabilityInventory,
			})}
			onClose={fn()}
		/>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByText("read_file")).toBeVisible();
		await expect(canvas.getByText("Unavailable")).toBeVisible();
		await expect(canvas.getByText("Inspection failed")).toBeVisible();
		await userEvent.type(canvas.getByLabelText("Search capabilities"), "write");
		await expect(canvas.getByText("write_file")).toBeVisible();
		await expect(canvas.queryByText("read_file")).not.toBeInTheDocument();
	},
};

function ConfiguredModelScenario() {
	const staleBootstrap = {
		...storyBootstrap,
		agents: storyBootstrap.agents.map((agent) =>
			agent.id === "agent-hermes" ? { ...agent, model: null } : agent,
		),
	};
	const [bootstrap, setBootstrap] = useState(staleBootstrap);
	const [store] = useState(() =>
		createStoryStore(staleBootstrap, {
			discoverAgents: async () => {
				setBootstrap(storyBootstrap);
			},
			inspectAgentCapabilities: async () => populatedCapabilityInventory,
		}),
	);
	return (
		<AgentSettingsPane
			bootstrap={bootstrap}
			id="agent-hermes"
			store={store}
			onClose={fn()}
		/>
	);
}

export const AgentConfiguredModel: Story = {
	render: () => <ConfiguredModelScenario />,
	play: async ({ canvasElement }) => {
		await expect(
			await within(canvasElement).findByLabelText("Native model"),
		).toHaveValue("gpt-5.6-sol");
	},
};

function CodexMcpAuthenticationScenario({ fail = false }: { fail?: boolean }) {
	const [store] = useState(() => {
		let authenticated = false;
		return createStoryStore(storyBootstrap, {
			inspectAgentCapabilities: async () => ({
				...codexCapabilityInventory,
				groups: codexCapabilityInventory.groups.map((group) => ({
					...group,
					items: group.items.map((item) =>
						item.name === "Context catalog" && authenticated
							? {
									...item,
									authentication: McpAuthenticationStatus.Authenticated,
								}
							: item,
					),
				})),
			}),
			authenticateAgentMcp: async () => {
				if (fail) {
					authenticated = true;
					throw new Error("Could not confirm native MCP sign-in.");
				}
				authenticated = true;
			},
		});
	});
	return (
		<AgentSettingsPane
			bootstrap={storyBootstrap}
			id="agent-codex"
			store={store}
			onClose={fn()}
		/>
	);
}

export const AgentCapabilitiesPopulatedVisual: Story = {
	render: () => <CodexMcpAuthenticationScenario />,
};

export const AgentMcpAuthentication: Story = {
	render: () => <CodexMcpAuthenticationScenario />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByText("Not authenticated")).toBeVisible();
		await expect(canvas.getByText("Native OAuth unavailable")).toBeVisible();
		await expect(
			canvas.getByRole("button", { name: "Reauthenticate Issue tracker" }),
		).toBeVisible();
		await userEvent.click(
			canvas.getByRole("button", { name: "Authenticate Context catalog" }),
		);
		await expect(
			await canvas.findByRole("button", {
				name: "Reauthenticate Context catalog",
			}),
		).toBeVisible();
		await expect(
			canvas.queryByText("Not authenticated"),
		).not.toBeInTheDocument();
	},
};

export const AgentMcpAuthenticationExpired: Story = {
	render: () => (
		<div className="mx-auto max-w-3xl p-8">
			<HarnessCapabilities
				agentId="agent-opencode"
				store={createStoryStore(storyBootstrap, {
					inspectAgentCapabilities: async () => ({
						agentId: "agent-opencode",
						checkedAt: "2026-09-24T00:00:00.000Z",
						groups: [
							{
								id: "mcp",
								status: "available",
								source: "opencode mcp auth list --pure",
								notice:
									"Native OAuth token status. Connection health is not checked.",
								items: [
									{
										name: "Issue tracker",
										status: "configured",
										authentication: McpAuthenticationStatus.Expired,
									},
								],
							},
						],
					}),
				})}
			/>
		</div>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByText("Authentication expired"),
		).toBeVisible();
		await expect(
			canvas.getByRole("button", { name: "Reauthenticate Issue tracker" }),
		).toBeVisible();
	},
};

export const AgentMcpAuthenticationFailure: Story = {
	render: () => <CodexMcpAuthenticationScenario fail />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			await canvas.findByRole("button", {
				name: "Authenticate Context catalog",
			}),
		);
		await expect(await canvas.findByRole("alert")).toHaveTextContent(
			"Could not confirm native MCP sign-in.",
		);
		await expect(
			canvas.getByRole("button", { name: "Authenticate Context catalog" }),
		).toBeEnabled();
		await userEvent.click(
			canvas.getByRole("button", { name: "Refresh capabilities" }),
		);
		await expect(
			await canvas.findByRole("button", {
				name: "Reauthenticate Context catalog",
			}),
		).toBeVisible();
		await expect(canvas.queryByRole("alert")).not.toBeInTheDocument();
	},
};

export const AgentCapabilitiesLoading: Story = {
	render: () => (
		<AgentSettingsPane
			bootstrap={storyBootstrap}
			id="agent-hermes"
			store={createStoryStore(storyBootstrap, {
				inspectAgentCapabilities: () => new Promise(() => undefined),
			})}
			onClose={fn()}
		/>
	),
	play: async ({ canvasElement }) => {
		await expect(
			within(canvasElement).getByText("Inspecting native capabilities…"),
		).toBeVisible();
	},
};

export const AgentCapabilitiesError: Story = {
	render: () => (
		<AgentSettingsPane
			bootstrap={storyBootstrap}
			id="agent-hermes"
			store={createStoryStore(storyBootstrap, {
				inspectAgentCapabilities: async () => {
					throw new Error("Native harness did not answer.");
				},
			})}
			onClose={fn()}
		/>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByText("Capability inspection failed"),
		).toBeVisible();
		await expect(
			canvas.getByText("Native harness did not answer."),
		).toBeVisible();
	},
};

let resolveOldAgentRequest:
	| ((inventory: typeof populatedCapabilityInventory) => void)
	| undefined;

function StaleAgentResponseScenario() {
	const [agentId, setAgentId] = useState("agent-hermes");
	const [store] = useState(() =>
		createStoryStore(storyBootstrap, {
			inspectAgentCapabilities: (requestedAgentId) => {
				if (requestedAgentId === "agent-hermes") {
					return new Promise((resolve) => {
						resolveOldAgentRequest = resolve;
					});
				}
				return Promise.resolve({
					...populatedCapabilityInventory,
					agentId: requestedAgentId,
					groups: [
						{
							id: "tools" as const,
							status: "available" as const,
							source: "Codex native tool registry",
							notice: "Names reflect current configuration.",
							items: [{ name: "new_agent_tool", status: "enabled" }],
						},
					],
				});
			},
		}),
	);
	return (
		<div className="w-[420px] p-5">
			<button type="button" onClick={() => setAgentId("agent-codex")}>
				Switch test agent
			</button>
			<HarnessCapabilities key={agentId} agentId={agentId} store={store} />
		</div>
	);
}

export const AgentCapabilitiesIgnoreLateAgentResponse: Story = {
	render: () => <StaleAgentResponseScenario />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		if (resolveOldAgentRequest === undefined) {
			throw new Error("old agent capability request was not started");
		}
		await userEvent.click(
			canvas.getByRole("button", { name: "Switch test agent" }),
		);
		await expect(await canvas.findByText("new_agent_tool")).toBeVisible();
		resolveOldAgentRequest(populatedCapabilityInventory);
		await waitFor(() =>
			expect(canvas.queryByText("read_file")).not.toBeInTheDocument(),
		);
	},
};

export const MissingChannel: Story = {
	args: { id: "missing-channel" },
};

export const AgentSettingsSaveFailure: Story = {
	render: () => (
		<AgentSettingsPane
			bootstrap={{
				...storyBootstrap,
				agents: storyBootstrap.agents.map((agent) => ({
					...agent,
					fullAccess: false,
					permissionPolicy: { source: "server", fullAccess: true },
				})),
			}}
			id="agent-hermes"
			store={createStoryStore(storyBootstrap, {
				mutate: async () => {
					throw new Error("Synthetic save failure");
				},
				inspectAgentCapabilities: async () => populatedCapabilityInventory,
			})}
			onClose={fn()}
		/>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.queryByText("Configuration verified from the native profile"),
		).not.toBeInTheDocument();
		await expect(
			canvas.getByRole("checkbox", { name: /Full access/ }),
		).toBeChecked();
		await expect(
			canvas.getByRole("checkbox", { name: /Full access/ }),
		).toBeDisabled();
		await userEvent.click(
			canvas.getByRole("button", { name: "Save agent settings" }),
		);
		await expect(
			await canvas.findByText("Synthetic save failure"),
		).toBeVisible();
	},
};
