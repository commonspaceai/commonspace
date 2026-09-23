import { bench, describe } from "vitest";
import { applyProjectMutation } from "../server/src/state/project-mutations.ts";
import { benchmarkBootstrap, benchmarkState } from "./fixtures.ts";

const state = benchmarkState();
const bootstrap = benchmarkBootstrap(state);
const serializedState = JSON.stringify(state);
const project = state.projects[0];
if (project === undefined) throw new Error("Missing benchmark Project");

const mutationDependencies = {
	ids: () => "benchmark-identifier",
	now: () => "2026-01-02T00:00:00.000Z",
};

describe("workspace state", () => {
	bench("serialize the bootstrap payload", () => {
		JSON.stringify(bootstrap);
	});

	bench("parse the persisted workspace state", () => {
		JSON.parse(serializedState);
	});

	bench("remove a Project across every reference", () => {
		applyProjectMutation(
			state,
			{ action: "remove-project", projectId: project.id },
			mutationDependencies,
		);
	});
});
