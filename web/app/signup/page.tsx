"use client";

import { useState } from "react";
import { auth } from "@/lib/auth";
import { useRedirectIfAuth } from "@/lib/useRequireAuth";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { TranslationKey } from "@/lib/i18n/locale";

import { field } from "@/components/admin/Kit";

const AUTH_ERROR_KEYS: Record<string, TranslationKey> = {
	"Invalid email or password.": "authError.invalidCredentials",
	"An account with this email already exists.": "authError.emailTaken",
	"Registration is disabled on this server.": "authError.registrationDisabled",
	"Please enter a valid email address.": "authError.invalidEmail",
	"Password must be at least 8 characters.": "authError.passwordTooShort",
	"Unable to reach the server.": "authError.unreachable",
};

export default function SignUpPage() {
	const { isLoading: isAuthChecking, isAuthenticated } = useRedirectIfAuth();
	const { t } = useI18n();
	const translateError = (msg: string) => {
		const key = AUTH_ERROR_KEYS[msg];
		return key ? t(key) : msg;
	};
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [loading, setLoading] = useState(false);
	const [message, setMessage] = useState<{
		text: string;
		type: "success" | "error";
	} | null>(null);

	const handleEmailSignUp = async (e: React.FormEvent) => {
		e.preventDefault();
		setLoading(true);
		setMessage(null);

		const { error } = await auth.signUp({
			email,
			password,
		});

		if (error) {
			setMessage({ text: translateError(error.message), type: "error" });
			setLoading(false);
		} else {
			setMessage({ text: t("signup.created"), type: "success" });
			window.location.href = "/dashboard";
		}
	};


	if (isAuthChecking || isAuthenticated) {
		return (
			<div className="min-h-screen flex items-center justify-center bg-zinc-50">
				<Loader2 className="w-8 h-8 animate-spin text-violet-600" />
			</div>
		);
	}

	return (
		<main className="min-h-[calc(100svh-3.5rem)] bg-zinc-50 px-6 pt-[11svh] pb-16">
			<div className="mx-auto w-full max-w-sm">
				<p className="meta text-zinc-500">{t("login.title")}</p>
				<h1 className="mt-3 text-[clamp(2.4rem,9vw,3rem)] leading-[1.05] tracking-[-0.02em] text-zinc-900" style={{ fontFamily: "var(--font-display)" }}>
					{t("signup.heading")}
				</h1>
				<p className="mt-2 text-zinc-600">{t("signup.intro")}</p>

				<form onSubmit={handleEmailSignUp} className="mt-7 space-y-5">
					<div className="space-y-1.5">
						<label htmlFor="email" className="block text-sm text-zinc-600">{t("signup.email")}</label>
						<input
							id="email"
							type="text"
							inputMode="email"
							autoComplete="username"
							dir="ltr"
							placeholder="name@example.com"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							required
							className={field}
						/>
					</div>
					<div className="space-y-1.5">
						<label htmlFor="password" className="block text-sm text-zinc-600">{t("signup.password")}</label>
						<input
							id="password"
							type="password"
							autoComplete="new-password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							required
							className={field}
						/>
					</div>
					{message && (
						<p role={message.type === "error" ? "alert" : "status"} className={`text-sm ${message.type === "error" ? "text-red-700" : "text-zinc-600"}`}>
							{message.text}
						</p>
					)}
					<button
						type="submit"
						disabled={loading}
						className="w-full h-[54px] rounded-[2px] bg-zinc-900 text-base font-medium text-zinc-50 transition-colors hover:bg-violet-600 disabled:opacity-70"
					>
						{loading ? t("signup.creating") : t("signup.submit")}
					</button>
				</form>

				<p className="mt-8 text-sm text-zinc-500">
					{t("signup.haveAccount")}{" "}
					<Link href="/login" className="text-zinc-700 underline underline-offset-4 hover:text-zinc-900">
						{t("signup.loginLink")}
					</Link>
				</p>
			</div>
		</main>
	);
}
