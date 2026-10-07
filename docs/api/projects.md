# Project files

Project file lookup and streaming are implemented in [`server/src/project-files.ts`](../../server/src/project-files.ts). GitHub import belongs to [`server/src/project-import.ts`](../../server/src/project-import.ts). Routes and error mapping are in [`server/src/app.ts`](../../server/src/app.ts).

| Method and path                        | Request                                                                                    | Success response                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `POST /api/projects/import-github` | [ImportGitHubProjectRequest](../../packages/shared/src/project-import.ts): repository URL, Project name, and optional branch | `201` [ImportGitHubProjectResponse](../../packages/shared/src/project-import.ts) |
| `GET /api/projects/:projectId/files`   | Query `root` (non-negative root index, default `0`), `path` (relative path, default empty) | `200` [ProjectDirectoryResponse](../../packages/shared/src/project-files.ts) |
| `GET /api/projects/:projectId/file`    | Query `root`, `path`; optional `Range` header for video                                    | `200` or `206` file bytes with content type and inline disposition           |
| `POST /api/projects/:projectId/open`   | [ProjectEditorTarget](../../server/src/project-files.ts): `path`, `rootIndex`, `line`      | `200` JSON `{ "opened": true }`                                              |
| `GET /api/projects/:projectId/changes` | Query `root`                                                                               | `200` [ProjectGitStatusResponse](../../packages/shared/src/project-files.ts) |
| `GET /api/projects/:projectId/diff`    | Query `root`, `path`                                                                       | `200` [ProjectGitDiffResponse](../../packages/shared/src/project-files.ts)   |

The file route streams bytes. Its [ProjectFilePreview](../../packages/shared/src/project-files.ts) classification determines the content type and whether byte ranges are available. Project routes return a JSON error with `code` and `error` when a path, root, or file cannot be read.

Import accepts GitHub HTTPS or SSH URLs and clones into private managed storage on the host. Git authentication must already work on the host; import does not prompt for credentials. It registers a completed checkout as a normal Project folder. Conflicts return `409` without overwriting an existing checkout. Failed or cancelled partial clones are removed. File and diff browsing use the existing Project routes. Editor launch is local-only.
