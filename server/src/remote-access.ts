import type { IncomingMessage } from "node:http";
import { z } from "zod";

export const RemoteAccessConfigurationSchema = z.strictObject({
	origin: z.string().refine((value) => {
		try {
			const url = new URL(value);
			return url.protocol === "https:" && url.origin === value;
		} catch {
			return false;
		}
	}, "Remote access requires an exact HTTPS origin without a path."),
	ownerLogin: z.string().trim().min(1).max(320),
	port: z.number().int().min(0).max(65_535).default(47322),
});
export type RemoteAccessConfiguration = z.input<
	typeof RemoteAccessConfigurationSchema
>;
export type ConfiguredRemoteAccess = z.output<
	typeof RemoteAccessConfigurationSchema
>;

export function remoteAccessFromEnvironment(
	environment: NodeJS.ProcessEnv,
): RemoteAccessConfiguration | undefined {
	const origin = environment.COMMONSPACE_REMOTE_ORIGIN;
	const ownerLogin = environment.COMMONSPACE_REMOTE_OWNER_LOGIN;
	const port = environment.COMMONSPACE_REMOTE_PORT;
	if (origin === undefined && ownerLogin === undefined && port === undefined)
		return undefined;
	if (origin === undefined || ownerLogin === undefined)
		throw new Error(
			"COMMONSPACE_REMOTE_ORIGIN and COMMONSPACE_REMOTE_OWNER_LOGIN must be configured together.",
		);
	const configuration: RemoteAccessConfiguration = { origin, ownerLogin };
	if (port !== undefined) {
		if (!/^\d+$/u.test(port))
			throw new Error(
				"COMMONSPACE_REMOTE_PORT must be an integer from 0 to 65535.",
			);
		configuration.port = Number(port);
	}
	return configuration;
}

export function requestMatchesRemoteOrigin(
	req: Pick<IncomingMessage, "headers">,
	origin: string,
): boolean {
	if (req.headers.origin !== undefined) return req.headers.origin === origin;
	if (req.headers.referer !== undefined) {
		try {
			return new URL(req.headers.referer).origin === origin;
		} catch {
			return false;
		}
	}
	return req.headers["sec-fetch-site"] === "same-origin";
}

export function requestIsRemoteOwner(
	req: Pick<IncomingMessage, "headers">,
	configuration: ConfiguredRemoteAccess,
): boolean {
	return (
		req.headers.host?.toLowerCase() === new URL(configuration.origin).host &&
		req.headers["tailscale-user-login"] === configuration.ownerLogin
	);
}
