import { type ReactNode, useState } from "react";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const categories = [
	["appearance", "Appearance"],
	["intelligence", "Intelligence"],
	["runs", "Agent runs"],
	["notifications", "Notifications"],
	["diagnostics", "Diagnostics"],
	["data", "Data"],
] as const;
type Category = (typeof categories)[number][0];

/** Category changes preserve mounted form drafts and each form's save boundary. */
export function WorkspaceSettingsLayout({
	sections,
}: {
	sections: Record<Category, ReactNode>;
}) {
	const [category, setCategory] = useState<Category>("appearance");
	const selectCategory = (value: string) => {
		const selected = categories.find(([id]) => id === value);
		if (selected !== undefined) setCategory(selected[0]);
	};
	return (
		<div className="@container/settings flex min-h-0 min-w-0 flex-1">
			<Tabs
				value={category}
				onValueChange={(value) => {
					if (typeof value === "string") selectCategory(value);
				}}
				orientation="vertical"
				className="workspace-settings-layout min-h-0 min-w-0 flex-1 flex-row gap-0 overflow-hidden @max-[640px]/settings:flex-col"
			>
				<div className="hidden shrink-0 border-b px-5 py-3 @max-[640px]/settings:block">
					<NativeSelect
						aria-label="Settings category"
						value={category}
						onChange={(event) => selectCategory(event.target.value)}
					>
						{categories.map(([id, label]) => (
							<option key={id} value={id}>
								{label}
							</option>
						))}
					</NativeSelect>
				</div>
				<TabsList
					aria-label="Settings categories"
					className="group-data-vertical/tabs:h-full w-[168px] shrink-0 justify-start gap-1 rounded-none border-r bg-transparent p-4 pt-7 @max-[640px]/settings:hidden"
				>
					{categories.map(([id, label]) => (
						<TabsTrigger
							key={id}
							value={id}
							className="h-9 flex-none justify-start rounded-md px-3 text-[13px] font-medium data-active:bg-selection data-active:shadow-none dark:data-active:bg-selection dark:data-active:border-transparent"
						>
							{label}
						</TabsTrigger>
					))}
				</TabsList>
				<div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
					{categories.map(([id]) => (
						<TabsContent
							key={id}
							value={id}
							keepMounted
							tabIndex={-1}
							className="settings-form mx-auto w-full max-w-[760px] px-8 py-8 pb-16 @max-[640px]/settings:px-5 @max-[640px]/settings:py-6"
						>
							{sections[id]}
						</TabsContent>
					))}
				</div>
			</Tabs>
		</div>
	);
}
