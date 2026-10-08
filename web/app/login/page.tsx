"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { auth } from "@/lib/auth";
import { useRedirectIfAuth } from "@/lib/useRequireAuth";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { TranslationKey } from "@/lib/i18n/locale";

// Fine hairline field on the paper ground; 52px tall, 8px corners.
const field =
	"w-full h-[52px] rounded-[2px] border border-zinc-300 bg-white px-3.5 text-base text-zinc-900 placeholder:text-zinc-400 transition-colors focus:outline-none focus:border-violet-600 focus:ring-1 focus:ring-violet-600";

const AUTH_ERROR_KEYS: Record<string, TranslationKey> = {
	"Invalid email or password.": "authError.invalidCredentials",
	"An account with this email already exists.": "authError.emailTaken",
	"Registration is disabled on this server.": "authError.registrationDisabled",
	"Please enter a valid email address.": "authError.invalidEmail",
	"Password must be at least 8 characters.": "authError.passwordTooShort",
	"Unable to reach the server.": "authError.unreachable",
};

function LoginContent() {
	const { isLoading: isAuthChecking, isAuthenticated } = useRedirectIfAuth();
	const { t } = useI18n();
	const translateError = (msg: string) => {
		const key = AUTH_ERROR_KEYS[msg];
		return key ? t(key) : msg;
	};
	const searchParams = useSearchParams();
	const redirectTo = searchParams.get("redirect") || "/dashboard";
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [loading, setLoading] = useState(false);
	const [message, setMessage] = useState<{
		text: string;
		type: "success" | "error";
	} | null>(null);

	const handleEmailLogin = async (e: React.FormEvent) => {
		e.preventDefault();
		setLoading(true);
		setMessage(null);

		const { error } = await auth.signInWithPassword({
			email,
			password,
		});

		if (error) {
			setMessage({ text: translateError(error.message), type: "error" });
		} else {
			setMessage({ text: t("login.signingIn"), type: "success" });
			window.location.href = redirectTo;
		}
		setLoading(false);
	};


	if (isAuthChecking || isAuthenticated) {
		return (
			<div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950">
				<Loader2 className="w-10 h-10 animate-spin text-violet-600" />
			</div>
		);
	}

	return (
		<main className="min-h-[calc(100svh-3.5rem)] bg-zinc-50 px-6 pt-[11svh] pb-16">
			<div className="mx-auto w-full max-w-sm">
				<p className="meta text-zinc-500">{t("login.title")}</p>
				<h1 className="mt-3 text-[clamp(2.4rem,9vw,3rem)] leading-[1.05] tracking-[-0.02em] text-zinc-900" style={{ fontFamily: "var(--font-display)" }}>
					{t("login.heading")}
				</h1>

				<form onSubmit={handleEmailLogin} className="mt-7 space-y-5">
					<div className="space-y-1.5">
						<label htmlFor="email" className="block text-sm text-zinc-600">
							{t("login.email")}
						</label>
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
						<label htmlFor="password" className="block text-sm text-zinc-600">
							{t("login.password")}
						</label>
						<input
							id="password"
							type="password"
							autoComplete="current-password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							required
							className={field}
						/>
					</div>

					{message && (
						<p
							role={message.type === "error" ? "alert" : "status"}
							className={`text-sm ${message.type === "error" ? "text-red-700" : "text-zinc-600"}`}
						>
							{message.text}
						</p>
					)}

					<button
						type="submit"
						disabled={loading}
						className="w-full h-[54px] rounded-[2px] bg-zinc-900 text-base font-medium text-zinc-50 transition-colors hover:bg-violet-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-50 disabled:opacity-70"
					>
						{loading ? t("login.signingIn") : t("login.submit")}
					</button>
				</form>

				<p className="mt-8 text-sm text-zinc-500">
					{t("login.noAccount")}{" "}
					<Link href="/signup" className="text-zinc-700 underline underline-offset-4 hover:text-zinc-900">
						{t("login.signupLink")}
					</Link>
				</p>
			</div>
		</main>
	);
}

export default function LoginPage() {
	return (
		<Suspense
			fallback={
				<div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950">
					<Loader2 className="w-10 h-10 animate-spin text-violet-600" />
				</div>
			}
		>
			<LoginContent />
		</Suspense>
	);
}
