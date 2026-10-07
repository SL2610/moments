"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { auth } from "@/lib/auth";
import { useRedirectIfAuth } from "@/lib/useRequireAuth";
import Link from "next/link";
import { LogIn, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { TranslationKey } from "@/lib/i18n/locale";

const EVENT_NAME = process.env.NEXT_PUBLIC_EVENT_NAME || "Moments";

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
		<div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-4">
			<div className="w-full max-w-md p-8 space-y-8 bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-zinc-200 dark:border-zinc-800">
				<div className="flex flex-col items-center text-center space-y-3">
					<div dir="ltr" className="text-center">
						<p className="text-3xl lowercase text-zinc-900 dark:text-zinc-50" style={{ fontFamily: "var(--font-display)" }}>{EVENT_NAME}</p>
						<p className="text-[10px] tracking-[0.3em] text-zinc-400 mt-1">ADMIN</p>
					</div>
					<p className="text-zinc-500 dark:text-zinc-400 max-w-72 text-sm">
						{t("login.welcomeBack")}
					</p>
				</div>

				<form onSubmit={handleEmailLogin} className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="email">{t("login.email")}</Label>
						<Input
							id="email"
							type="text"
							placeholder="owner@example.com" dir="ltr"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							required
							className="rounded-xl"
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="password">{t("login.password")}</Label>
						<Input
							id="password"
							type="password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							required
							className="rounded-xl"
						/>
					</div>

					{message && (
						<div
							className={`text-sm p-3 rounded-xl border ${message.type === "error" ? "bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800" : "bg-green-50 dark:bg-green-950/40 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800"}`}
						>
							{message.text}
						</div>
					)}

					<Button
						type="submit"
						className="w-full h-11 rounded-xl font-semibold flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 text-white"
						disabled={loading}
					>
						{loading ? (
							t("login.signingIn")
						) : (
							<>
								<LogIn className="w-4 h-4" /> {t("login.submit")}
							</>
						)}
					</Button>
				</form>

				<div className="text-center text-sm text-zinc-500">
					{t("login.noAccount")}{" "}
					<Link
						href="/signup"
						className="font-bold text-zinc-900 dark:text-zinc-50 hover:underline"
					>
						{t("login.signupLink")}
					</Link>
				</div>
			</div>
		</div>
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
