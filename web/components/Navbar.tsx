"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { DropdownMenu } from "radix-ui";
import { LayoutDashboard, LogOut, Menu } from "lucide-react";
import { auth } from "@/lib/auth";
import Wordmark from "@/components/Wordmark";
import { useI18n, setLocale } from "@/lib/i18n/I18nProvider";

const item =
	"flex items-center gap-2.5 px-3 py-2.5 text-sm text-zinc-700 rounded-[2px] outline-none cursor-pointer data-[highlighted]:bg-zinc-100";

export default function Navbar() {
	const router = useRouter();
	const pathname = usePathname();
	const { t, locale, dir } = useI18n();
	const [isLoggedIn, setIsLoggedIn] = useState(false);
	const [userEmail, setUserEmail] = useState<string | null>(null);

	useEffect(() => {
		auth.getSession().then(({ data: { session } }) => {
			setIsLoggedIn(!!session);
			setUserEmail(session?.user?.email ?? null);
		});
		const {
			data: { subscription },
		} = auth.onAuthStateChange((_event, session) => {
			setIsLoggedIn(!!session);
			setUserEmail(session?.user?.email ?? null);
		});
		return () => subscription.unsubscribe();
	}, []);

	// The guest experience carries the wedding identity, not app navigation.
	if (pathname === "/" || pathname?.startsWith("/w/")) return null;

	const otherLang = locale === "he" ? "en" : "he";
	const langLabel = locale === "he" ? "English" : "עברית";

	return (
		<nav className="sticky top-0 z-40 w-full border-b border-zinc-200 bg-zinc-50">
			<div className="max-w-7xl mx-auto flex items-center justify-between h-16 px-6 lg:px-8">
				<Link href={isLoggedIn ? "/dashboard" : "/"} className="text-zinc-900" aria-label="WED">
					<Wordmark />
				</Link>

				{/* Signed out, the page itself is the sign-in or sign-up form: only the language. */}
				{!isLoggedIn ? (
					<button onClick={() => setLocale(otherLang)} lang={otherLang} className="min-h-11 text-sm text-zinc-500 hover:text-zinc-900">
						{langLabel}
					</button>
				) : (
					<DropdownMenu.Root dir={dir}>
						<DropdownMenu.Trigger asChild>
							<button className="p-2 -me-2 text-zinc-800 hover:text-zinc-950" aria-label={t("nav.menu")}>
								<Menu className="w-6 h-6" strokeWidth={1.25} />
							</button>
						</DropdownMenu.Trigger>
						<DropdownMenu.Portal>
							<DropdownMenu.Content
								align="end"
								sideOffset={8}
								collisionPadding={12}
								className="z-50 min-w-56 bg-[#fbf9f5] border border-zinc-300 p-1.5 shadow-[0_18px_40px_-20px_rgba(25,25,23,0.5)]"
							>
								{userEmail && <p className="px-3 pt-2 pb-2.5 text-xs text-zinc-500 truncate border-b border-zinc-200 mb-1">{userEmail}</p>}
								<DropdownMenu.Item onSelect={() => router.push("/dashboard")} className={item}>
									<LayoutDashboard className="w-4 h-4" />
									{t("nav.dashboard")}
								</DropdownMenu.Item>
								<DropdownMenu.Item onSelect={() => setLocale(otherLang)} lang={otherLang} className={item}>
									<span className="w-4 text-center text-xs" aria-hidden>
										{otherLang === "he" ? "א" : "A"}
									</span>
									{langLabel}
								</DropdownMenu.Item>
								<DropdownMenu.Item
									onSelect={async () => {
										await auth.signOut();
										router.push("/login");
									}}
									className={item}
								>
									<LogOut className="w-4 h-4" />
									{t("nav.logout")}
								</DropdownMenu.Item>
							</DropdownMenu.Content>
						</DropdownMenu.Portal>
					</DropdownMenu.Root>
				)}
			</div>
		</nav>
	);
}
