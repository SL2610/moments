// The couple's guest URL. Prefer the public URL so a QR made from localhost
// still works, unless setup.sh left the example placeholder.
const PUBLIC_URL = process.env.NEXT_PUBLIC_PUBLIC_URL ?? "";

export function guestLink(publicId: string) {
	const base = PUBLIC_URL && !PUBLIC_URL.includes("example.com") ? PUBLIC_URL : window.location.origin;
	return `${base.replace(/\/+$/, "")}/w/${publicId}`;
}
