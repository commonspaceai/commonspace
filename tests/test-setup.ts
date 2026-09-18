const nativeFetch = globalThis.fetch;
const localHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);

interface RoutingEvaluationNetwork {
	COMMONSPACE_ROUTING_EVAL?: string | undefined;
	COMMONSPACE_ROUTING_BASE_URL?: string | undefined;
	COMMONSPACE_ROUTING_JEV_MODEL?: string | undefined;
}

export function permitsLiveRoutingRequest(
	url: URL,
	configuration: RoutingEvaluationNetwork,
): boolean {
	if (configuration.COMMONSPACE_ROUTING_EVAL !== "1") return false;
	if (
		configuration.COMMONSPACE_ROUTING_JEV_MODEL !== undefined &&
		url.origin === "https://api.typesafe.ai"
	)
		return true;
	if (configuration.COMMONSPACE_ROUTING_BASE_URL === undefined) return false;
	try {
		return (
			url.origin === new URL(configuration.COMMONSPACE_ROUTING_BASE_URL).origin
		);
	} catch {
		return false;
	}
}

globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
	const url = new URL(input instanceof Request ? input.url : String(input));
	if (
		(url.protocol === "http:" || url.protocol === "https:") &&
		!localHosts.has(url.hostname) &&
		!permitsLiveRoutingRequest(url, process.env)
	) {
		return Promise.reject(
			new Error(`External network access is disabled in tests (${url.origin})`),
		);
	}
	return nativeFetch(input, init);
};
