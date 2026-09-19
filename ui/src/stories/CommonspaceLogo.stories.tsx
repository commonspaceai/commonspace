import type { Meta, StoryObj } from "@storybook/react-vite";
import { CommonspaceLogo } from "../design-system/CommonspaceLogo";

const meta = {
	title: "Design System/CommonspaceLogo",
	component: CommonspaceLogo,
	parameters: { layout: "centered" },
} satisfies Meta<typeof CommonspaceLogo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Accessible: Story = {
	args: { className: "size-20" },
};

export const Decorative: Story = {
	args: { decorative: true, className: "size-12" },
};

export const Monochrome: Story = {
	parameters: { layout: "fullscreen" },
	render: () => (
		<div className="grid min-h-screen grid-cols-2">
			{[
				{ label: "Black on white", className: "bg-white text-black" },
				{ label: "White on black", className: "bg-black text-white" },
			].map(({ label, className }) => (
				<section
					key={label}
					aria-label={label}
					className={`flex flex-col items-center justify-center gap-16 p-12 ${className}`}
				>
					<CommonspaceLogo className="size-64" />
					<div className="flex items-end gap-8">
						{[
							{ label: "16", className: "size-4" },
							{ label: "20", className: "size-5" },
							{ label: "24", className: "size-6" },
							{ label: "32", className: "size-8" },
						].map(({ label: size, className: sizeClass }) => (
							<div key={size} className="flex flex-col items-center gap-3">
								<CommonspaceLogo decorative className={sizeClass} />
								<span className="text-xs">{size}px</span>
							</div>
						))}
					</div>
				</section>
			))}
		</div>
	),
};
