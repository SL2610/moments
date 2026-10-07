import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const EVENT_NAME = process.env.NEXT_PUBLIC_EVENT_NAME || "Your Names Here";
const EVENT_DATE = process.env.NEXT_PUBLIC_EVENT_DATE || "";

// Generated share-preview card so a fresh clone looks right with zero
// configuration. Drop data/branding/og-card.jpg in (see SELF_HOSTING.md) to
// use your own artwork instead.
export default function OpengraphImage() {
	return new ImageResponse(
		(
			<div
				style={{
					width: "100%",
					height: "100%",
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					justifyContent: "center",
					background: "#f8f4ee",
					color: "#3a2c14",
				}}
			>
				<div style={{ fontSize: 72, letterSpacing: 4, textTransform: "uppercase" }}>
					{EVENT_NAME}
				</div>
				{EVENT_DATE && (
					<div style={{ fontSize: 32, marginTop: 24, color: "#8a6220" }}>
						{EVENT_DATE}
					</div>
				)}
			</div>
		),
		{ ...size },
	);
}
