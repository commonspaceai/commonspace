import type { CommonspaceSearchRequest } from "@commonspace/shared";
import { bench, describe } from "vitest";
import { searchCommonspace } from "../server/src/search.ts";
import { benchmarkBootstrap, benchmarkState } from "./fixtures.ts";

const bootstrap = benchmarkBootstrap(benchmarkState());
const project = bootstrap.state.projects[0];
if (project === undefined) throw new Error("Missing benchmark Project");

const filteredRequest: CommonspaceSearchRequest = {
	query: "benchmark needle",
	kinds: ["message", "trace", "run"],
	projectId: project.id,
	limit: 24,
};

describe("unified search", () => {
	bench("ranked query over the whole workspace", async () => {
		await searchCommonspace(bootstrap, {
			query: "benchmark needle",
			limit: 24,
		});
	});

	bench("query filtered by kind and Project", async () => {
		await searchCommonspace(bootstrap, filteredRequest);
	});

	bench("empty query listing Channels, Agents, and Projects", async () => {
		await searchCommonspace(bootstrap, { query: "", limit: 24 });
	});
});
