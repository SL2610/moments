"use client";

/**
 * Local auth client for the self-hosted Spring Boot backend.
 * Mirrors the small slice of the Supabase auth surface the app used:
 * getSession, signInWithPassword, signUp, signOut, onAuthStateChange.
 */

export interface AuthUser {
	id: string;
	email: string;
}

export interface Session {
	access_token: string;
	refresh_token: string;
	expires_at: number; // epoch ms
	user: AuthUser;
}

type AuthListener = (event: "SIGNED_IN" | "SIGNED_OUT", session: Session | null) => void;

const STORAGE_KEY = "grabpic.auth";
const listeners = new Set<AuthListener>();
let refreshPromise: Promise<Session | null> | null = null;

function readStored(): Session | null {
	if (typeof window === "undefined") return null;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw ? (JSON.parse(raw) as Session) : null;
	} catch {
		return null;
	}
}

function store(session: Session | null) {
	if (typeof window === "undefined") return;
	if (session) {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
	} else {
		localStorage.removeItem(STORAGE_KEY);
	}
}

function notify(event: "SIGNED_IN" | "SIGNED_OUT", session: Session | null) {
	listeners.forEach((cb) => cb(event, session));
}

interface TokenResponse {
	accessToken: string;
	refreshToken: string;
	expiresIn: number;
	user: AuthUser;
}

function toSession(tokens: TokenResponse): Session {
	return {
		access_token: tokens.accessToken,
		refresh_token: tokens.refreshToken,
		expires_at: Date.now() + tokens.expiresIn * 1000,
		user: tokens.user,
	};
}

async function authRequest(
	path: string,
	body: object,
): Promise<{ session: Session | null; error: { message: string } | null }> {
	try {
		const res = await fetch(`/api/auth/${path}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			return {
				session: null,
				error: { message: data?.error || "Something went wrong. Please try again." },
			};
		}
		const session = toSession(data as TokenResponse);
		store(session);
		notify("SIGNED_IN", session);
		return { session, error: null };
	} catch {
		return { session: null, error: { message: "Unable to reach the server." } };
	}
}

async function refreshSession(refreshToken: string): Promise<Session | null> {
	try {
		const res = await fetch("/api/auth/refresh", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ refreshToken }),
		});
		if (!res.ok) {
			store(null);
			notify("SIGNED_OUT", null);
			return null;
		}
		const session = toSession((await res.json()) as TokenResponse);
		store(session);
		return session;
	} catch {
		// Network hiccup: keep the stored session, the API will still reject
		// expired tokens with a 401.
		return readStored();
	}
}

export const auth = {
	async getSession(): Promise<{ data: { session: Session | null } }> {
		const stored = readStored();
		if (!stored) return { data: { session: null } };
		if (stored.expires_at - 30_000 > Date.now()) {
			return { data: { session: stored } };
		}
		if (!refreshPromise) {
			refreshPromise = refreshSession(stored.refresh_token).finally(() => {
				refreshPromise = null;
			});
		}
		return { data: { session: await refreshPromise } };
	},

	signInWithPassword(credentials: { email: string; password: string }) {
		return authRequest("login", credentials);
	},

	signUp(credentials: { email: string; password: string }) {
		return authRequest("register", credentials);
	},

	async signOut() {
		store(null);
		notify("SIGNED_OUT", null);
	},

	onAuthStateChange(callback: AuthListener) {
		listeners.add(callback);
		return {
			data: {
				subscription: {
					unsubscribe: () => {
						listeners.delete(callback);
					},
				},
			},
		};
	},
};
