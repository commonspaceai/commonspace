import type { Preview } from "@storybook/react-vite";
import MockDate from "mockdate";
import { mswLoader } from "msw-storybook-addon/csf3";
import "../src/index.css";
import { mswHandlers } from "./msw-handlers";

const preview: Preview = {
	globalTypes: {
		appearance: {
			description: "Preview appearance",
			toolbar: {
				icon: "circlehollow",
				dynamicTitle: true,
				items: [
					{ value: "light", title: "Light" },
					{ value: "dark", title: "Dark" },
				],
			},
		},
	},
	initialGlobals: { appearance: "light" },
	decorators: [
		(Story, context) => (
			<Story key={context.globals.appearance === "dark" ? "dark" : "light"} />
		),
	],
	loaders: [mswLoader()],
	beforeEach: ({ globals, msw }) => {
		msw.use(...mswHandlers);
		const root = document.documentElement;
		const previousClasses = root.className;
		const previousColorScheme = root.style.colorScheme;
		const previousMode = window.localStorage.getItem("commonspace-color-mode");
		const mode = globals.appearance === "dark" ? "dark" : "light";
		MockDate.set("2026-09-03T10:00:00Z");
		root.classList.remove("light", "dark", "system");
		root.classList.add(mode);
		root.style.colorScheme = mode;
		window.localStorage.setItem("commonspace-color-mode", mode);
		return () => {
			MockDate.reset();
			root.className = previousClasses;
			root.style.colorScheme = previousColorScheme;
			if (previousMode === null)
				window.localStorage.removeItem("commonspace-color-mode");
			else window.localStorage.setItem("commonspace-color-mode", previousMode);
		};
	},
	parameters: {
		options: {
			storySort: {
				order: [
					"Workspace",
					"Review",
					"Foundations",
					"Design System",
					"Pages",
					"Shell",
					"Screens",
					"*",
				],
			},
		},
		layout: "fullscreen",
		controls: {
			matchers: {
				color: /(background|color)$/iu,
				date: /Date$/iu,
			},
		},
		a11y: {
			test: "error",
		},
	},
};

export default preview;
