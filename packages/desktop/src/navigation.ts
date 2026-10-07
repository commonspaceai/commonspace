export type DesktopNavigation = "workspace" | "external" | "blocked";

export function desktopNavigation(
	address: string,
	workspaceUrl: string,
): DesktopNavigation {
	let url: URL;
	try {
		url = new URL(address);
	} catch {
		return "blocked";
	}
	if (url.username !== "" || url.password !== "") return "blocked";
	if (url.origin === workspaceUrl) return "workspace";
	return url.protocol === "https:" || url.protocol === "http:"
		? "external"
		: "blocked";
}
