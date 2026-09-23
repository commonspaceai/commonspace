import {
	deriveCommonspaceInboxItems,
	deriveCommonspaceSessions,
} from "@commonspace/shared";
import { bench, describe } from "vitest";
import { benchmarkState } from "./fixtures.ts";

const state = benchmarkState();

describe("attention projections", () => {
	bench("derive Inbox items from the persisted transcript", () => {
		deriveCommonspaceInboxItems(state);
	});

	bench("derive session rows from the persisted transcript", () => {
		deriveCommonspaceSessions(state);
	});
});
