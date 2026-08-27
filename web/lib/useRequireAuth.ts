"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { auth } from "@/lib/auth";

export function useRequireAuth() {
	const router = useRouter();
	const pathname = usePathname();
	const [isLoading, setIsLoading] = useState(true);
	const [isAuthenticated, setIsAuthenticated] = useState(false);

	useEffect(() => {
		const check = async () => {
			const {
				data: { session },
			} = await auth.getSession();

			if (!session) {
				const redirectUrl =
					pathname && pathname !== "/"
						? `/login?redirect=${encodeURIComponent(pathname)}`
						: "/login";
				router.replace(redirectUrl);
			} else {
				setIsAuthenticated(true);
			}
			setIsLoading(false);
		};
		check();
	}, [router, pathname]);

	return { isLoading, isAuthenticated };
}

export function useRedirectIfAuth() {
	const router = useRouter();
	const [isLoading, setIsLoading] = useState(true);
	const [isAuthenticated, setIsAuthenticated] = useState(false);

	useEffect(() => {
		const check = async () => {
			const {
				data: { session },
			} = await auth.getSession();

			if (session) {
				setIsAuthenticated(true);
				router.replace("/dashboard");
			}
			setIsLoading(false);
		};
		check();
	}, [router]);

	return { isLoading, isAuthenticated };
}
