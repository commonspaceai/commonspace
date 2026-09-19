export function projectApiUrl(
	projectId: string,
	endpoint: "files" | "file" | "changes" | "diff",
	rootIndex: number,
	path?: string,
): string {
	const query = new URLSearchParams({ root: String(rootIndex) });
	if (path !== undefined && path !== "") query.set("path", path);
	return `/api/projects/${encodeURIComponent(projectId)}/${endpoint}?${query.toString()}`;
}

async function responseError(response: Response): Promise<string> {
	try {
		const body: { error?: unknown } = await response.json();
		if (typeof body.error === "string" && body.error !== "") return body.error;
	} catch {
		// Keep stable fallback below for non-JSON proxy errors.
	}
	return `Request failed (${String(response.status)})`;
}

export async function fetchProjectJson<T>(
	url: string,
	signal: AbortSignal,
	fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<T> {
	const response = await fetcher(url, {
		headers: { accept: "application/json" },
		signal,
	});
	if (!response.ok) throw new Error(await responseError(response));
	const value: T = await response.json();
	return value;
}

export async function fetchProjectText(
	url: string,
	signal: AbortSignal,
	fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<string> {
	const response = await fetcher(url, {
		headers: { accept: "text/plain" },
		signal,
	});
	if (!response.ok) throw new Error(await responseError(response));
	return response.text();
}

export async function fetchProjectBlob(
	url: string,
	signal: AbortSignal,
	accept: "image/*" | "video/*",
	fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<Blob> {
	const response = await fetcher(url, {
		headers: { accept },
		signal,
	});
	if (!response.ok) throw new Error(await responseError(response));
	return response.blob();
}

export function formatFileSize(size: number | undefined): string {
	if (size === undefined) return "";
	if (size < 1_024) return `${String(size)} B`;
	if (size < 1_024 * 1_024)
		return `${(size / 1_024).toFixed(size < 10 * 1_024 ? 1 : 0)} KB`;
	return `${(size / (1_024 * 1_024)).toFixed(1)} MB`;
}

export function folderName(path: string): string {
	return path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path;
}
