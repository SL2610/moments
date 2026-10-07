"use client";

/** Wedding guest session: name + shared password -> 30-day guest token. */

export interface GuestSession {
	token: string;
	guest: { id: string; name: string };
	albumId: string;
	eventName: string;
}

const STORAGE_KEY = "wedding.guest";

export function getGuestSession(): GuestSession | null {
	if (typeof window === "undefined") return null;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw ? (JSON.parse(raw) as GuestSession) : null;
	} catch {
		return null;
	}
}

export function clearGuestSession() {
	localStorage.removeItem(STORAGE_KEY);
}

export async function joinWedding(
	name: string,
	phone: string,
	password: string,
): Promise<{
	session: GuestSession | null;
	error: string | null;
	existingName?: string;
}> {
	try {
		const res = await fetch("/api/wedding/join", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name, phone, password }),
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			return {
				session: null,
				error: data?.error || "server-error",
				existingName: data?.existingName,
			};
		}
		const session: GuestSession = {
			token: data.accessToken,
			guest: data.guest,
			albumId: data.albumId,
			eventName: data.eventName,
		};
		localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
		return { session, error: null };
	} catch {
		return { session: null, error: "network-error" };
	}
}

export async function guestFetch(endpoint: string, options: RequestInit = {}) {
	const session = getGuestSession();
	const headers = new Headers(options.headers);
	if (session?.token) {
		headers.set("Authorization", `Bearer ${session.token}`);
	}
	return fetch(endpoint, { ...options, headers });
}
