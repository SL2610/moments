import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
	return {
		name: "WED",
		short_name: "WED",
		description: "Find your wedding photos with one selfie.",
		start_url: "/",
		display: "standalone",
		background_color: "#fbf9f5",
		theme_color: "#181614",
		icons: [
			{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
			{ src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
		],
	};
}
