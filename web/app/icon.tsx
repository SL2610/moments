import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

// Generic mark so a fresh clone looks right with zero configuration.
// Swap this file (or drop icon.png/apple-icon.png back in) to brand it.
export default function Icon() {
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
					borderRadius: 14,
					fontSize: 36,
				}}
			>
				📷
			</div>
		),
		{ ...size },
	);
}
