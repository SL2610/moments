import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Log In",
	description:
		"Log in to the wedding gallery to manage your event photo albums. Sign in with email, Google, or GitHub.",
	openGraph: {
		title: "Log In | " + (process.env.NEXT_PUBLIC_EVENT_NAME || "Moments"),
		description:
			"Log in to the wedding gallery to manage your event photo albums.",
	},
	alternates: {
		canonical: "/login",
	},
};

export default function LoginLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return children;
}
