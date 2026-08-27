import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Generic mark so a fresh clone looks right with zero configuration.
// Swap this file (or drop icon.png/apple-icon.png back in) to brand it.
export default function AppleIcon() {
	return new ImageResponse(
		(
			<div
				style={{
					width: "100%",
					height: "100%",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					background: "#8a6220",
					fontSize: 96,
				}}
			>
				📷
			</div>
		),
		{ ...size },
	);
}
