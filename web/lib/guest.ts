"use client";

/**
 * Wedding guest session, one per wedding link (/w/<publicId>): an anonymous
 * 30-day guest token, plus a display name once the guest picks one.
 */

export interface GuestSession {
	token: string;
	guest: { id: string; name: string | null };
	albumId: string;
}

export interface WeddingInfo {
	eventName: string;
	eventDate: string;
	passwordRequired: boolean;
	coverUrl: string | null;
}

// A browser can hold sessions for several weddings; guestFetch uses the open one.
let activeWedding = "";
const storageKey = (publicId: string) => `wedding.guest.${publicId}`;

export function setActiveWedding(publicId: string) {
	activeWedding = publicId;
}

export function getGuestSession(): GuestSession | null {
	if (typeof window === "undefined" || !activeWedding) return null;
	try {
		const raw = localStorage.getItem(storageKey(activeWedding));
		return raw ? (JSON.parse(raw) as GuestSession) : null;
	} catch {
		return null;
	}
}

function saveGuestSession(session: GuestSession) {
	localStorage.setItem(storageKey(activeWedding), JSON.stringify(session));
}

export function clearGuestSession() {
	localStorage.removeItem(storageKey(activeWedding));
}

export async function fetchWeddingInfo(publicId: string): Promise<WeddingInfo | null> {
	try {
		const res = await fetch(`/api/w/${encodeURIComponent(publicId)}`);
		return res.ok ? ((await res.json()) as WeddingInfo) : null;
	} catch {
		return null;
	}
}

export async function joinWedding(
	password: string,
): Promise<{ session: GuestSession | null; error: string | null }> {
	try {
		const res = await fetch(`/api/w/${encodeURIComponent(activeWedding)}/join`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ password }),
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) return { session: null, error: data?.error || "server-error" };
		const session: GuestSession = {
			token: data.accessToken,
			guest: { id: data.guest.id, name: null },
			albumId: data.albumId,
		};
		saveGuestSession(session);
		return { session, error: null };
	} catch {
		return { session: null, error: "network-error" };
	}
}

/** Sets the guest's display name (asked only before uploading or tagging). */
export async function setGuestName(name: string): Promise<GuestSession | null> {
	const res = await guestFetch("/api/wedding/me", {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ name }),
	});
	const current = getGuestSession();
	if (!res.ok || !current) return null;
	const data = await res.json();
	const session: GuestSession = {
		...current,
		token: data.accessToken,
		guest: { ...current.guest, name: data.name },
	};
	saveGuestSession(session);
	return session;
}

export async function guestFetch(endpoint: string, options: RequestInit = {}) {
	const session = getGuestSession();
	const headers = new Headers(options.headers);
	if (session?.token) {
		headers.set("Authorization", `Bearer ${session.token}`);
	}
	return fetch(endpoint, { ...options, headers });
}
