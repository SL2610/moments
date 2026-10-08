"use client";

import Link from "next/link";
import Mark from "@/components/Mark";
import { useI18n } from "@/lib/i18n/I18nProvider";

// The bare server address. Guests arrive at /w/<id>; this only points people the right way.
export default function Home() {
	const { locale } = useI18n();
	const he = locale === "he";
	return (
		<main className="min-h-screen flex flex-col justify-between px-6 sm:px-10 py-8 bg-zinc-50">
			<div className="flex items-center gap-2.5 text-zinc-900" dir="ltr">
				<Mark className="h-3.5 w-auto" />
				<span className="text-[1.35rem] leading-none tracking-[0.14em]" style={{ fontFamily: "var(--font-display-face), serif" }}>
					WED
				</span>
			</div>
			<div className="max-w-xl">
				<p className="meta text-zinc-500">{he ? "אלבום החתונה" : "The wedding album"}</p>
				<h1 className="mt-3 text-[clamp(2.6rem,9vw,5rem)] leading-[0.95] tracking-[-0.02em] text-zinc-900" style={{ fontFamily: "var(--font-display)" }}>
					{he ? "הגעתם מקוד או מקישור?" : "Here from a code or a link?"}
				</h1>
				<p className="mt-5 text-lg text-zinc-600">
					{he
						? "פתחו שוב את הקישור שקיבלתם מבני הזוג. הוא מוביל ישר לאלבום שלהם."
						: "Open the link you got from the couple again. It leads straight to their album."}
				</p>
			</div>
			<Link href="/login" className="w-fit min-h-11 inline-flex items-center text-zinc-700 underline decoration-zinc-300 underline-offset-[6px] hover:text-zinc-900">
				{he ? "בני הזוג: כניסה לניהול האלבום" : "Couples: sign in to your album"}
			</Link>
		</main>
	);
}
