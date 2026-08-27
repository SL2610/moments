import type { NextConfig } from "next";

const normalizeBaseUrl = (value: string) =>
	value.replace(/\/+$/, "").replace(/\/api$/i, "");

// Internal service URLs (server-side only). Defaults match the Docker
// Compose service names; override for local dev outside Docker.
const API_URL = normalizeBaseUrl(
	process.env.API_INTERNAL_URL || "http://api:8080",
);
const AI_API_URL = normalizeBaseUrl(
	process.env.AI_INTERNAL_URL || "http://ai-search:5000",
);

const nextConfig: NextConfig = {
	output: "standalone",
	async rewrites() {
		return [
			{
				source: "/api/ai/:path*",
				destination: `${AI_API_URL}/:path*`,
			},
			{
				source: "/api/:path*",
				destination: `${API_URL}/api/:path*`,
			},
		];
	},
};

export default nextConfig;
