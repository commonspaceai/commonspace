import { z } from "zod";

/** @internal Private locator filename recognized by the credential-file policy. */
export const PRIVATE_HOST_LOCATOR_FILE_NAME = "host-control-token.json";

/** @internal Read only by the host and its local desktop controller. */
export const PrivateHostLocatorSchema = z.strictObject({
	version: z.literal(1),
	root: z.string().regex(/^(?:\/|[A-Za-z]:[\\/])/u),
	id: z.uuid(),
	token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
	pid: z.number().int().positive(),
	url: z
		.string()
		.regex(/^http:\/\/127\.0\.0\.1(?::[1-9]\d{0,4})?$/u)
		.refine((value) => {
			const port = value.split(":")[2];
			return port === undefined || (port !== "80" && Number(port) <= 65_535);
		}),
});
/** @internal Contains a private host-control capability. Never send to clients. */
export type PrivateHostLocator = z.infer<typeof PrivateHostLocatorSchema>;

/** @internal Returned only through authenticated loopback host control. */
export const HostControlIdentitySchema = PrivateHostLocatorSchema.pick({
	id: true,
	pid: true,
});
/** @internal Local controller verification response. */
export type HostControlIdentity = z.infer<typeof HostControlIdentitySchema>;
