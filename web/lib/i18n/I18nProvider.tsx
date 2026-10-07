"use client";

import { createContext, useContext, useMemo } from "react";
import {
	type Locale,
	type TranslationKey,
	LOCALE_COOKIE,
	dirFor,
	translate,
} from "./locale";

const LocaleContext = createContext<Locale | null>(null);

export function I18nProvider({
	locale,
	children,
}: {
	locale: Locale;
	children: React.ReactNode;
}) {
	return (
		<LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
	);
}

// Sets the locale cookie and reloads server components (layout included) via
// a full navigation, so <html lang/dir> picks up the new value immediately.
export function setLocale(locale: Locale) {
	document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
	window.location.reload();
}

export function useI18n() {
	const locale = useContext(LocaleContext);
	if (!locale) {
		throw new Error("useI18n() must be used within <I18nProvider>");
	}
	return useMemo(
		() => ({
			locale,
			dir: dirFor(locale),
			t: (key: TranslationKey) => translate(locale, key),
		}),
		[locale],
	);
}
