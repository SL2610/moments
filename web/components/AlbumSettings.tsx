"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { apiFetch } from "@/lib/api";
import { guestLink } from "@/lib/guestLink";
import { useAdminText } from "@/lib/i18n/admin";
import { Section, btnInk, btnLine, field, linkQuiet } from "@/components/admin/Kit";

export interface Album {
	id: string;
	title: string;
	publicId: string;
	eventDate: string | null;
	passwordSet: boolean;
	coverUrl: string | null;
}

/** What guests see: names, date, cover, optional password, and the link itself. */
export default function AlbumSettings({ album, onChange }: { album: Album; onChange: (a: Album) => void }) {
	const tx = useAdminText();
	// Local edits start from the saved album; a fresh save replaces the album and resets them.
	const [title, setTitle] = useState(album.title);
	const [eventDate, setEventDate] = useState(album.eventDate ?? "");
	const [password, setPassword] = useState("");
	const [status, setStatus] = useState("");
	const [isSaving, setIsSaving] = useState(false);
	const [isUploading, setIsUploading] = useState(false);
	const [copied, setCopied] = useState(false);

	const save = async (guestPassword?: string) => {
		setIsSaving(true);
		setStatus("");
		const res = await apiFetch(`/api/albums/${album.id}/settings`, {
			method: "PUT",
			body: JSON.stringify({ title, eventDate, guestPassword }),
		}).catch(() => null);
		setIsSaving(false);
		if (!res?.ok) return setStatus(tx("settings.saveError"));
		onChange(await res.json());
		setPassword("");
		setStatus(tx("settings.saved"));
	};

	const uploadCover = async (file: File | undefined) => {
		if (!file) return;
		setIsUploading(true);
		setStatus("");
		const body = new FormData();
		body.append("file", file);
		const res = await apiFetch(`/api/albums/${album.id}/cover`, { method: "PUT", body }).catch(() => null);
		setIsUploading(false);
		if (!res?.ok) return setStatus(tx("settings.coverError"));
		onChange(await res.json());
	};

	const link = guestLink(album.publicId);

	return (
		<Section title={tx("settings.title")} body={tx("settings.body")}>
			<div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_16rem]">
				<form
					onSubmit={(e) => {
						e.preventDefault();
						save(password || undefined);
					}}
					className="grid gap-6 sm:grid-cols-2"
				>
					<div className="sm:col-span-2">
						<label htmlFor="s-title" className="block text-sm text-zinc-600 mb-1.5">{tx("settings.names")}</label>
						<input id="s-title" dir="auto" className={field} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
					</div>
					<div>
						<label htmlFor="s-date" className="block text-sm text-zinc-600 mb-1.5">{tx("settings.date")}</label>
						<input id="s-date" dir="ltr" className={field} value={eventDate} onChange={(e) => setEventDate(e.target.value)} placeholder="14.06.2026" maxLength={32} />
					</div>
					<div>
						<label htmlFor="s-password" className="block text-sm text-zinc-600 mb-1.5">
							{tx("settings.password")} <span className="text-zinc-400">· {tx("settings.optional")}</span>
						</label>
						<input
							id="s-password"
							type="text"
							className={field}
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							placeholder={album.passwordSet ? tx("settings.passwordSet") : tx("settings.passwordNone")}
							maxLength={72}
							autoComplete="off"
						/>
						{album.passwordSet && (
							<button type="button" onClick={() => save("")} className={`${linkQuiet} text-sm`}>
								{tx("settings.passwordRemove")}
							</button>
						)}
					</div>
					<div className="sm:col-span-2">
						<p className="text-sm text-zinc-600 mb-2">{tx("settings.cover")}</p>
						<div className="flex items-end gap-5">
							<div className="crop w-28 shrink-0">
								<div className="aspect-[4/5] overflow-hidden bg-[#eee9e1]">
									{album.coverUrl && (
										// eslint-disable-next-line @next/next/no-img-element
										<img src={album.coverUrl} alt="" className="h-full w-full object-cover" />
									)}
								</div>
							</div>
							<label className={`${btnLine} cursor-pointer`}>
								{isUploading ? tx("loading") : album.coverUrl ? tx("settings.coverReplace") : tx("settings.coverChoose")}
								<input type="file" accept="image/*" className="sr-only" onChange={(e) => uploadCover(e.target.files?.[0])} />
							</label>
						</div>
					</div>
					<div className="sm:col-span-2 flex items-center gap-4">
						<button type="submit" disabled={isSaving} className={btnInk}>
							{isSaving ? tx("loading") : tx("settings.save")}
						</button>
						{status && <p role="status" className="text-sm text-zinc-600">{status}</p>}
					</div>
				</form>

				<aside className="lg:border-s lg:border-zinc-300 lg:ps-10">
					<p className="meta text-zinc-500">{tx("settings.link")}</p>
					<div className="mt-4 bg-white p-3 w-fit">
						<QRCodeSVG value={link} size={168} level="M" marginSize={0} fgColor="#191917" bgColor="#ffffff" />
					</div>
					<a href={link} target="_blank" rel="noreferrer" dir="ltr" className="mt-4 block break-all text-sm text-zinc-700 underline decoration-zinc-300 underline-offset-4">
						{link.replace(/^https?:\/\//, "")}
					</a>
					<button
						type="button"
						onClick={() => {
							navigator.clipboard.writeText(link);
							setCopied(true);
							setTimeout(() => setCopied(false), 2000);
						}}
						className={`${btnLine} mt-4 w-full`}
					>
						{copied ? tx("settings.copied") : tx("settings.copy")}
					</button>
				</aside>
			</div>
		</Section>
	);
}
