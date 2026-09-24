import { COMMONSPACE_EXPORT_VERSION } from "@commonspace/shared";

export interface WorkspaceArchiveSource {
	value: unknown;
}

export interface WorkspaceImportProject {
	id: string;
	name: string;
	rootCount: number;
}

export interface WorkspaceImportCandidate {
	source: WorkspaceArchiveSource;
	projects: WorkspaceImportProject[];
}

function isObject<T>(value: T): value is T & object {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseWorkspaceImport(
	text: string,
): WorkspaceImportCandidate | null {
	try {
		const value: unknown = JSON.parse(text);
		if (
			!isObject(value) ||
			!("format" in value) ||
			value.format !== "commonspace-workspace" ||
			!("version" in value) ||
			(value.version !== 1 && value.version !== COMMONSPACE_EXPORT_VERSION) ||
			!("workspace" in value) ||
			!isObject(value.workspace) ||
			!("projects" in value.workspace) ||
			!Array.isArray(value.workspace.projects)
		)
			return null;

		const projectValues: unknown[] = value.workspace.projects;
		const projects: WorkspaceImportProject[] = [];
		const projectIds = new Set<string>();
		for (const projectValue of projectValues) {
			if (
				!isObject(projectValue) ||
				!("id" in projectValue) ||
				typeof projectValue.id !== "string" ||
				projectValue.id === "" ||
				projectIds.has(projectValue.id) ||
				!("name" in projectValue) ||
				typeof projectValue.name !== "string" ||
				projectValue.name.trim() === "" ||
				!("rootCount" in projectValue) ||
				typeof projectValue.rootCount !== "number" ||
				!Number.isSafeInteger(projectValue.rootCount) ||
				projectValue.rootCount < 1 ||
				projectValue.rootCount > 32
			)
				return null;
			projectIds.add(projectValue.id);
			projects.push({
				id: projectValue.id,
				name: projectValue.name,
				rootCount: projectValue.rootCount,
			});
		}
		return { source: { value }, projects };
	} catch {
		return null;
	}
}
