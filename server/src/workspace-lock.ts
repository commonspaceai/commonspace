import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import lockfile from "proper-lockfile";

export async function acquireWorkspaceLock(
	root: string,
): Promise<() => Promise<void>> {
	await mkdir(root, { recursive: true, mode: 0o700 });
	const canonicalRoot = await realpath(root);
	let release: () => Promise<void>;
	try {
		release = await lockfile.lock(canonicalRoot, {
			lockfilePath: join(canonicalRoot, ".host.lock"),
		});
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ELOCKED") {
			throw new Error(
				"This Commonspace workspace is already open in another host. Close that host before starting this one.",
				{ cause: error },
			);
		}
		throw error;
	}
	let releasing: Promise<void> | undefined;
	return () => {
		releasing ??= release();
		return releasing;
	};
}
