import type { Metadata } from "next";
import { cookies } from "next/headers";
import {
	Instrument_Serif,
	Frank_Ruhl_Libre,
	Archivo,
	Assistant,
} from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";
import { I18nProvider } from "@/lib/i18n/I18nProvider";
import { LOCALE_COOKIE, DEFAULT_LOCALE, dirFor, isLocale } from "@/lib/i18n/locale";

// Latin display face for the event wordmark.
const displayFont = Instrument_Serif({
	variable: "--font-display-face",
	subsets: ["latin"],
	weight: "400",
	style: ["normal", "italic"],
});

// Hebrew display face for headings.
const hebrewDisplayFont = Frank_Ruhl_Libre({
	variable: "--font-display-he-face",
	subsets: ["hebrew", "latin"],
	weight: ["400", "500", "600"],
});

// Latin UI face; Hebrew pages switch to Assistant in globals.css.
const uiFont = Archivo({
	variable: "--font-ui-face",
	subsets: ["latin"],
	weight: ["400", "500", "600"],
});

const hebrewUiFont = Assistant({
	variable: "--font-ui-he-face",
	subsets: ["hebrew"],
	weight: ["400", "500", "600"],
});

const PUBLIC_URL =
	process.env.NEXT_PUBLIC_PUBLIC_URL || "https://your-domain.example.com";
export const metadata: Metadata = {
	metadataBase: new URL(PUBLIC_URL),
	title: { default: "Moments", template: "%s" },
	description: "Find your wedding photos with one selfie.",
	robots: { index: false, follow: false },
};

export default async function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	const cookieStore = await cookies();
	const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
	const locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;

	return (
		<html
			lang={locale}
			dir={dirFor(locale)}
			suppressHydrationWarning
			// On <html>, not <body>: Tailwind resolves --font-sans there.
			className={`${displayFont.variable} ${hebrewDisplayFont.variable} ${uiFont.variable} ${hebrewUiFont.variable}`}
		>
			<body className="antialiased">
				<I18nProvider locale={locale}>
					<Navbar />
					{children}
				</I18nProvider>
			</body>
		</html>
	);
}
