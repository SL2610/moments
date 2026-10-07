import type { Metadata } from "next";
import { cookies } from "next/headers";
import {
	Cormorant_Garamond,
	Frank_Ruhl_Libre,
	Assistant,
} from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";
import { I18nProvider } from "@/lib/i18n/I18nProvider";
import { LOCALE_COOKIE, DEFAULT_LOCALE, dirFor, isLocale } from "@/lib/i18n/locale";

// Latin display face for the event wordmark.
const displayFont = Cormorant_Garamond({
	variable: "--font-display-face",
	subsets: ["latin"],
	weight: ["400", "500", "600"],
});

// Hebrew display face for headings.
const hebrewDisplayFont = Frank_Ruhl_Libre({
	variable: "--font-display-he-face",
	subsets: ["hebrew", "latin"],
	weight: ["400", "500", "600"],
});

// Hebrew-capable UI face.
const uiFont = Assistant({
	variable: "--font-ui-face",
	subsets: ["hebrew", "latin"],
	weight: ["400", "500", "600"],
});

const PUBLIC_URL =
	process.env.NEXT_PUBLIC_PUBLIC_URL || "https://your-domain.example.com";
const EVENT_NAME = process.env.NEXT_PUBLIC_EVENT_NAME || "Your Names Here";

export async function generateMetadata(): Promise<Metadata> {
	const cookieStore = await cookies();
	const locale = cookieStore.get(LOCALE_COOKIE)?.value;
	const isHebrew = !isLocale(locale) || locale === "he";

	const title = isHebrew
		? `${EVENT_NAME} · התמונות מהחתונה`
		: `${EVENT_NAME} · Wedding Photos`;
	const description = isHebrew
		? `מצאו את התמונות שלכם מהחתונה של ${EVENT_NAME}`
		: `Find your photos from ${EVENT_NAME}'s wedding`;
	const ogDescription = isHebrew
		? "תודה שחגגתם איתנו! היכנסו למצוא את התמונות שלכם מהחתונה."
		: "Thank you for celebrating with us! Find your photos from the wedding.";

	return {
		metadataBase: new URL(PUBLIC_URL),
		title: { default: title, template: `%s | ${EVENT_NAME}` },
		description,
		// Share preview (WhatsApp reads these Open Graph tags). The actual
		// image comes from app/opengraph-image.tsx via Next's file convention,
		// which auto-injects the og:image / twitter:image tags.
		openGraph: {
			title,
			description: ogDescription,
			url: PUBLIC_URL,
			siteName: EVENT_NAME,
			locale: isHebrew ? "he_IL" : "en_US",
			type: "website",
		},
		twitter: {
			card: "summary_large_image",
			title,
			description: ogDescription,
		},
		robots: { index: false, follow: false },
	};
}

export default async function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	const cookieStore = await cookies();
	const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
	const locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;

	return (
		<html lang={locale} dir={dirFor(locale)} suppressHydrationWarning>
			<body
				className={`${displayFont.variable} ${hebrewDisplayFont.variable} ${uiFont.variable} antialiased`}
			>
				<I18nProvider locale={locale}>
					<Navbar />
					{children}
				</I18nProvider>
			</body>
		</html>
	);
}
