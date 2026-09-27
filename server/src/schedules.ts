import type { CommonspaceScheduleTiming } from "@commonspace/shared";
import { CronExpressionParser } from "cron-parser";

export function validatedScheduleTiming(
	timing: CommonspaceScheduleTiming,
): CommonspaceScheduleTiming {
	if (timing.kind === "once") {
		const runAt = new Date(timing.runAt);
		if (!Number.isFinite(runAt.getTime()))
			throw new Error("Choose a valid date and time.");
		return { kind: "once", runAt: runAt.toISOString() };
	}
	const expression = timing.expression.trim().replace(/\s+/gu, " ");
	if (expression.length > 100 || expression.split(" ").length !== 5)
		throw new Error("Use a five-field cron expression.");
	let timeZone: string;
	try {
		timeZone = new Intl.DateTimeFormat("en", {
			timeZone: timing.timeZone,
		}).resolvedOptions().timeZone;
		CronExpressionParser.parse(expression, { tz: timeZone }).next();
	} catch {
		throw new Error("Choose a valid cron expression and time zone.");
	}
	return { kind: "cron", expression, timeZone };
}

export function nextCronRun(
	timing: Extract<CommonspaceScheduleTiming, { kind: "cron" }>,
	after: string,
): string {
	return CronExpressionParser.parse(timing.expression, {
		currentDate: after,
		tz: timing.timeZone,
	})
		.next()
		.toDate()
		.toISOString();
}
