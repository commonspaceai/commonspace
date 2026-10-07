import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCommonspaceCli } from "../../server/src/index.ts";

const root = process.env.COMMONSPACE_HOME;
if (root === undefined) throw new Error("Missing synthetic workspace.");
const keepAlive = setInterval(() => undefined, 1_000);

try {
	await runCommonspaceCli({
		classifier: {
			classify: async () => null,
			close: async () => {
				clearInterval(keepAlive);
				await writeFile(join(root, "classifier-closed"), "closed");
			},
		},
	});
} catch (error) {
	clearInterval(keepAlive);
	throw error;
}
