import { auth } from "@/lib/auth";

export async function apiFetch(endpoint: string, options: RequestInit = {}) {
	const {
		data: { session },
	} = await auth.getSession();

	const headers = new Headers(options.headers);

	if (session?.access_token) {
		headers.set("Authorization", `Bearer ${session.access_token}`);
	}

	if (
		!headers.has("Content-Type") &&
		options.body &&
		typeof options.body === "string"
	) {
		headers.set("Content-Type", "application/json");
	}

	return fetch(endpoint, {
		...options,
		headers,
	});
}
