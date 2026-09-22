import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { CommonspaceHostService } from "../server/dist/service.js";
import { findStartupUrl } from "./startup-output.mjs";

const repoRoot = process.cwd();
const defaultViewport = { width: 1180, height: 820 };
const stateRoot = await mkdtemp(join(tmpdir(), "commonspace-live-"));
const installedStateRoot = await mkdtemp(
	join(tmpdir(), "commonspace-installed-live-"),
);
let server;

let uiServer;
let installedServer;
let browser;
const experienceArtifactDir = join(
	repoRoot,
	"artifacts",
	"experience-audit",
	new Date().toISOString().replace(/[:.]/gu, "-"),
);

function artifactSegment(value) {
	return (
		value
			.normalize("NFKC")
			.replace(/[^a-zA-Z0-9._-]+/gu, "-")
			.replace(/^-+|-+$/gu, "")
			.slice(0, 80) || "state"
	);
}

async function inspectExperiencePage(page) {
	return page.evaluate(() => {
		const visible = (element) => {
			const rect = element.getBoundingClientRect();
			const style = globalThis.getComputedStyle(element);
			return (
				rect.width > 0 &&
				rect.height > 0 &&
				style.display !== "none" &&
				style.visibility !== "hidden" &&
				Number(style.opacity) > 0
			);
		};
		const nameOf = (element) =>
			(
				element.getAttribute("aria-label") ??
				element.getAttribute("title") ??
				element.textContent ??
				""
			)
				.replace(/\s+/gu, " ")
				.trim()
				.slice(0, 160);
		const rectOf = (element) => {
			const rect = element.getBoundingClientRect();
			return {
				x: Math.round(rect.x),
				y: Math.round(rect.y),
				width: Math.round(rect.width),
				height: Math.round(rect.height),
			};
		};
		const focused = globalThis.document.activeElement;
		const focusedVisible =
			focused instanceof globalThis.HTMLElement && visible(focused);
		const focusedStyle = focusedVisible
			? globalThis.getComputedStyle(focused)
			: null;
		const overlays = [
			...globalThis.document.querySelectorAll(
				'[role="dialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]',
			),
		]
			.filter(visible)
			.map((element) => ({
				role: element.getAttribute("role") ?? "popper",
				name: nameOf(element),
				rect: rectOf(element),
			}));
		const clippedText = [
			...globalThis.document.querySelectorAll(
				"p, span, strong, small, h1, h2, h3, button, a, label",
			),
		]
			.filter(visible)
			.map((element) => ({
				name: nameOf(element),
				overflowX: element.scrollWidth > element.clientWidth + 1,
				overflowY: element.scrollHeight > element.clientHeight + 1,
				clippedBy: ["hidden", "clip"].includes(
					globalThis.getComputedStyle(element).overflow,
				),
			}))
			.filter(
				(entry) => entry.name !== "" && (entry.overflowX || entry.overflowY),
			)
			.slice(0, 80);
		const hovered = globalThis.document.querySelector(":hover");
		return {
			url: globalThis.location.href,
			title: globalThis.document.title,
			viewport: {
				width: globalThis.innerWidth,
				height: globalThis.innerHeight,
			},
			document: {
				width: globalThis.document.documentElement.scrollWidth,
				height: globalThis.document.documentElement.scrollHeight,
				scrollX: globalThis.scrollX,
				scrollY: globalThis.scrollY,
				horizontalOverflow:
					globalThis.document.documentElement.scrollWidth >
					globalThis.innerWidth + 1,
			},
			focus:
				focusedVisible && focused instanceof globalThis.HTMLElement
					? {
							tag: focused.tagName.toLowerCase(),
							name: nameOf(focused),
							rect: rectOf(focused),
							outline: focusedStyle?.outline ?? "",
							boxShadow: focusedStyle?.boxShadow ?? "",
						}
					: null,
			hovered: hovered instanceof globalThis.HTMLElement ? nameOf(hovered) : "",
			overlays,
			clippedText,
		};
	});
}

async function captureExperienceState(page, { index, id, action, note }) {
	const segment = `${String(index).padStart(3, "0")}-${artifactSegment(id)}`;
	const screenshot = join(experienceArtifactDir, `${segment}.png`);
	const stateFile = join(experienceArtifactDir, `${segment}.json`);
	await page.screenshot({ path: screenshot, animations: "disabled" });
	const state = {
		index,
		id,
		action,
		note,
		screenshot,
		inspection: await inspectExperiencePage(page),
		ariaSnapshot: await page
			.locator("body")
			.ariaSnapshot()
			.catch(() => null),
	};
	await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
	return { ...state, stateFile };
}

async function requireExperienceVisible(locator, label) {
	try {
		const target = locator.first();
		await target.waitFor({ state: "visible" });
		return target;
	} catch (error) {
		const detail = error instanceof Error ? `: ${error.message}` : "";
		throw new Error(`experience audit could not find ${label}${detail}`, {
			cause: error,
		});
	}
}

async function selectColorMode(colorMode, name) {
	const radio = colorMode.getByRole("radio", {
		name: new RegExp(`^${name}\\b`, "u"),
	});
	await colorMode.getByText(name, { exact: true }).click();
	if (!(await radio.isChecked()))
		throw new Error(`${name} color mode radio was not checked`);
}

async function runExperienceAudit(page) {
	await mkdir(experienceArtifactDir, { recursive: true });
	const trace = join(experienceArtifactDir, "trace.zip");
	const context = page.context();
	const pageErrors = [];
	const consoleErrors = [];
	const failedRequests = [];
	const states = [];
	let stateIndex = 0;
	let failure = null;

	const onPageError = (error) => pageErrors.push(error.message);
	const onConsole = (message) => {
		if (message.type() === "error") consoleErrors.push(message.text());
	};
	const onRequestFailed = (request) => {
		const reason = request.failure()?.errorText ?? "unknown failure";
		if (!/aborted/iu.test(reason))
			failedRequests.push({
				method: request.method(),
				url: request.url(),
				reason,
			});
	};
	page.on("pageerror", onPageError);
	page.on("console", onConsole);
	page.on("requestfailed", onRequestFailed);
	await context.tracing.start({
		screenshots: true,
		snapshots: true,
		sources: true,
	});

	const capture = async (id, action, note) => {
		const state = await captureExperienceState(page, {
			index: stateIndex,
			id,
			action,
			note,
		});
		stateIndex += 1;
		return state;
	};
	const record = async (id, action, operation, note) => {
		const before = await capture(`${id}-before`, `${action}:before`, note);
		await operation();
		await page.waitForTimeout(120);
		const after = await capture(`${id}-after`, `${action}:after`, note);
		states.push({
			id,
			action,
			note,
			before: before.screenshot,
			after: after.screenshot,
		});
	};

	try {
		const homeButton = await requireExperienceVisible(
			page.getByRole("button", {
				name: /^Open Inbox(?:, \d+ unread)?$/u,
			}),
			"the Inbox navigation button",
		);
		await record(
			"return-home",
			"click",
			async () => {
				await homeButton.click();
				await requireExperienceVisible(
					page.getByRole("main", { name: "Inbox" }),
					"the Inbox home surface",
				);
			},
			"Return to the home surface before replaying interaction states.",
		);
		await capture(
			"home-rest",
			"initial",
			"Home at the canonical desktop viewport.",
		);

		const searchButton = await requireExperienceVisible(
			page.getByRole("button", {
				name: "Search messages, channels, and agents",
				exact: true,
			}),
			"the global search button",
		);
		await record(
			"topbar-search-hover",
			"hover",
			() => searchButton.hover(),
			"Hover state for the global search control.",
		);
		await record(
			"topbar-search-focus",
			"focus",
			() => searchButton.focus(),
			"Keyboard focus state for the global search control.",
		);

		const channelActionButton = await requireExperienceVisible(
			page.getByRole("button", {
				name: "More actions for verification",
				exact: true,
			}),
			"the verification channel action button",
		);
		await record(
			"channel-actions-hover",
			"hover",
			() => channelActionButton.hover(),
			"Hover reveals the channel action affordance.",
		);
		await record(
			"channel-actions-open",
			"click",
			async () => {
				await channelActionButton.click();
				await requireExperienceVisible(
					page.getByRole("menu"),
					"the channel action menu",
				);
			},
			"Open the channel action menu and inspect its anchoring and density.",
		);
		await record(
			"channel-actions-escape",
			"keyboard Escape",
			async () => {
				await page.keyboard.press("Escape");
				await page.getByRole("menu").waitFor({ state: "detached" });
			},
			"Escape closes the channel action menu.",
		);

		const channelButton = await requireExperienceVisible(
			page.getByRole("button", {
				name: /^Open channel verification(?:, \d+ unread)?$/u,
			}),
			"the verification channel",
		);
		await record(
			"channel-open",
			"click",
			async () => {
				await channelButton.click();
				await requireExperienceVisible(
					page.getByLabel("Commonspace conversation"),
					"the Commonspace conversation",
				);
			},
			"Open the channel from the sidebar.",
		);

		const composer = await requireExperienceVisible(
			page.getByLabel("Post in verification"),
			"the verification composer",
		);
		await record(
			"composer-focus",
			"focus",
			() => composer.focus(),
			"Keyboard focus state for the conversation composer.",
		);
		await record(
			"composer-project-suggestion",
			"type @@",
			async () => {
				await composer.fill("@@");
				await requireExperienceVisible(
					page.getByRole("option", {
						name: /@@verification-project.*Verification Project/iu,
					}),
					"the project suggestion",
				);
			},
			"Open the project-reference suggestion state in the composer.",
		);
		await record(
			"composer-suggestion-escape",
			"keyboard Escape",
			async () => {
				await page.keyboard.press("Escape");
				await composer.fill("");
			},
			"Dismiss the project suggestion and restore the empty composer.",
		);

		const settingsButton = await requireExperienceVisible(
			page.getByRole("button", { name: "Commonspace settings", exact: true }),
			"the Commonspace settings button",
		);
		await record(
			"settings-open",
			"click",
			async () => {
				await settingsButton.click();
				await requireExperienceVisible(
					page.getByRole("group", { name: "Color mode" }),
					"the color mode group",
				);
			},
			"Open settings and inspect the appearance controls.",
		);
		const colorMode = await requireExperienceVisible(
			page.getByRole("group", { name: "Color mode" }),
			"the color mode group",
		);
		await record(
			"color-mode-dark",
			"click Dark",
			async () => {
				await selectColorMode(colorMode, "Dark");
				await page.waitForFunction(() =>
					globalThis.document.documentElement.classList.contains("dark"),
				);
			},
			"Dark theme after an explicit color-mode click.",
		);
		await record(
			"color-mode-light",
			"click Light",
			async () => {
				await selectColorMode(colorMode, "Light");
				await page.waitForFunction(() =>
					globalThis.document.documentElement.classList.contains("light"),
				);
			},
			"Light theme restored after an explicit color-mode click.",
		);
		const closeSettingsButton = await requireExperienceVisible(
			page.getByRole("button", { name: "Close settings", exact: true }),
			"the close settings button",
		);
		await record(
			"settings-close",
			"click",
			async () => {
				await closeSettingsButton.click();
				await page
					.getByRole("group", { name: "Color mode" })
					.waitFor({ state: "detached" });
			},
			"Close settings and return to the conversation.",
		);

		await record(
			"search-open",
			"click",
			async () => {
				await searchButton.click();
				await requireExperienceVisible(
					page.getByRole("dialog", { name: "Search Commonspace" }),
					"the Commonspace search dialog",
				);
			},
			"Open Search from the top bar.",
		);
		const searchInput = await requireExperienceVisible(
			page.getByRole("searchbox", { name: "Search Commonspace", exact: true }),
			"the Commonspace search input",
		);
		await record(
			"search-query",
			"type verification",
			async () => {
				await searchInput.fill("verification");
				await requireExperienceVisible(
					page.getByRole("listbox", { name: "Commonspace search results" }),
					"the Commonspace search results",
				);
			},
			"Search results after entering a real fixture query.",
		);
		await record(
			"search-keyboard-next",
			"keyboard ArrowDown",
			() => page.keyboard.press("ArrowDown"),
			"Keyboard selection state in Search.",
		);
		await record(
			"search-close",
			"keyboard Escape",
			async () => {
				await page.keyboard.press("Escape");
				await page
					.getByRole("dialog", { name: "Search Commonspace" })
					.waitFor({ state: "detached" });
			},
			"Escape closes Search and returns to the conversation.",
		);
	} catch (error) {
		failure = {
			message: error instanceof Error ? error.message : String(error),
		};
		try {
			const failed = await capture("failure", "failure", failure.message);
			states.push({
				id: "failure",
				action: "failure",
				note: failure.message,
				after: failed.screenshot,
			});
		} catch {
			// Preserve the original interaction failure when page capture is unavailable.
		}
		throw error;
	} finally {
		await context.tracing.stop({ path: trace });
		await writeFile(
			join(experienceArtifactDir, "audit.json"),
			`${JSON.stringify(
				{
					viewport: defaultViewport,
					artifactDir: experienceArtifactDir,
					trace,
					visualReviewRequired: true,
					states,
					pageErrors,
					consoleErrors,
					failedRequests,
					failure,
				},
				null,
			)}\n`,
		);
		page.off("pageerror", onPageError);
		page.off("console", onConsole);
		page.off("requestfailed", onRequestFailed);
	}

	return {
		artifactDir: experienceArtifactDir,
		trace,
		visualReviewRequired: true,
		states: states.length,
		pageErrors,
		consoleErrors,
		failedRequests,
	};
}

function waitForUrl(child, pattern, label) {
	return new Promise((resolve, reject) => {
		let output = "";
		const timer = setTimeout(() => {
			reject(new Error(`${label} did not start in time\n${output}`));
		}, 15_000);
		const inspect = (chunk) => {
			output += chunk.toString();
			const url = findStartupUrl(output, pattern);
			if (url === undefined) return;
			clearTimeout(timer);
			resolve(url);
		};
		child.stdout.on("data", inspect);
		child.stderr.on("data", inspect);
		child.once("exit", (code) => {
			clearTimeout(timer);
			reject(
				new Error(
					`${label} exited before startup (${String(code)})\n${output}`,
				),
			);
		});
	});
}

async function stopProcess(child) {
	if (
		child === undefined ||
		child.exitCode !== null ||
		child.signalCode !== null
	)
		return;
	const exit = once(child, "exit");
	child.kill("SIGTERM");
	await Promise.race([
		exit,
		new Promise((resolve) => setTimeout(resolve, 5_000)),
	]);
	if (child.exitCode === null && child.signalCode === null) {
		child.kill("SIGKILL");
		await exit;
	}
}

async function seedExperienceFixture(root) {
	await mkdir(experienceArtifactDir, { recursive: true });
	const referenceRoot = join(root, "reference");
	const sourceRoot = join(root, "src");
	await mkdir(referenceRoot, { recursive: true });
	await mkdir(sourceRoot, { recursive: true });
	await writeFile(
		join(root, "README.md"),
		"# Visual verification fixture\n\nThis file exists to exercise Project file surfaces.\n",
	);
	await writeFile(
		join(sourceRoot, "main.ts"),
		'export function fixtureEntry(): string { return "ready"; }\n',
	);
	await writeFile(
		join(referenceRoot, "review-notes.md"),
		"# Review notes\n\nKeep the conversation surface dense but readable.\n",
	);

	const fixtureAgents = [
		{
			id: "codex",
			displayName: "Review Bot",
			adapter: "codex",
			model: "fixture-model",
			status: "stopped",
			description: "Deterministic review agent for browser verification.",
		},
		{
			id: "hermes",
			displayName: "Design Critic",
			adapter: "hermes",
			model: "fixture-model",
			status: "stopped",
			description:
				"Deterministic visual review agent for browser verification.",
		},
	];
	const service = new CommonspaceHostService(
		{},
		{ root },
		{
			discoverAgents: async (adapter) =>
				fixtureAgents.filter((agent) => agent.adapter === adapter),
			routeAgents: async (input) => {
				const candidate = input.candidates[0];
				if (candidate === undefined)
					throw new Error("fixture routing has no candidate");
				return {
					mode: "parallel",
					assignments: [
						{
							agentId: candidate.id,
							projectIds: input.projects.map((project) => project.id),
						},
					],
					confidence: 0.99,
					reason: "Deterministic browser verification routing.",
				};
			},
			runAgent: async (input) => ({
				text:
					input.agent.id === "hermes"
						? "## Visual checkpoint\n\n- Hierarchy reviewed\n- Thread context preserved\n- Attachment and project references received\n\nThe fixture is ready for visual inspection."
						: "Review Bot completed the deterministic fixture request.\n\nThe workspace has a project, a thread, and follow-up evidence.",
			}),
		},
	);
	await service.initialize();
	try {
		for (const agent of fixtureAgents) {
			await service.discoverAgents(agent.adapter);
			await service.mutate({
				action: "add-discovered-agent",
				agentId: agent.id,
			});
			await service.mutate({
				action: "update-agent-profile",
				agentId: agent.id,
				displayName: agent.displayName,
				avatarEmoji: agent.id === "hermes" ? "D" : "R",
				accentColor: agent.id === "hermes" ? "#e879f9" : "#60a5fa",
			});
		}
		await service.updateRoutingConfiguration({
			provider: "harness",
			harnessAgentId: "codex",
		});

		let state = await service.mutate({
			action: "create-project",
			name: "Verification Project",
			paths: [root],
		});
		const verificationProject = state.projects.at(-1);
		if (verificationProject === undefined)
			throw new Error("fixture project was not created");
		state = await service.mutate({
			action: "create-project",
			name: "Reference Notes",
			paths: [referenceRoot],
		});
		const referenceProject = state.projects.at(-1);
		if (referenceProject === undefined)
			throw new Error("fixture reference project was not created");

		state = await service.mutate({
			action: "create-channel",
			name: "verification",
			agentIds: ["codex", "hermes"],
		});
		const verificationChannel = state.channels.at(-1);
		if (verificationChannel === undefined)
			throw new Error("fixture verification channel was not created");
		state = await service.mutate({
			action: "create-channel",
			name: "empty-state",
			agentIds: [],
		});
		state = await service.mutate({
			action: "create-channel",
			name: "needs-attention",
			agentIds: [],
		});
		const attentionChannel = state.channels.at(-1);
		if (attentionChannel === undefined)
			throw new Error("fixture attention channel was not created");
		await service.mutate({
			action: "set-channel-context",
			channelId: verificationChannel.id,
			instructions: "Keep replies concise and cite the exact visual evidence.",
		});
		await service.mutate({
			action: "set-channel-memory",
			channelId: verificationChannel.id,
			summary: "Visual review is anchored to the current desktop workspace.",
			decisions: [
				"Use real interaction states, not static display assertions.",
			],
			openQuestions: ["Does the selected state remain legible in dark mode?"],
		});

		const rootResponse = await service.send({
			conversation: { kind: "channel", id: verificationChannel.id },
			projectIds: [verificationProject.id, referenceProject.id],
			text: "@review-bot Review the workspace hierarchy and report a concise checkpoint.",
		});
		await service.whenIdle();
		const threadId = rootResponse.thread?.id;
		if (threadId === undefined)
			throw new Error("fixture root message did not create a thread");
		const rootMessageId = rootResponse.accepted.id;

		await service.send({
			conversation: { kind: "channel", id: verificationChannel.id },
			threadId,
			targetAgentId: "hermes",
			projectIds: [verificationProject.id],
			text: "@design-critic Compare the visual hierarchy against the review notes.",
		});
		await service.whenIdle();

		const attachmentResponse = await service.send({
			conversation: { kind: "channel", id: verificationChannel.id },
			threadId,
			targetAgentId: "codex",
			projectIds: [verificationProject.id],
			text: "Evidence bundle attached for the next checkpoint.",
			attachments: [
				{
					name: "review-pixel.png",
					mimeType: "image/png",
					data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
				},
			],
			files: [
				{
					name: "review-notes.txt",
					mimeType: "text/plain",
					data: "c2hhcmVkIHZpc3VhbCByZXZpZXc=",
				},
			],
		});
		await service.whenIdle();

		await service.send({
			conversation: { kind: "channel", id: verificationChannel.id },
			projectIds: [referenceProject.id],
			text: "A long evidence note keeps the review surface realistic:\n\n- The selected row must remain visible.\n- The composer must not collide with the thread pane.\n- Metadata should wrap intentionally, never clip.\n\n```text\nvisual-review-fixture\n```",
		});
		await service.whenIdle();

		await service.send({
			conversation: { kind: "dm", id: "codex" },
			projectIds: [verificationProject.id],
			text: "Show the current project context and the next review step.",
		});
		await service.whenIdle();

		await service.send({
			conversation: { kind: "channel", id: attentionChannel.id },
			projectIds: [verificationProject.id],
			text: "Unassigned request that should remain visible as a failed routing state.",
		});
		await service.whenIdle();

		const channelMessages =
			service.snapshot().messages[`channel:${verificationChannel.id}`] ?? [];
		const agentReplyIds = channelMessages
			.filter((message) => message.authorType === "agent")
			.map((message) => message.id);
		const dmMessages = service.snapshot().messages["dm:codex"] ?? [];
		const dmReply = dmMessages.find(
			(message) => message.authorType === "agent",
		);
		const attachmentId = attachmentResponse.accepted.attachments?.[0]?.id;
		if (agentReplyIds[0] !== undefined) {
			await service.mutate({
				action: "set-inbox-item-unread",
				messageId: agentReplyIds[0],
				unread: true,
			});
			await service.mutate({
				action: "set-inbox-item-saved",
				messageId: agentReplyIds[0],
				saved: true,
			});
		}
		if (dmReply !== undefined) {
			await service.mutate({
				action: "set-inbox-item-unread",
				messageId: dmReply.id,
				unread: true,
			});
		}
		await service.addPin({
			scope: { kind: "thread", id: threadId },
			kind: "message",
			messageId: rootMessageId,
		});
		if (attachmentId !== undefined) {
			await service.addPin({
				scope: { kind: "thread", id: threadId },
				kind: "attachment",
				messageId: attachmentResponse.accepted.id,
				attachmentId,
			});
		}
		const snapshot = service.snapshot();
		const baseline = {
			version: "commonspace-visual-baseline-v1",
			agents: snapshot.agents.map((agent) => agent.displayName),
			projects: snapshot.projects.map((project) => project.name),
			channels: snapshot.channels.map((channel) => channel.name),
			messageCount: Object.values(snapshot.messages).reduce(
				(total, messages) => total + messages.length,
				0,
			),
			threadCount: snapshot.threads.length,
			pinCount: snapshot.pins.length,
			attachmentCount: snapshot.messages
				? Object.values(snapshot.messages)
						.flat()
						.reduce(
							(total, message) =>
								total +
								(message.attachments?.length ?? 0) +
								(message.files?.length ?? 0),
							0,
						)
				: 0,
		};
		await writeFile(
			join(experienceArtifactDir, "baseline.json"),
			`${JSON.stringify(baseline, null, 2)}\n`,
		);
		await service.close();
		return baseline;
	} catch (error) {
		await service.close();
		throw error;
	}
}

try {
	const baseline = await seedExperienceFixture(stateRoot);
	server = spawn(process.execPath, [join(repoRoot, "server/dist/index.js")], {
		cwd: repoRoot,
		env: {
			...process.env,
			COMMONSPACE_HOME: stateRoot,
			COMMONSPACE_PORT: "0",
			NODE_ENV: "production",
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	const url = await waitForUrl(
		server,
		/Commonspace is running at (http:\/\/127\.0\.0\.1:\d+)/,
		"Commonspace server",
	);
	const health = await fetch(`${url}/api/health`);
	if (!health.ok)
		throw new Error(`health check failed with ${String(health.status)}`);
	const healthBody = await health.json();
	if (healthBody.status !== "ok")
		throw new Error("health check returned an unexpected body");
	const rootResponse = await fetch(url);
	if (!rootResponse.ok)
		throw new Error(
			`API root health check failed with ${String(rootResponse.status)}`,
		);
	const rootBody = await rootResponse.json();
	if (rootBody.status !== "ok")
		throw new Error("API root health check returned an unexpected body");
	const assetResponse = await fetch(`${url}/index.html`);
	if (assetResponse.status !== 404)
		throw new Error(
			`API server served UI asset with status ${String(assetResponse.status)}`,
		);
	uiServer = spawn(
		process.execPath,
		[
			join(repoRoot, "ui/node_modules/vite/bin/vite.js"),
			"preview",
			"--host",
			"127.0.0.1",
			"--port",
			"0",
		],
		{
			cwd: join(repoRoot, "ui"),
			env: {
				...process.env,
				COMMONSPACE_API_TARGET: url,
			},
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	const uiUrl = await waitForUrl(
		uiServer,
		/Local:\s+(http:\/\/127\.0\.0\.1:\d+)/,
		"Vite preview",
	);

	const browserOptions = { headless: true };
	if (process.env.COMMONSPACE_USE_SYSTEM_CHROME === "1")
		browserOptions.channel = "chrome";
	browser = await chromium.launch(browserOptions);
	const page = await browser.newPage({
		viewport: { width: 1180, height: 820 },
	});
	const pageErrors = [];
	page.on("pageerror", (error) => {
		pageErrors.push(error.message);
	});
	await page.goto(uiUrl, { waitUntil: "domcontentloaded" });
	await page.getByRole("main", { name: "Inbox" }).waitFor({ state: "visible" });
	await page.getByLabel("Commonspace browser").waitFor({ state: "visible" });
	if (pageErrors.length > 0)
		throw new Error(`browser errors: ${pageErrors.join(" | ")}`);

	const verificationChannel = page.getByRole("button", {
		name: /^Open channel verification(?:, \d+ unread)?$/u,
	});
	await verificationChannel.waitFor({ state: "visible" });
	await verificationChannel.focus();
	await page.keyboard.press("Enter");
	await page
		.getByLabel("Commonspace conversation")
		.waitFor({ state: "visible" });
	const composer = page.getByLabel("Post in verification");
	await composer.waitFor({ state: "visible" });
	for (const label of [
		"Infer Projects",
		"Use no Projects",
		"Choose Projects",
	]) {
		if ((await page.getByRole("button", { name: label }).count()) !== 0)
			throw new Error(`unexpected Project picker: ${label}`);
	}
	await composer.fill("@@");
	const projectSuggestion = page.getByRole("option", {
		name: /@@verification-project.*Verification Project/iu,
	});
	await projectSuggestion.waitFor({ state: "visible" });
	await composer.fill("");

	const settingsButton = page.getByRole("button", {
		name: "Commonspace settings",
	});
	await settingsButton.click();
	const colorMode = page.getByRole("group", { name: "Color mode" });
	await colorMode.waitFor({ state: "visible" });
	await selectColorMode(colorMode, "Light");
	await page.waitForFunction(() =>
		globalThis.document.documentElement.classList.contains("light"),
	);
	const lightPalette = await page.evaluate(() =>
		globalThis
			.getComputedStyle(globalThis.document.documentElement)
			.getPropertyValue("--background")
			.trim(),
	);
	await selectColorMode(colorMode, "Dark");
	await page.waitForFunction(() =>
		globalThis.document.documentElement.classList.contains("dark"),
	);
	const darkPalette = await page.evaluate(() => ({
		darkClass: globalThis.document.documentElement.classList.contains("dark"),
		background: globalThis
			.getComputedStyle(globalThis.document.documentElement)
			.getPropertyValue("--background")
			.trim(),
	}));
	if (
		!darkPalette.darkClass ||
		lightPalette === "" ||
		darkPalette.background === lightPalette
	) {
		throw new Error("light/dark palette verification failed");
	}
	await selectColorMode(colorMode, "Light");
	await page.waitForFunction(() =>
		globalThis.document.documentElement.classList.contains("light"),
	);
	await page.getByLabel("Close settings").click();

	await page.keyboard.press("Control+K");
	await page
		.getByRole("dialog", { name: "Search Commonspace" })
		.waitFor({ state: "visible" });
	await page.keyboard.press("Escape");
	await page
		.getByRole("dialog", { name: "Search Commonspace" })
		.waitFor({ state: "detached" });
	const experienceAudit = await runExperienceAudit(page);
	installedServer = spawn(
		process.execPath,
		[join(repoRoot, "server/dist/index.js")],
		{
			cwd: repoRoot,
			env: {
				...process.env,
				COMMONSPACE_HOME: installedStateRoot,
				COMMONSPACE_PORT: "0",
				COMMONSPACE_UI_ROOT: join(repoRoot, "ui/dist"),
				NODE_ENV: "production",
			},
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	const installedUrl = await waitForUrl(
		installedServer,
		/Commonspace is running at (http:\/\/127\.0\.0\.1:\d+)/,
		"Installed Commonspace server",
	);
	const installedPage = await browser.newPage({
		viewport: { width: 1180, height: 820 },
	});
	const installedPageErrors = [];
	installedPage.on("pageerror", (error) => {
		installedPageErrors.push(error.message);
	});
	await installedPage.goto(installedUrl, { waitUntil: "domcontentloaded" });
	await installedPage
		.getByRole("main", { name: "Workspace setup" })
		.waitFor({ state: "visible" });
	await installedPage
		.getByLabel("Commonspace browser")
		.waitFor({ state: "visible" });
	if (installedPageErrors.length > 0)
		throw new Error(
			`installed browser errors: ${installedPageErrors.join(" | ")}`,
		);

	process.stdout.write(
		`${JSON.stringify({
			apiUrl: url,
			uiUrl,
			installedUrl,
			health: healthBody,
			apiServer: true,
			browserMounted: true,
			installedBrowserMounted: true,
			installedOnboardingMounted: true,
			keyboardNavigation: true,
			lightDarkPalettes: true,
			baseline,
			experienceAudit,
		})}\n`,
	);
} finally {
	await browser?.close();
	await stopProcess(installedServer);
	await stopProcess(uiServer);
	await stopProcess(server);
	await rm(stateRoot, { recursive: true, force: true });
	await rm(installedStateRoot, { recursive: true, force: true });
}
