const nativeFetch = globalThis.fetch;
const localHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);

globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
	const url = new URL(input instanceof Request ? input.url : String(input));
	if (
		(url.protocol === "http:" || url.protocol === "https:") &&
		!localHosts.has(url.hostname)
	) {
		return Promise.reject(
			new Error(`External network access is disabled in tests (${url.origin})`),
		);
	}
	return nativeFetch(input, init);
};
