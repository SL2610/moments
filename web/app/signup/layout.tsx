import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Sign Up",
	description:
		"Create a free wedding gallery account to start sharing event photos with AI facial recognition. Sign up with email, Google, or GitHub.",
	openGraph: {
		title: "Sign Up | " + (process.env.NEXT_PUBLIC_EVENT_NAME || "Moments"),
		description:
			"Create a free wedding gallery account to start sharing event photos with AI facial recognition.",
	},
	alternates: {
		canonical: "/signup",
	},
};

export default function SignupLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return children;
}
