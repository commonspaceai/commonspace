import { z } from "zod";
import type { CommonspaceState } from "./contracts.js";
import { parseCommonspaceState } from "./response-schemas.js";

const githubRepository =
	/^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?$/u;

export const GitHubRepositoryUrlSchema = z
	.string()
	.trim()
	.regex(githubRepository, "Use a GitHub repository HTTPS or SSH URL.")
	.refine((value) => {
		const match = githubRepository.exec(value.replace(/\.git$/u, ""));
		return (
			match !== null &&
			match[2] !== undefined &&
			![".", ".."].includes(match[2])
		);
	}, "Use a GitHub repository HTTPS or SSH URL.")
	.transform((value) => `${value.replace(/\.git$/u, "")}.git`);

export const GitHubBranchSchema = z
	.string()
	.min(1)
	.max(255)
	.refine(
		(value) =>
			value !== "@" &&
			value !== "HEAD" &&
			!value.startsWith("-") &&
			!value.endsWith(".") &&
			!value.includes("..") &&
			!value.includes("@{") &&
			!/[~^:?*[\\]/u.test(value) &&
			[...value].every(
				(character) => character > " " && character !== "\u007f",
			) &&
			value
				.split("/")
				.every(
					(part) =>
						part !== "" && !part.startsWith(".") && !part.endsWith(".lock"),
				),
		"Use a valid Git branch name.",
	);

export const ImportGitHubProjectRequestSchema = z.strictObject({
	repositoryUrl: GitHubRepositoryUrlSchema,
	branch: GitHubBranchSchema.optional(),
	name: z
		.string()
		.transform((value) => value.normalize("NFKC").trim().replace(/\s+/gu, " "))
		.pipe(
			z
				.string()
				.min(1)
				.max(80)
				.regex(/[\p{L}\p{N}]/u),
		),
});

export type ImportGitHubProjectRequest = z.infer<
	typeof ImportGitHubProjectRequestSchema
>;

export interface ImportGitHubProjectResponse {
	projectId: string;
	state: CommonspaceState;
}

export const ImportGitHubProjectResponseSchema = z
	.strictObject({
		projectId: z.string().min(1),
		state: z.unknown().transform(parseCommonspaceState),
	})
	.refine(
		(value) =>
			value.state.projects.some((project) => project.id === value.projectId),
		"The imported Project is missing from the workspace response.",
	);
