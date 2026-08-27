import type { MetadataRoute } from "next";

const EVENT_NAME = process.env.NEXT_PUBLIC_EVENT_NAME || "Your Names Here";

// ponytail: manifest name/description stay Hebrew (matches the default
// <html lang="he">) rather than switching with the lang cookie. The PWA
// install prompt isn't worth the extra plumbing.
export default function manifest(): MetadataRoute.Manifest {
	return {
		name: `${EVENT_NAME} · התמונות מהחתונה`,
		short_name: EVENT_NAME,
		description: `מצאו את התמונות שלכם מהחתונה של ${EVENT_NAME}`,
		start_url: "/",
		display: "standalone",
		background_color: "#f8f4ee",
		theme_color: "#8a6220",
		icons: [
			{ src: "/icon", sizes: "64x64", type: "image/png" },
			{ src: "/apple-icon", sizes: "180x180", type: "image/png" },
		],
	};
}
