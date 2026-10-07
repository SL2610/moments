"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/I18nProvider";

export default function NotFound() {
	const { t } = useI18n();
	return (
		<div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-6 text-center">
			<div className="space-y-6">
				<div dir="ltr">
					<p
						className="text-4xl text-zinc-900 dark:text-zinc-50"
						style={{ fontFamily: "var(--font-display)" }}
					>
						Moments
					</p>
				</div>
				<p className="text-zinc-500">{t("notFound.message")}</p>
				<Link
					href="/"
					className="inline-block px-6 py-3 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium"
				>
					{t("notFound.backLink")}
				</Link>
			</div>
		</div>
	);
}
