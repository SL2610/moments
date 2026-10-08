"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Camera, ChevronLeft, ChevronRight, Download, Heart, Share, Sun, User, X } from "lucide-react";
import type { MomentGroup } from "@/features";
import Wordmark from "@/components/Wordmark";
import { useI18n } from "@/lib/i18n/I18nProvider";

export interface ScreenPhoto {
	id: string;
	viewUrl: string;
	previewUrl: string;
	thumbUrl: string;
}

const SHOW_CREDIT = process.env.NEXT_PUBLIC_SHOW_CREDIT !== "false";

/** "Maya & Daniel" -> "M & D", "דנה ויוסי" -> "ד & י"; anything else keeps its first letter. */
export function initials(names: string) {
	const parts = names.split(/\s*(?:&|\+|\band\b)\s*|\s+ו(?=\S)/).map((p) => p.trim()).filter(Boolean);
	return parts.length === 2 ? `${parts[0][0]} & ${parts[1][0]}` : names.trim().slice(0, 1);
}

const display = { fontFamily: "var(--font-display)" };

/** The couple's initials, set like the WED wordmark: their wedding, WED's voice. */
export function CoupleMark({ names }: { names: string }) {
	return (
		<span className="text-[1.75rem] leading-none tracking-[-0.02em] text-zinc-900 whitespace-nowrap" style={display} dir="auto">
			{initials(names)}
		</span>
	);
}

/** Top bar shared by every guest screen: a mark at the start, actions at the end. */
export function GuestBar({ start, center, end, className = "" }: { start?: ReactNode; center?: ReactNode; end?: ReactNode; className?: string }) {
	return (
		<div className={`relative flex items-center justify-between gap-4 h-16 px-5 sm:px-8 ${className}`}>
			<div className="flex items-center min-w-0">{start}</div>
			{center && <div className="absolute inset-x-0 flex justify-center pointer-events-none">{center}</div>}
			<div className="flex items-center gap-3 shrink-0">{end}</div>
		</div>
	);
}

export const ChampagneRule = () => <span aria-hidden className="block w-10 h-px bg-champagne" />;

/** WED's sign-off: wordmark, a champagne rule, the promise. Self-hosters hide it with SHOW_CREDIT=false. */
export function Lockup() {
	const { t } = useI18n();
	if (!SHOW_CREDIT) return null;
	return (
		<a href="https://sagi-lior-wedding.com" className="flex items-center gap-4 text-zinc-900" aria-label="WED">
			<Wordmark />
			<span aria-hidden className="h-px flex-1 min-w-12 bg-champagne" />
			<span className="meta text-zinc-500 max-w-[11rem] leading-relaxed">{t("guest.landing.lockup")}</span>
		</a>
	);
}

// ------------------------------------------------------------------ 3. finding

const TILTS = ["-6deg", "5deg", "-3deg", "7deg"];

/** While the selfie is matched: the album's own prints land on the table; the line moves without a percentage. */
export function Finding({ names, prints, onCancel }: { names: string; prints: ScreenPhoto[]; onCancel: () => void }) {
	const { t } = useI18n();
	// no real progress comes back from the search, so the bar never pretends to measure it
	const [slow, setSlow] = useState(false);
	useEffect(() => {
		const timer = setTimeout(() => setSlow(true), 20_000);
		return () => clearTimeout(timer);
	}, []);
	return (
		<div className="fixed inset-0 z-50 overflow-y-auto bg-zinc-50 flex flex-col" role="status" aria-live="polite">
			<GuestBar start={<CoupleMark names={names} />} end={<ChampagneRule />} />
			<main className="flex-1 w-full max-w-md mx-auto px-6 pb-10 flex flex-col">
				<h2 className="mt-8 text-[clamp(2.6rem,12vw,3.4rem)] leading-[1.02] tracking-[-0.02em] text-zinc-900" style={display}>
					{t("guest.finding.title")}
				</h2>
				<p className="mt-3 text-zinc-600">{t("guest.finding.body")}</p>
				<div aria-hidden className="relative mt-10 grid grid-cols-2 gap-x-2 gap-y-4 px-2">
					{TILTS.map((tilt, i) => {
						const print = prints[i];
						return (
							<div
								key={tilt}
								className="print-drop bg-white p-2 shadow-[0_14px_30px_-18px_rgba(29,27,25,0.55)]"
								style={{ ["--tilt" as string]: tilt, transform: `rotate(${tilt})`, animationDelay: `${150 + i * 260}ms` }}
							>
								<div className="aspect-[4/3.4] bg-[#f3efe9] overflow-hidden">
									{print && (
										// eslint-disable-next-line @next/next/no-img-element
										<img src={print.thumbUrl || print.viewUrl} alt="" className="w-full h-full object-cover" />
									)}
								</div>
							</div>
						);
					})}
				</div>
				<div className="mt-auto pt-12">
					<div className="relative h-px overflow-hidden bg-zinc-200">
						<div className="progress-indeterminate absolute inset-y-0 w-1/3 bg-[#8a7350]" />
					</div>
					<p className="mt-4 text-sm text-zinc-600">{t(slow ? "guest.finding.slow" : "guest.finding.detail")}</p>
					<button onClick={onCancel} className="mt-3 min-h-11 text-sm text-zinc-800 underline underline-offset-[6px] decoration-zinc-300 hover:decoration-zinc-900">
						{t("guest.finding.cancel")}
					</button>
				</div>
			</main>
		</div>
	);
}

// ------------------------------------------------------------------ 5. viewer

/**
 * The dark viewer: counter, favourite and share above; the photo; a filmstrip below.
 * `extra` holds the tag chips and "This is me", which only gallery photos carry.
 */
export function Viewer({
	list,
	index,
	total,
	onIndex,
	onClose,
	isFavorite,
	onFavorite,
	onShare,
	onDownload,
	extra,
}: {
	list: ScreenPhoto[];
	index: number;
	total: number;
	onIndex: (i: number) => void;
	onClose: () => void;
	isFavorite: boolean;
	onFavorite: () => void;
	onShare: () => void;
	onDownload: () => void;
	extra?: ReactNode;
}) {
	const { t, locale } = useI18n();
	const touchStartX = useRef<number | null>(null);
	const current = useRef<HTMLButtonElement | null>(null);
	const photo = list[index];

	useEffect(() => {
		current.current?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
	}, [index]);

	const next = () => index < list.length - 1 && onIndex(index + 1);
	const prev = () => index > 0 && onIndex(index - 1);
	const num = (n: number) => n.toLocaleString(locale === "he" ? "he-IL" : "en-US");

	return (
		<div className="fixed inset-0 z-[55] flex flex-col bg-[#11100f] text-zinc-50" role="dialog" aria-modal="true">
			<div className="flex items-center justify-between px-2 sm:px-4 h-16">
				<button onClick={onClose} aria-label={t("guest.selfieSearch.cancelButton")} className="p-3 text-white/80 hover:text-white">
					<X className="w-5 h-5" />
				</button>
				<span className="text-sm text-white/70 tabular-nums" dir="ltr">
					{num(index + 1)} / {num(total)}
				</span>
				<div className="flex items-center">
					<button onClick={onFavorite} aria-pressed={isFavorite} aria-label={t("guest.viewer.favorite")} className="p-3 text-white/80 hover:text-white">
						<Heart className={`w-5 h-5 ${isFavorite ? "fill-current text-champagne" : ""}`} />
					</button>
					<button onClick={onShare} aria-label={t("guest.viewer.share")} className="p-3 text-white/80 hover:text-white">
						<Share className="w-5 h-5" />
					</button>
					<button onClick={onDownload} aria-label={t("guest.gallery.downloadTitle")} className="p-3 text-white/80 hover:text-white">
						<Download className="w-5 h-5" />
					</button>
				</div>
			</div>

			<div
				className="relative flex-1 min-h-0 flex items-center justify-center px-3"
				onTouchStart={(e) => (touchStartX.current = e.touches[0].clientX)}
				onTouchEnd={(e) => {
					const start = touchStartX.current;
					touchStartX.current = null;
					if (start === null) return;
					const dx = e.changedTouches[0].clientX - start;
					if (Math.abs(dx) < 50) return;
					if (dx < 0) next();
					else prev();
				}}
			>
				{/* eslint-disable-next-line @next/next/no-img-element */}
				<img key={photo.id} src={photo.previewUrl || photo.viewUrl} alt="" className="img-fade img-loaded max-w-full max-h-full object-contain" />
				{index > 0 && (
					<button onClick={prev} aria-label="‹" className="hidden sm:block absolute start-3 p-3 text-white/60 hover:text-white">
						<ChevronLeft className="w-7 h-7 rtl:rotate-180" />
					</button>
				)}
				{index < list.length - 1 && (
					<button onClick={next} aria-label="›" className="hidden sm:block absolute end-3 p-3 text-white/60 hover:text-white">
						<ChevronLeft className="w-7 h-7 rotate-180 rtl:rotate-0" />
					</button>
				)}
			</div>

			{extra && <div className="px-4 pt-3 flex flex-wrap items-center justify-center gap-2">{extra}</div>}

			<div className="flex gap-1.5 overflow-x-auto px-3 py-4 [scrollbar-width:none]">
				{list.map((p, i) => (
					<button
						key={p.id}
						ref={i === index ? current : undefined}
						onClick={() => onIndex(i)}
						aria-label={num(i + 1)}
						aria-current={i === index}
						className={`shrink-0 w-14 aspect-[4/5] overflow-hidden transition-opacity ${i === index ? "opacity-100 outline outline-1 outline-offset-2 outline-champagne" : "opacity-45 hover:opacity-80"}`}
					>
						{/* eslint-disable-next-line @next/next/no-img-element */}
						<img src={p.thumbUrl || p.viewUrl} alt="" loading="lazy" className="w-full h-full object-cover" />
					</button>
				))}
			</div>
		</div>
	);
}

// ------------------------------------------------------------------ 2. selfie: the tips row

export function SelfieTips() {
	const { t } = useI18n();
	const tips = [
		[Sun, t("guest.selfieSearch.tipLight")],
		[Camera, t("guest.selfieSearch.tipLook")],
		[User, t("guest.selfieSearch.tipAlone")],
	] as const;
	return (
		<ul className="grid grid-cols-3 gap-3 text-center text-sm text-zinc-600">
			{tips.map(([Icon, label]) => (
				<li key={label} className="flex flex-col items-center gap-2">
					<Icon className="w-5 h-5 text-zinc-800" strokeWidth={1.25} />
					{label}
				</li>
			))}
		</ul>
	);
}

/** Champagne text action for top bars ("Download all", "Download selected (3)"). */
export function BarAction({ onClick, disabled, busy, children }: { onClick: () => void; disabled?: boolean; busy?: boolean; children: ReactNode }) {
	return (
		<button onClick={onClick} disabled={disabled} className="flex items-center gap-1.5 min-h-11 text-sm text-[#7a6442] hover:text-zinc-900 disabled:opacity-50">
			{children}
			<Download className={`w-4 h-4 ${busy ? "animate-pulse" : ""}`} />
		</button>
	);
}

// ------------------------------------------------------------------ 6. your wedding story

/**
 * The album in chapters: one row per chapter with its strongest photo, then that
 * chapter's photos. `load` turns ids into photos (URLs are signed, so never cached).
 */
export function WeddingStory({
	names,
	groups,
	load,
	onClose,
	onOpenPhoto,
	topAction,
}: {
	names: string;
	groups: MomentGroup[];
	load: (ids: string[]) => Promise<ScreenPhoto[]>;
	onClose: () => void;
	onOpenPhoto: (list: ScreenPhoto[], index: number) => void;
	topAction?: ReactNode;
}) {
	const { t, locale } = useI18n();
	const [open, setOpen] = useState<MomentGroup | null>(null);
	// loaded photos by chapter key; a chapter shows placeholders until its own list arrives
	const [loaded, setLoaded] = useState<Record<string, ScreenPhoto[]>>({});
	const photos = open ? (loaded[open.key] ?? null) : null;
	const num = (n: number) => n.toLocaleString(locale === "he" ? "he-IL" : "en-US");

	useEffect(() => {
		if (!open) return;
		load(open.photoIds).then((list) => setLoaded((prev) => ({ ...prev, [open.key]: list })));
	}, [open, load]);

	return (
		<div role="dialog" aria-modal="true" aria-labelledby="story-title" className="fixed inset-0 z-50 overflow-y-auto bg-zinc-50">
			<GuestBar
				className="sticky top-0 z-10 bg-zinc-50"
				start={
					open ? (
						<button onClick={() => setOpen(null)} aria-label={t("guest.back")} className="p-2 -ms-2 text-zinc-800 hover:text-zinc-950">
							<ChevronLeft className="w-6 h-6 rtl:rotate-180" strokeWidth={1.25} />
						</button>
					) : (
						<CoupleMark names={names} />
					)
				}
				end={
					<>
						{topAction}
						<button onClick={onClose} aria-label={t("guest.results.toAlbum")} className="p-2 -me-2 text-zinc-800 hover:text-zinc-950">
							<X className="w-6 h-6" strokeWidth={1.25} />
						</button>
					</>
				}
			/>
			<main className="max-w-3xl mx-auto px-5 sm:px-8 pb-14">
				<h2 id="story-title" className="mt-6 text-[clamp(2.1rem,9vw,3.2rem)] leading-[1.08] tracking-[-0.02em] text-zinc-900" style={display}>
					{open ? open.label : t("guest.story.title")}
				</h2>
				<p className="mt-2 text-lg text-zinc-600">
					{open ? t("guest.story.count").replace("{count}", num(open.photoIds.length)) : t("guest.story.body")}
				</p>

				{!open ? (
					<ul className="mt-8 border-t border-zinc-200">
						{groups.map((g) => (
							<li key={g.key} className="border-b border-zinc-200">
								<button onClick={() => setOpen(g)} className="group w-full flex items-center gap-6 py-4 text-start">
									<span className="w-32 sm:w-40 aspect-square shrink-0 overflow-hidden bg-[#f3efe9]">
										{/* eslint-disable-next-line @next/next/no-img-element */}
										<img src={g.coverThumbUrl} alt="" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
									</span>
									<span className="flex-1 min-w-0">
										<span className="block text-2xl text-zinc-900" style={display}>{g.label}</span>
										<span className="block mt-1 text-sm text-zinc-500">{t("guest.story.count").replace("{count}", num(g.photoIds.length))}</span>
									</span>
									<ChevronRight className="w-5 h-5 text-zinc-500 rtl:rotate-180" strokeWidth={1.25} />
								</button>
							</li>
						))}
					</ul>
				) : (
					<ul className="mt-8 grid grid-cols-2 sm:grid-cols-3 gap-2" aria-busy={photos === null}>
						{(photos ?? open.photoIds.slice(0, 6).map((id) => ({ id }) as ScreenPhoto)).map((p, i) => (
							<li key={p.id}>
								<button
									disabled={!photos}
									onClick={() => photos && onOpenPhoto(photos, i)}
									className="block w-full aspect-[4/5] overflow-hidden bg-[#f3efe9] focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
								>
									{photos && (
										// eslint-disable-next-line @next/next/no-img-element
										<img src={p.thumbUrl || p.viewUrl} alt="" loading="lazy" className="w-full h-full object-cover transition-transform duration-500 hover:scale-[1.03]" />
									)}
								</button>
							</li>
						))}
					</ul>
				)}
			</main>
		</div>
	);
}
