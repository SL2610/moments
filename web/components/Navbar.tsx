"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { auth } from "@/lib/auth";
import { LogOut, LayoutDashboard, LogIn, Menu, X, Home } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import Mark from "@/components/Mark";
import { useI18n, setLocale } from "@/lib/i18n/I18nProvider";

export default function Navbar() {
	const router = useRouter();
	const pathname = usePathname();
	const { t, locale } = useI18n();
	const [isLoggedIn, setIsLoggedIn] = useState(false);
	const [userEmail, setUserEmail] = useState<string | null>(null);
	const [mobileOpen, setMobileOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const checkSession = async () => {
			const {
				data: { session },
			} = await auth.getSession();
			setIsLoggedIn(!!session);
			setUserEmail(session?.user?.email ?? null);
		};
		checkSession();

		const {
			data: { subscription },
		} = auth.onAuthStateChange((_event, session) => {
			setIsLoggedIn(!!session);
			setUserEmail(session?.user?.email ?? null);
		});

		return () => subscription.unsubscribe();
	}, []);

	useEffect(() => {
		const handleClick = (e: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
				setMobileOpen(false);
			}
		};
		if (mobileOpen) document.addEventListener("mousedown", handleClick);
		return () => document.removeEventListener("mousedown", handleClick);
	}, [mobileOpen]);

	const handleLogout = async () => {
		setMobileOpen(false);
		await auth.signOut();
		router.push("/login");
	};

	const navigate = (path: string) => {
		setMobileOpen(false);
		router.push(path);
	};

	// The guest experience carries the wedding identity, not app navigation.
	if (pathname === "/" || pathname?.startsWith("/w/")) return null;

	return (
		<nav
			ref={menuRef}
			className="sticky top-0 z-40 w-full border-b border-zinc-200 bg-zinc-50"
		>
			<div className="max-w-7xl mx-auto flex items-center justify-between h-14 px-6 lg:px-8">
				<Link
					href={isLoggedIn ? "/dashboard" : "/"}
					className="flex items-center gap-2.5 text-zinc-900"
					dir="ltr"
					aria-label="WED"
				>
					<Mark className="h-3.5 w-auto" />
					<span className="text-[1.35rem] leading-none tracking-[0.14em]" style={{ fontFamily: "var(--font-display-face), serif" }}>
						WED
					</span>
				</Link>

				<div className="flex items-center gap-1">
					<button
						onClick={() => setLocale(locale === "he" ? "en" : "he")}
						lang={locale === "he" ? "en" : "he"}
						className="min-h-11 px-2 text-sm text-zinc-500 hover:text-zinc-900 transition-colors"
					>
						{locale === "he" ? "EN" : "עברית"}
					</button>

					<div className="hidden sm:flex items-center gap-2">
						{isLoggedIn ? (
							<>
								{userEmail && (
								<span className="text-sm text-zinc-500 truncate max-w-44 px-2">
									{userEmail}
								</span>
							)}

							<Button
								variant="ghost"
								size="sm"
								onClick={() => navigate("/")}
								className="text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white"
							>
								<Home className="w-4 h-4 me-1.5" />
								{t("nav.home")}
							</Button>

							<Button
								variant="ghost"
								size="sm"
								onClick={() => navigate("/dashboard")}
								className="text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white"
							>
								<LayoutDashboard className="w-4 h-4 me-1.5" />
								{t("nav.dashboard")}
							</Button>

							<Button
								variant="ghost"
								size="sm"
								onClick={handleLogout}
								className="text-zinc-500 hover:text-red-600 dark:text-zinc-400 dark:hover:text-red-400"
							>
								<LogOut className="w-4 h-4 me-1.5" />
								{t("nav.logout")}
							</Button>

						</>
					) : (
						<>
							<Button
								variant="ghost"
								size="sm"
								onClick={() => navigate("/")}
								className="text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white"
							>
								<Home className="w-4 h-4 me-1.5" />
								{t("nav.home")}
							</Button>

							<Button
								variant="ghost"
								size="sm"
								onClick={() => navigate("/login")}
								className="text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white"
							>
								<LogIn className="w-4 h-4 me-1.5" />
								{t("nav.login")}
							</Button>
							<Button
								size="sm"
								onClick={() => navigate("/signup")}
								className="bg-violet-600 hover:bg-violet-700 text-white"
							>
								{t("nav.signup")}
							</Button>

						</>
					)}
					</div>
					<button
						onClick={() => setMobileOpen((prev) => !prev)}
						className="sm:hidden min-h-11 min-w-11 -me-2.5 flex items-center justify-center text-zinc-500 hover:text-zinc-900 transition-colors"
						aria-label={t("nav.menu")}
					>
						{mobileOpen ? (
							<X className="w-5 h-5" />
						) : (
							<Menu className="w-5 h-5" />
						)}
					</button>
				</div>

			</div>

			{mobileOpen && (
				<div className="sm:hidden border-t border-zinc-200 bg-zinc-50 px-4 pb-4 pt-2 space-y-1">
					{isLoggedIn ? (
						<>
							{userEmail && (
								<p className="text-sm text-zinc-500 truncate px-3 py-2">
									{userEmail}
								</p>
							)}

							<button
								onClick={() => navigate("/")}
								className="flex items-center gap-2 w-full text-start px-3 py-2.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-[8px] transition-colors"
							>
								<Home className="w-4 h-4" />
								{t("nav.home")}
							</button>

							<button
								onClick={() => navigate("/dashboard")}
								className="flex items-center gap-2 w-full text-start px-3 py-2.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-[8px] transition-colors"
							>
								<LayoutDashboard className="w-4 h-4" />
								{t("nav.dashboard")}
							</button>

							<button
								onClick={handleLogout}
								className="flex items-center gap-2 w-full text-start px-3 py-2.5 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-[8px] transition-colors"
							>
								<LogOut className="w-4 h-4" />
								{t("nav.logout")}
							</button>

						</>
					) : (
						<>
							<button
								onClick={() => navigate("/")}
								className="flex items-center gap-2 w-full text-start px-3 py-2.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-[8px] transition-colors"
							>
								<Home className="w-4 h-4" />
								{t("nav.home")}
							</button>

							<button
								onClick={() => navigate("/login")}
								className="flex items-center gap-2 w-full text-start px-3 py-2.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-[8px] transition-colors"
							>
								<LogIn className="w-4 h-4" />
								{t("nav.login")}
							</button>
							<Button
								onClick={() => navigate("/signup")}
								className="w-full h-11 rounded-[8px] bg-violet-600 hover:bg-violet-700 text-zinc-50 font-medium"
							>
								{t("nav.signup")}
							</Button>

						</>
					)}
				</div>
			)}
		</nav>
	);
}
