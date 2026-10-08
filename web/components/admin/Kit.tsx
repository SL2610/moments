"use client";

// Album-style building blocks for the couple's admin: paper, ink, hairlines,
// Bodoni titles and caption metadata. No cards, pills or badges.
import Link from "next/link";
import type { ReactNode } from "react";
import { useAdminText } from "@/lib/i18n/admin";

export const field =
	"w-full h-12 rounded-[2px] border border-zinc-300 bg-[#faf8f3] px-3.5 text-base text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-violet-600 focus:ring-1 focus:ring-violet-600";

export const btnInk =
	"inline-flex items-center justify-center gap-2 min-h-12 px-6 rounded-[2px] bg-zinc-900 text-zinc-50 text-base font-medium transition-colors hover:bg-violet-600 disabled:opacity-50 disabled:hover:bg-zinc-900";

export const btnLine =
	"inline-flex items-center justify-center gap-2 min-h-11 px-5 rounded-[2px] border border-zinc-300 text-zinc-900 transition-colors hover:border-zinc-900 disabled:opacity-50";

export const linkQuiet =
	"inline-flex items-center gap-1.5 min-h-11 text-zinc-700 underline decoration-zinc-300 underline-offset-[6px] transition-colors hover:text-zinc-900 hover:decoration-zinc-900";

/** The page frame: generous margins, one reading column on phones. */
export function AdminPage({ children }: { children: ReactNode }) {
	return <main className="mx-auto w-full max-w-6xl px-6 sm:px-10 pt-8 pb-24">{children}</main>;
}

/** A page opening: small caption, the title in Bodoni, optional actions on the end side. */
export function PageHead({
	meta,
	title,
	sub,
	actions,
	back,
	cover,
}: {
	meta: ReactNode;
	title: ReactNode;
	sub?: ReactNode;
	actions?: ReactNode;
	back?: boolean;
	/** The couple's cover, shown as their guests see it, in colour. */
	cover?: string | null;
}) {
	const tx = useAdminText();
	return (
		<header className="mb-10">
			{back && (
				<Link href="/dashboard" className="meta text-zinc-500 hover:text-zinc-900">
					<span aria-hidden className="inline-block rtl:-scale-x-100">←</span> {tx("back")}
				</Link>
			)}
			{cover && (
				<div className="crop mt-6">
					<div className="aspect-[4/3] sm:aspect-[21/8] overflow-hidden bg-[#eee9e1]">
						{/* eslint-disable-next-line @next/next/no-img-element */}
						<img src={cover} alt="" className="w-full h-full object-cover object-[center_35%]" />
					</div>
				</div>
			)}
			<div className={`flex flex-wrap items-end justify-between gap-6 ${back || cover ? "mt-6" : ""}`}>
				<div className="min-w-0">
					<p className="meta text-zinc-500" dir="auto">{meta}</p>
					<h1
						className="mt-2 text-[clamp(2.4rem,7vw,4rem)] leading-[0.95] tracking-[-0.02em] text-zinc-900"
						style={{ fontFamily: "var(--font-display)" }}
					>
						{title}
					</h1>
					{sub && <p className="mt-3 text-zinc-600">{sub}</p>}
				</div>
				{actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
			</div>
		</header>
	);
}

/** A section of the page, opened by a hairline and a small caption. */
export function Section({
	id,
	title,
	body,
	children,
	aside,
}: {
	id?: string;
	title: ReactNode;
	body?: ReactNode;
	children: ReactNode;
	aside?: ReactNode;
}) {
	return (
		<section id={id} className="scroll-mt-20 border-t border-zinc-300 pt-6 mt-12 first:mt-0 [nav+&]:border-t-0 [nav+&]:pt-0 [nav+&]:mt-0">
			<div className="flex flex-wrap items-baseline justify-between gap-4">
				<h2 className="text-2xl text-zinc-900" style={{ fontFamily: "var(--font-display)" }}>
					{title}
				</h2>
				{aside}
			</div>
			{body && <p className="mt-2 max-w-2xl text-zinc-600">{body}</p>}
			<div className="mt-6">{children}</div>
		</section>
	);
}

/** The album's own pages: guest page, photos, add photos. */
export function AlbumNav({ albumId, current }: { albumId: string; current: "page" | "photos" }) {
	const tx = useAdminText();
	const items = [
		{ key: "page", href: `/dashboard/albums/${albumId}`, label: tx("nav.page") },
		{ key: "photos", href: `/dashboard/albums/${albumId}/view`, label: tx("nav.photos") },
	] as const;
	return (
		<nav aria-label={tx("meta")} className="flex gap-7 border-b border-zinc-300 -mt-4 mb-10">
			{items.map((item) => (
				<Link
					key={item.key}
					href={item.href}
					aria-current={current === item.key ? "page" : undefined}
					className={`pb-3 -mb-px border-b-2 text-base transition-colors ${current === item.key ? "border-champagne text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-900"}`}
				>
					{item.label}
				</Link>
			))}
		</nav>
	);
}

export function Loading() {
	const tx = useAdminText();
	return (
		<AdminPage>
			<p className="meta text-zinc-500 pt-24 text-center">{tx("loading")}</p>
		</AdminPage>
	);
}

export const formatDate = (date: string | null | undefined) => (date ? date.replace(/[./-]/g, " · ") : "");
