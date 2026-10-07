"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { auth } from "@/lib/auth";
import { LogOut, LayoutDashboard, LogIn, Menu, X, Home } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useI18n, setLocale } from "@/lib/i18n/I18nProvider";

const EVENT_NAME = process.env.NEXT_PUBLIC_EVENT_NAME || "Moments";

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
	if (pathname === "/" || pathname?.includes("/guest")) return null;

	return (
		<nav
			ref={menuRef}
			className="sticky top-0 z-40 w-full border-b border-zinc-200/80 dark:border-zinc-800/80 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-xl"
		>
			<div className="max-w-7xl mx-auto flex items-center justify-between h-16 px-4 sm:px-6 lg:px-8">
				<Link
					href={isLoggedIn ? "/dashboard" : "/"}
					className="group transition-transform hover:scale-[1.02] active:scale-[0.98]"
					dir="ltr"
				>
					<span
						className="text-xl lowercase text-zinc-900 dark:text-zinc-50"
						style={{ fontFamily: "var(--font-display)" }}
					>
						{EVENT_NAME}
					</span>
					<span className="text-[10px] tracking-[0.3em] text-zinc-400 ms-3">
						{t("nav.admin")}
					</span>
				</Link>

				<div className="flex items-center gap-2">
					<button
						onClick={() => setLocale(locale === "he" ? "en" : "he")}
						className="text-xs font-semibold text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white px-2 py-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
					>
						{locale === "he" ? "EN" : "עברית"}
					</button>

					<div className="hidden sm:flex items-center gap-2">
						{isLoggedIn ? (
							<>
								{userEmail && (
								<span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium truncate max-w-44 bg-zinc-100 dark:bg-zinc-800/60 px-3 py-1.5 rounded-full">
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
				</div>

				<button
					onClick={() => setMobileOpen((prev) => !prev)}
					className="sm:hidden p-2 -me-2 text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white transition-colors"
					aria-label={t("nav.menu")}
				>
					{mobileOpen ? (
						<X className="w-5 h-5" />
					) : (
						<Menu className="w-5 h-5" />
					)}
				</button>
			</div>

			{mobileOpen && (
				<div className="sm:hidden border-t border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-zinc-950 px-4 pb-4 pt-3 space-y-2">
					{isLoggedIn ? (
						<>
							{userEmail && (
								<p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium truncate px-3 py-2 bg-zinc-100 dark:bg-zinc-800/60 rounded-xl">
									{userEmail}
								</p>
							)}

							<button
								onClick={() => navigate("/")}
								className="flex items-center gap-2 w-full text-start px-3 py-2.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors"
							>
								<Home className="w-4 h-4" />
								{t("nav.home")}
							</button>

							<button
								onClick={() => navigate("/dashboard")}
								className="flex items-center gap-2 w-full text-start px-3 py-2.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors"
							>
								<LayoutDashboard className="w-4 h-4" />
								{t("nav.dashboard")}
							</button>

							<button
								onClick={handleLogout}
								className="flex items-center gap-2 w-full text-start px-3 py-2.5 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-xl transition-colors"
							>
								<LogOut className="w-4 h-4" />
								{t("nav.logout")}
							</button>

						</>
					) : (
						<>
							<button
								onClick={() => navigate("/")}
								className="flex items-center gap-2 w-full text-start px-3 py-2.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors"
							>
								<Home className="w-4 h-4" />
								{t("nav.home")}
							</button>

							<button
								onClick={() => navigate("/login")}
								className="flex items-center gap-2 w-full text-start px-3 py-2.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors"
							>
								<LogIn className="w-4 h-4" />
								{t("nav.login")}
							</button>
							<Button
								onClick={() => navigate("/signup")}
								className="w-full bg-violet-600 hover:bg-violet-700 text-white font-semibold py-2.5"
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
