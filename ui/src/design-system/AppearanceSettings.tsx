import { CheckIcon } from "lucide-react";
import type { CommonspaceColorMode } from "../theme";

const modes = [
	{ value: "light", name: "Light", description: "A bright, clear workspace." },
	{
		value: "dark",
		name: "Dark",
		description: "A quieter canvas in low light.",
	},
	{
		value: "system",
		name: "System",
		description: "Match your device’s appearance.",
	},
] as const;

export function AppearanceSettings({
	value,
	onChange,
}: {
	value: CommonspaceColorMode;
	onChange?: (mode: CommonspaceColorMode) => void;
}) {
	return (
		<section aria-labelledby="workspace-appearance-title">
			<h2
				id="workspace-appearance-title"
				className="text-xl font-semibold tracking-tight"
			>
				Appearance
			</h2>
			<p className="mt-2 text-sm text-muted-foreground">
				Choose how Commonspace looks on this device.
			</p>
			<fieldset className="mt-7 grid grid-cols-3 gap-4 max-[1100px]:grid-cols-1">
				<legend className="sr-only">Color mode</legend>
				{modes.map((mode) => (
					<label
						key={mode.value}
						className="group relative cursor-pointer rounded-xl border bg-card p-3 has-checked:border-primary has-checked:ring-1 has-checked:ring-primary has-focus-visible:outline-2 has-focus-visible:outline-offset-4 has-focus-visible:outline-ring"
					>
						<input
							className="sr-only"
							type="radio"
							name="commonspace-color-mode"
							value={mode.value}
							checked={value === mode.value}
							onChange={() => onChange?.(mode.value)}
						/>
						<span
							className="appearance-preview"
							data-appearance={mode.value}
							aria-hidden="true"
						>
							<span className="appearance-preview-bar">
								<i />
								<i />
								<i />
							</span>
							<span className="appearance-preview-nav">
								<i />
								<i />
								<i />
							</span>
							<span className="appearance-preview-page">
								<i />
								<i />
								<i />
							</span>
						</span>
						<span className="mt-3 flex items-center justify-between text-sm font-medium">
							{mode.name}
							{value === mode.value && (
								<CheckIcon className="size-4 text-primary" aria-hidden="true" />
							)}
						</span>
						<span className="mt-1 block text-xs leading-5 text-muted-foreground">
							{mode.description}
						</span>
					</label>
				))}
			</fieldset>
		</section>
	);
}
