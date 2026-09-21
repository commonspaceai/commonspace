import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_PICKER_OUTPUT_BYTES = 64 * 1024;
const LINUX_DIRECTORY_PICKERS = [
	{
		command: "zenity",
		args: [
			"--file-selection",
			"--directory",
			"--title=Choose a Commonspace project folder",
		],
	},
	{
		command: "kdialog",
		args: [
			"--getexistingdirectory",
			".",
			"--title",
			"Choose a Commonspace project folder",
		],
	},
] as const;

async function runPickerCommand(
	command: string,
	args: readonly string[],
): Promise<string> {
	const { stdout } = await execFileAsync(command, args, {
		encoding: "utf8",
		maxBuffer: MAX_PICKER_OUTPUT_BYTES,
		windowsHide: true,
	});
	return stdout;
}

async function selectDirectoryOnLinux(): Promise<string> {
	let unavailablePicker: Error | undefined;
	for (const picker of LINUX_DIRECTORY_PICKERS) {
		try {
			return await runPickerCommand(picker.command, picker.args);
		} catch (error) {
			if (!(error instanceof Error) || !("code" in error)) throw error;
			if (error.code === 1) return "";
			if (error.code !== "ENOENT") throw error;
			unavailablePicker = error;
		}
	}
	throw new Error("folder selection requires zenity or kdialog on Linux", {
		cause: unavailablePicker,
	});
}

async function selectedDirectoryOutput(
	platform: NodeJS.Platform,
): Promise<string> {
	if (platform === "darwin") {
		return runPickerCommand("osascript", [
			"-e",
			"try",
			"-e",
			'set selectedFolder to choose folder with prompt "Choose a Commonspace project folder"',
			"-e",
			"return POSIX path of selectedFolder",
			"-e",
			"on error number -128",
			"-e",
			'return ""',
			"-e",
			"end try",
		]);
	}
	if (platform === "win32") {
		const script = [
			"Add-Type -AssemblyName System.Windows.Forms",
			"$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
			'$dialog.Description = "Choose a Commonspace project folder"',
			"$dialog.ShowNewFolderButton = $true",
			"if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }",
		].join("; ");
		return runPickerCommand("powershell.exe", [
			"-NoProfile",
			"-NonInteractive",
			"-STA",
			"-Command",
			script,
		]);
	}
	if (platform === "linux") return selectDirectoryOnLinux();
	throw new Error(`folder selection is not supported on ${platform}`);
}

export async function resolveProjectDirectory(
	selectedPath: string,
): Promise<string> {
	if (!isAbsolute(selectedPath))
		throw new Error("folder picker returned a non-absolute path");
	const path = await realpath(selectedPath);
	if (!(await stat(path)).isDirectory())
		throw new Error("folder picker selection is not a directory");

	try {
		const repositoryRoot = (
			await runPickerCommand("git", [
				"-C",
				path,
				"rev-parse",
				"--show-toplevel",
			])
		).replace(/[\r\n]+$/, "");
		if (repositoryRoot !== "" && isAbsolute(repositoryRoot))
			return realpath(repositoryRoot);
	} catch {
		// A regular local folder is still a valid project directory.
	}
	return path;
}

export async function selectLocalDirectory(): Promise<string | null> {
	const output = (await selectedDirectoryOutput(process.platform)).replace(
		/[\r\n]+$/,
		"",
	);
	if (output === "") return null;
	return resolveProjectDirectory(output);
}
