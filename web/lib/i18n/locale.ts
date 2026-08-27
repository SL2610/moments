import he from "./dictionaries/he";
import en from "./dictionaries/en";

export type Locale = "he" | "en";
export type TranslationKey = keyof typeof he;

export const LOCALE_COOKIE = "lang";
export const DEFAULT_LOCALE: Locale = "he";

export const dictionaries = { he, en } as const;

export function isLocale(value: string | undefined | null): value is Locale {
	return value === "he" || value === "en";
}

export function dirFor(locale: Locale): "rtl" | "ltr" {
	return locale === "he" ? "rtl" : "ltr";
}

export function translate(locale: Locale, key: TranslationKey): string {
	return dictionaries[locale][key];
}
