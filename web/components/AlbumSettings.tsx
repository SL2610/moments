"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { guestLink } from "@/lib/guestLink";

interface Album {
	id: string;
	title: string;
	publicId: string;
	eventDate: string | null;
	passwordSet: boolean;
	coverUrl: string | null;
}

const field =
	"w-full min-h-11 rounded border border-zinc-300 bg-white px-3 text-base focus:outline-none focus:ring-2 focus:ring-violet-600";

/** What guests see: names, date, cover, optional password, and the link itself. */
export default function AlbumSettings({ albumId }: { albumId: string }) {
	const [album, setAlbum] = useState<Album | null>(null);
	const [title, setTitle] = useState("");
	const [eventDate, setEventDate] = useState("");
	const [password, setPassword] = useState("");
	const [status, setStatus] = useState("");
	const [isSaving, setIsSaving] = useState(false);
	const [isUploading, setIsUploading] = useState(false);

	const apply = (a: Album) => {
		setAlbum(a);
		setTitle(a.title);
		setEventDate(a.eventDate ?? "");
	};

	useEffect(() => {
		apiFetch("/api/albums")
			.then((res) => (res.ok ? res.json() : []))
			.then((albums: Album[]) => {
				const found = albums.find((a) => a.id === albumId);
				if (found) apply(found);
			});
	}, [albumId]);

	const save = async (guestPassword?: string) => {
		setIsSaving(true);
		setStatus("");
		const res = await apiFetch(`/api/albums/${albumId}/settings`, {
			method: "PUT",
			body: JSON.stringify({ title, eventDate, guestPassword }),
		});
		setIsSaving(false);
		if (!res.ok) return setStatus("Couldn't save. Check the names aren't empty.");
		apply(await res.json());
		setPassword("");
		setStatus("Saved.");
	};

	const uploadCover = async (file: File | undefined) => {
		if (!file) return;
		setIsUploading(true);
		setStatus("");
		const body = new FormData();
		body.append("file", file);
		const res = await apiFetch(`/api/albums/${albumId}/cover`, { method: "PUT", body });
		setIsUploading(false);
		if (!res.ok) return setStatus("That cover didn't upload. Try a JPG under the size limit.");
		apply(await res.json());
	};

	if (!album) return null;
	const link = guestLink(album.publicId);

	return (
		<section className="bg-white rounded border border-zinc-200 p-6 grid gap-8 lg:grid-cols-[1fr_auto]">
			<form
				onSubmit={(e) => {
					e.preventDefault();
					save(password || undefined);
				}}
				className="space-y-5"
			>
				<h2 className="text-2xl text-zinc-900" style={{ fontFamily: "var(--font-display)" }}>
					Your guest page
				</h2>
				<div>
					<label htmlFor="s-title" className="block text-sm font-medium mb-1">Your names</label>
					<input id="s-title" className={field} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
				</div>
				<div>
					<label htmlFor="s-date" className="block text-sm font-medium mb-1">Wedding date</label>
					<input id="s-date" className={field} value={eventDate} onChange={(e) => setEventDate(e.target.value)} placeholder="14.06.2026" maxLength={32} />
				</div>
				<div>
					<label htmlFor="s-cover" className="block text-sm font-medium mb-1">Cover photo</label>
					<div className="flex items-center gap-4">
						{album.coverUrl && (
							/* eslint-disable-next-line @next/next/no-img-element */
							<img src={album.coverUrl} alt="" className="w-20 h-20 object-cover rounded" />
						)}
						<input id="s-cover" type="file" accept="image/*" onChange={(e) => uploadCover(e.target.files?.[0])} className="text-sm" />
						{isUploading && <Loader2 className="w-4 h-4 animate-spin" />}
					</div>
				</div>
				<div>
					<label htmlFor="s-password" className="block text-sm font-medium mb-1">
						Guest password <span className="font-normal text-zinc-500">(optional)</span>
					</label>
					<input
						id="s-password"
						type="text"
						className={field}
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						placeholder={album.passwordSet ? "Set. Type a new one to change it" : "None: the link alone opens the gallery"}
						maxLength={72}
						autoComplete="off"
					/>
					{album.passwordSet && (
						<button type="button" onClick={() => save("")} className="mt-1.5 text-sm underline underline-offset-4">
							Remove the password
						</button>
					)}
				</div>
				<div className="flex items-center gap-3">
					<Button type="submit" disabled={isSaving} className="min-h-11 px-6">
						{isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
					</Button>
					{status && <p role="status" className="text-sm text-zinc-600">{status}</p>}
				</div>
			</form>

			<div className="flex flex-col items-center gap-3 lg:w-64">
				<QRCodeSVG value={link} size={200} level="M" marginSize={2} fgColor="#1c1a16" bgColor="#ffffff" />
				<a href={link} target="_blank" rel="noreferrer" className="text-sm break-all text-center underline underline-offset-4" dir="ltr">
					{link}
				</a>
				<Button type="button" variant="outline" onClick={() => navigator.clipboard.writeText(link)} className="min-h-11">
					Copy link
				</Button>
			</div>
		</section>
	);
}
