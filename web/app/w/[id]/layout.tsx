import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, isLocale } from "@/lib/i18n/locale";

const API_URL = (process.env.API_INTERNAL_URL || "http://api:8080").replace(/\/+$/, "");

// The WhatsApp/iMessage preview of a couple's link shows their names and cover.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
	const { id } = await params;
	const res = await fetch(`${API_URL}/api/w/${encodeURIComponent(id)}`, { cache: "no-store" }).catch(() => null);
	if (!res?.ok) return { title: "Moments" };
	const info: { eventName: string; coverUrl: string | null } = await res.json();
	const locale = (await cookies()).get(LOCALE_COOKIE)?.value;
	const isHebrew = !isLocale(locale) || locale === "he";
	const title = isHebrew ? `${info.eventName} · התמונות מהחתונה` : `${info.eventName} · Wedding photos`;
	const description = isHebrew
		? "סלפי אחד, וכל התמונות שאתם מופיעים בהן לפניכם."
		: "One selfie, and you'll see every photo you're in.";
	return {
		title,
		description,
		openGraph: {
			title,
			description,
			locale: isHebrew ? "he_IL" : "en_US",
			type: "website",
			...(info.coverUrl ? { images: [info.coverUrl] } : {}),
		},
		twitter: { card: info.coverUrl ? "summary_large_image" : "summary", title, description },
	};
}

export default function WeddingLayout({ children }: { children: React.ReactNode }) {
	return children;
}
