import type { IncomingHttpHeaders } from "node:http";
import type { ProxyOptions } from "vite";

const apiTarget = process.env.COMMONSPACE_API_TARGET ?? "http://127.0.0.1:3100";

interface ProxyRequestHeaders {
	setHeader(name: string, value: string): void;
}

function forwardBrowserHost(
	proxyRequest: ProxyRequestHeaders,
	request: { headers: Pick<IncomingHttpHeaders, "host"> },
): void {
	const browserHost = request.headers.host;
	if (browserHost !== undefined)
		proxyRequest.setHeader("x-forwarded-host", browserHost);
}

export function apiProxy(): ProxyOptions {
	return {
		target: apiTarget,
		configure(proxy) {
			proxy.on("proxyReq", (proxyReq, req) => {
				forwardBrowserHost(proxyReq, req);
			});
		},
	};
}
