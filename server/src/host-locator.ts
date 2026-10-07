import {
	createHash,
	randomBytes,
	randomUUID,
	timingSafeEqual,
} from "node:crypto";
import {
	chmod,
	mkdir,
	open,
	readFile,
	realpath,
	rename,
	rm,
} from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import {
	PRIVATE_HOST_LOCATOR_FILE_NAME,
	type PrivateHostLocator,
	PrivateHostLocatorSchema,
} from "@commonspace/shared";

export function requestHasBrowserHeaders(
	req: Pick<IncomingMessage, "headers">,
): boolean {
	return (
		req.headers.origin !== undefined ||
		req.headers.referer !== undefined ||
		req.headers["sec-fetch-site"] !== undefined
	);
}

export function bearerMatches(
	authorization: string | undefined,
	expectedToken: string,
): boolean {
	if (authorization === undefined || !authorization.startsWith("Bearer "))
		return false;
	const actual = createHash("sha256").update(authorization.slice(7)).digest();
	const expected = createHash("sha256").update(expectedToken).digest();
	return timingSafeEqual(actual, expected);
}

export async function createHostLocator(
	root: string,
	url: string,
): Promise<PrivateHostLocator> {
	return {
		version: 1,
		root: await realpath(root),
		id: randomUUID(),
		token: randomBytes(32).toString("base64url"),
		pid: process.pid,
		url,
	};
}

export async function publishHostLocator(
	locator: PrivateHostLocator,
): Promise<void> {
	const directory = join(locator.root, "host");
	const path = join(directory, PRIVATE_HOST_LOCATOR_FILE_NAME);
	const temporary = join(
		directory,
		`.${PRIVATE_HOST_LOCATOR_FILE_NAME}.${randomUUID()}.tmp`,
	);
	try {
		await mkdir(directory, { recursive: true, mode: 0o700 });
		await chmod(directory, 0o700);
		const file = await open(temporary, "wx", 0o600);
		try {
			await file.writeFile(JSON.stringify(locator));
			await file.sync();
		} finally {
			await file.close();
		}
		await rename(temporary, path);
	} catch (error) {
		throw new Error("Commonspace could not publish host ownership.", {
			cause: error,
		});
	} finally {
		await rm(temporary, { force: true }).catch(() => undefined);
	}
}

export async function removeHostLocator(
	locator: PrivateHostLocator,
): Promise<void> {
	const path = join(locator.root, "host", PRIVATE_HOST_LOCATOR_FILE_NAME);
	try {
		const serialized = await readFile(path, "utf8");
		const value: unknown = JSON.parse(serialized);
		const current = PrivateHostLocatorSchema.safeParse(value);
		if (current.success && current.data.id === locator.id) await rm(path);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT")
			return;
		throw new Error("Commonspace could not remove host ownership.", {
			cause: error,
		});
	}
}
