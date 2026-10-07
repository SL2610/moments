import Link from "next/link";

// Wedding galleries live at /w/<id>; the bare root is only a doorway for couples.
export default function Home() {
	return (
		<main className="min-h-screen flex flex-col items-center justify-center gap-6 px-8 text-center">
			<h1 className="text-4xl text-zinc-900" style={{ fontFamily: "var(--font-display)" }}>
				WED
			</h1>
			<p className="max-w-sm text-zinc-600">
				Guests: open the link or QR code you got from the couple.
			</p>
			<Link href="/login" className="underline underline-offset-4 text-zinc-900">
				Couples: sign in
			</Link>
		</main>
	);
}
