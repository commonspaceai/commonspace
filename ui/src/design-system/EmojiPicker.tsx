import type { Emoji as EmojiData } from "emojibase";
import {
	ChevronDownIcon,
	Clock3Icon,
	CoffeeIcon,
	FlagIcon,
	Grid3X3Icon,
	HeartIcon,
	LightbulbIcon,
	Music2Icon,
	PawPrintIcon,
	PlaneIcon,
	SearchIcon,
	SmileIcon,
} from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";

const categories = [
	{ id: "all", label: "All emojis", icon: Grid3X3Icon },
	{ id: "recent", label: "Recent", icon: Clock3Icon },
	{ id: "people", label: "Smileys & people", icon: SmileIcon },
	{ id: "nature", label: "Animals & nature", icon: PawPrintIcon },
	{ id: "foods", label: "Food & drink", icon: CoffeeIcon },
	{ id: "activity", label: "Activities", icon: Music2Icon },
	{ id: "places", label: "Travel & places", icon: PlaneIcon },
	{ id: "objects", label: "Objects", icon: LightbulbIcon },
	{ id: "symbols", label: "Symbols", icon: HeartIcon },
	{ id: "flags", label: "Flags", icon: FlagIcon },
] as const;

type CategoryId = (typeof categories)[number]["id"];
type RecentEmoji = { id: string; native: string };

const recentStorageKey = "commonspace-recent-emojis";
const skinTones = [
	"Default",
	"Light",
	"Medium light",
	"Medium",
	"Medium dark",
	"Dark",
] as const;
const skinToneSwatches = [
	"👋",
	"👋🏻",
	"👋🏼",
	"👋🏽",
	"👋🏾",
	"👋🏿",
] as const;

function readRecent(): RecentEmoji[] {
	try {
		const stored: unknown = JSON.parse(
			localStorage.getItem(recentStorageKey) ?? "[]",
		);
		if (!Array.isArray(stored)) return [];
		return stored
			.filter(
				(value): value is RecentEmoji =>
					typeof value === "object" &&
					value !== null &&
					typeof value.id === "string" &&
					typeof value.native === "string" &&
					value.native.length <= 32,
			)
			.slice(0, 24);
	} catch {
		return [];
	}
}

function nativeEmoji(emoji: EmojiData, skinTone: number): string {
	if (skinTone === 0) return emoji.emoji;
	return (
		emoji.skins?.find(
			(skin) =>
				skin.tone === skinTone ||
				(Array.isArray(skin.tone) &&
					skin.tone.every((tone) => tone === skinTone)),
		)?.emoji ?? emoji.emoji
	);
}

function emojiLabel(emoji: EmojiData | undefined, native: string): string {
	if (!emoji) return native;
	return (
		emoji.skins?.find((skin) => skin.emoji === native)?.label ?? emoji.label
	);
}

function moveGridFocus(event: KeyboardEvent<HTMLFieldSetElement>) {
	const buttons =
		event.currentTarget.querySelectorAll<HTMLButtonElement>("button");
	const button =
		event.target instanceof Element
			? event.target.closest<HTMLButtonElement>("button[data-emoji-index]")
			: null;
	if (!button) return;
	const index = Number(button.dataset.emojiIndex);
	let next: number;
	switch (event.key) {
		case "ArrowRight":
			next = index + 1;
			break;
		case "ArrowLeft":
			next = index - 1;
			break;
		case "ArrowDown":
			next = index + 9;
			break;
		case "ArrowUp":
			next = index - 9;
			break;
		case "Home":
			next = 0;
			break;
		case "End":
			next = buttons.length - 1;
			break;
		default:
			return;
	}
	event.preventDefault();
	buttons[Math.max(0, Math.min(next, buttons.length - 1))]?.focus();
}

function emojiCategory(group: number | undefined): CategoryId {
	switch (group) {
		case 0:
		case 1:
			return "people";
		case 3:
			return "nature";
		case 4:
			return "foods";
		case 5:
			return "places";
		case 6:
			return "activity";
		case 7:
			return "objects";
		case 8:
			return "symbols";
		default:
			return "flags";
	}
}

export function EmojiPicker({
	value,
	label,
	onChange,
	disabled = false,
}: {
	value: string;
	label: string;
	onChange: (emoji: string) => void;
	disabled?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const [data, setData] = useState<EmojiData[] | null>(null);
	const [loadError, setLoadError] = useState(false);
	const [query, setQuery] = useState("");
	const [category, setCategory] = useState<CategoryId>("all");
	const [skinTone, setSkinTone] = useState(0);
	const [tonesOpen, setTonesOpen] = useState(false);
	const [focusedEmojiIndex, setFocusedEmojiIndex] = useState(0);
	const [recent, setRecent] = useState(readRecent);
	const gridScrollRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open || data !== null || loadError) return;
		let active = true;
		void import("emojibase-data/en/data.json")
			.then((module) => {
				if (active)
					setData(
						module.default
							.filter((emoji) => emoji.group !== undefined && emoji.group !== 2)
							.sort(
								(first, second) =>
									(first.order ?? Infinity) - (second.order ?? Infinity),
							),
					);
			})
			.catch(() => {
				if (active) setLoadError(true);
			});
		return () => {
			active = false;
		};
	}, [open, data, loadError]);

	const normalizedQuery = query.trim().toLocaleLowerCase();
	const visible =
		data === null
			? []
			: data.filter((emoji) =>
					normalizedQuery === ""
						? category === "all" || emojiCategory(emoji.group) === category
						: `${emoji.label} ${emoji.hexcode} ${emoji.emoji} ${emoji.tags?.join(" ") ?? ""}`
								.toLocaleLowerCase()
								.includes(normalizedQuery),
				);

	const selectEmoji = (id: string, native: string) => {
		const next = [
			{ id, native },
			...recent.filter((item) => item.native !== native),
		].slice(0, 24);
		setRecent(next);
		try {
			localStorage.setItem(recentStorageKey, JSON.stringify(next));
		} catch {
			// The in-memory recent list still works when browser storage is unavailable.
		}
		onChange(native);
		setOpen(false);
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (next) {
					const latestRecent = readRecent();
					setRecent(latestRecent);
					setQuery("");
					setCategory("all");
					setTonesOpen(false);
					setFocusedEmojiIndex(0);
				}
				setOpen(next);
			}}
		>
			<DialogTrigger
				render={
					<button
						type="button"
						data-slot="emoji-picker-trigger"
						disabled={disabled}
						className="flex min-h-9 w-full items-center gap-2 rounded-md border bg-background px-3 text-left text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						aria-label={label}
					>
						<span
							className="emoji-glyph grid size-6 place-items-center text-xl"
							aria-hidden="true"
						>
							{value || (
								<SmileIcon className="size-[18px] text-muted-foreground" />
							)}
						</span>
						<span className="min-w-0 flex-1 truncate">
							{value ? "Change emoji" : "Choose emoji"}
						</span>
						<ChevronDownIcon
							className="size-4 text-muted-foreground"
							aria-hidden="true"
						/>
					</button>
				}
			/>
			<DialogContent
				className="flex h-[min(610px,calc(100dvh-2rem))] max-w-[480px] flex-col overflow-hidden p-0 sm:max-w-[480px]"
				closeLabel="Close emoji picker"
			>
				<DialogHeader className="px-6 pt-6 pr-14">
					<DialogTitle className="flex items-center gap-2.5 text-xl">
						<SmileIcon className="size-5" aria-hidden="true" />
						Choose emoji
					</DialogTitle>
					<DialogDescription>
						Search or browse to choose an icon.
					</DialogDescription>
				</DialogHeader>
				<div className="flex items-center gap-2 px-6 pt-5">
					<label className="relative min-w-0 flex-1">
						<SearchIcon
							className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
							aria-hidden="true"
						/>
						<input
							type="search"
							autoFocus
							value={query}
							onChange={(event) => {
								setQuery(event.target.value);
								setFocusedEmojiIndex(0);
								gridScrollRef.current?.scrollTo({ top: 0 });
							}}
							aria-label="Search emojis"
							placeholder="Search emojis…"
							className="h-10 w-full rounded-md border bg-background pr-3 pl-9 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
						/>
					</label>
					<button
						type="button"
						className="emoji-glyph grid size-10 shrink-0 place-items-center rounded-md border bg-background text-xl hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						aria-label={`Skin tone: ${skinTones[skinTone]}`}
						aria-expanded={tonesOpen}
						onClick={() => setTonesOpen((current) => !current)}
					>
						{skinToneSwatches[skinTone]}
					</button>
				</div>
				{tonesOpen && (
					<fieldset className="m-0 flex min-w-0 justify-end gap-1 border-0 px-6 pt-2">
						<legend className="sr-only">Skin tones</legend>
						{skinTones.map((tone, index) => (
							<button
								key={tone}
								type="button"
								className="emoji-glyph grid size-9 place-items-center rounded-md text-xl hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-primary/10"
								aria-label={`${tone} skin tone`}
								aria-pressed={skinTone === index}
								onClick={() => {
									setSkinTone(index);
									setTonesOpen(false);
								}}
							>
								{skinToneSwatches[index]}
							</button>
						))}
					</fieldset>
				)}
				<fieldset className="m-0 grid min-w-0 grid-cols-10 gap-1 border-0 px-6 pt-3">
					<legend className="sr-only">Emoji categories</legend>
					{categories.map(({ id, label: categoryLabel, icon: Icon }) => (
						<button
							key={id}
							type="button"
							className="grid size-9 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-foreground aria-pressed:text-background"
							aria-label={categoryLabel}
							aria-pressed={normalizedQuery === "" && category === id}
							onClick={() => {
								setQuery("");
								setCategory(id);
								setFocusedEmojiIndex(0);
								gridScrollRef.current?.scrollTo({ top: 0 });
							}}
						>
							<Icon className="size-[18px]" aria-hidden="true" />
						</button>
					))}
				</fieldset>
				{data !== null && (
					<div className="flex items-center justify-between px-6 pt-3 text-xs text-muted-foreground">
						<span>
							{normalizedQuery
								? "Search results"
								: categories.find((item) => item.id === category)?.label}
						</span>
						<span>
							{category === "recent" && normalizedQuery === ""
								? recent.length
								: visible.length}{" "}
							emojis
						</span>
					</div>
				)}
				<div
					ref={gridScrollRef}
					className="min-h-0 flex-1 overflow-y-auto px-6 pt-2 pb-2 [scrollbar-width:thin]"
				>
					{data === null ? (
						<div className="grid min-h-32 place-items-center text-sm text-muted-foreground">
							{loadError ? (
								<button
									type="button"
									className="rounded-md border px-3 py-2 hover:bg-muted"
									onClick={() => setLoadError(false)}
								>
									Could not load emojis. Retry
								</button>
							) : (
								"Loading emojis…"
							)}
						</div>
					) : category === "recent" && normalizedQuery === "" ? (
						recent.length === 0 ? (
							<p className="py-8 text-center text-sm text-muted-foreground">
								Your recent emoji will appear here.
							</p>
						) : (
							<fieldset
								className="m-0 grid min-w-0 grid-cols-9 gap-1 border-0 p-0"
								onKeyDown={moveGridFocus}
							>
								<legend className="sr-only">Recent emojis</legend>
								{recent.map(({ id, native }, index) => (
									<button
										key={native}
										type="button"
										data-emoji-index={index}
										tabIndex={
											Math.min(focusedEmojiIndex, recent.length - 1) === index
												? 0
												: -1
										}
										onFocus={() => setFocusedEmojiIndex(index)}
										className="emoji-glyph grid size-10 place-items-center rounded-md text-2xl hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-primary/10"
										aria-label={emojiLabel(
											data.find((emoji) => emoji.hexcode === id),
											native,
										)}
										aria-pressed={value === native}
										onClick={() => selectEmoji(id, native)}
									>
										{native}
									</button>
								))}
							</fieldset>
						)
					) : visible.length === 0 ? (
						<p className="py-8 text-center text-sm text-muted-foreground">
							No emojis found. Try another search.
						</p>
					) : (
						<fieldset
							className="m-0 grid min-w-0 grid-cols-9 gap-1 border-0 p-0"
							onKeyDown={moveGridFocus}
						>
							<legend className="sr-only">
								{normalizedQuery
									? "Emoji search results"
									: categories.find((item) => item.id === category)?.label}
							</legend>
							{visible.map((emoji, index) => {
								const native = nativeEmoji(emoji, skinTone);
								return native === "" ? null : (
									<button
										key={emoji.hexcode}
										type="button"
										data-emoji-index={index}
										tabIndex={
											Math.min(focusedEmojiIndex, visible.length - 1) === index
												? 0
												: -1
										}
										onFocus={() => setFocusedEmojiIndex(index)}
										className="emoji-glyph grid size-10 place-items-center rounded-md text-2xl hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-primary/10"
										aria-label={emojiLabel(emoji, native)}
										aria-pressed={value === native}
										onClick={() => selectEmoji(emoji.hexcode, native)}
									>
										{native}
									</button>
								);
							})}
						</fieldset>
					)}
				</div>
				<span className="sr-only" role="status">
					{data === null
						? loadError
							? "Emojis could not be loaded"
							: "Loading emojis"
						: `${String(category === "recent" && normalizedQuery === "" ? recent.length : visible.length)} emojis available`}
				</span>
				<div className="flex items-center justify-between gap-3 border-t px-6 py-3 text-xs text-muted-foreground">
					<span>
						{value ? (
							<>
								Selected <span className="emoji-glyph">{value}</span>
							</>
						) : (
							"Using default icon"
						)}
					</span>
					{value && (
						<button
							type="button"
							className="rounded-sm px-2 py-1 font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							onClick={() => {
								onChange("");
								setOpen(false);
							}}
						>
							Use default icon
						</button>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
