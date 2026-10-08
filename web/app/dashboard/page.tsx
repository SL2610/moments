"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { useAdminText } from "@/lib/i18n/admin";
import { guestLink } from "@/lib/guestLink";
import { AdminPage, Loading, PageHead, btnInk, field, formatDate, linkQuiet } from "@/components/admin/Kit";

interface Album {
	id: string;
	title: string;
	createdAt: string;
	publicId: string;
	eventDate: string | null;
	coverUrl: string | null;
}

export default function DashboardPage() {
	const { isLoading: isAuthLoading, isAuthenticated } = useRequireAuth();
	const router = useRouter();
	const tx = useAdminText();
	const [albums, setAlbums] = useState<Album[] | null>(null);
	const [title, setTitle] = useState("");
	const [isCreating, setIsCreating] = useState(false);
	const [error, setError] = useState("");

	useEffect(() => {
		if (!isAuthenticated) return;
		apiFetch("/api/albums")
			.then((res) => (res.ok ? res.json() : []))
			.then(setAlbums)
			.catch(() => setAlbums([]));
	}, [isAuthenticated]);

	const create = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!title.trim()) return;
		setIsCreating(true);
		setError("");
		try {
			const res = await apiFetch("/api/albums", { method: "POST", body: JSON.stringify({ title: title.trim() }) });
			if (!res.ok) throw new Error();
			const album: Album = await res.json();
			router.push(`/dashboard/albums/${album.id}`);
		} catch {
			setError(tx("genericError"));
			setIsCreating(false);
		}
	};

	if (isAuthLoading || !isAuthenticated || albums === null) return <Loading />;

	return (
		<AdminPage>
			<PageHead meta={tx("meta")} title={tx("albums.title")} />

			{albums.length === 0 && <p className="text-lg text-zinc-600 mb-10">{tx("albums.empty")}</p>}

			<ul className="grid gap-x-10 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
				{albums.map((album) => (
					<li key={album.id}>
						<Link href={`/dashboard/albums/${album.id}/view`} className="group block">
							<div className="crop">
								<div className="aspect-[4/5] overflow-hidden bg-[#f3efe9]">
									{album.coverUrl ? (
										// eslint-disable-next-line @next/next/no-img-element
										<img
											src={album.coverUrl}
											alt=""
											className="h-full w-full object-cover transition duration-700"
										/>
									) : (
										<div className="flex h-full items-end p-6">
											<span className="text-5xl leading-none text-zinc-900/15" style={{ fontFamily: "var(--font-display)" }} dir="auto">
												{album.title}
											</span>
										</div>
									)}
								</div>
							</div>
							<p className="meta mt-5 text-zinc-500" dir="ltr">
								{formatDate(album.eventDate) || tx("albums.noDate")}
							</p>
							<h2 className="mt-1.5 text-3xl leading-tight text-zinc-900" style={{ fontFamily: "var(--font-display)" }} dir="auto">
								{album.title}
							</h2>
						</Link>
						<div className="mt-3 flex flex-wrap gap-x-6">
							<Link href={`/dashboard/albums/${album.id}`} className={linkQuiet}>
								{tx("nav.page")}
							</Link>
							<a href={guestLink(album.publicId)} target="_blank" rel="noreferrer" className={linkQuiet}>
								{tx("albums.guestPage")} <span aria-hidden className="rtl:-scale-x-100 inline-block">↗</span>
							</a>
						</div>
					</li>
				))}

				<li>
					<form onSubmit={create} className="border-t border-zinc-300 pt-6 lg:mt-0">
						<p className="meta text-zinc-500">{tx("albums.new")}</p>
						<label htmlFor="new-album" className="mt-4 block text-sm text-zinc-600">
							{tx("albums.namesLabel")}
						</label>
						<input
							id="new-album"
							dir="auto"
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							placeholder={tx("albums.namesPlaceholder")}
							maxLength={120}
							className={`${field} mt-1.5`}
						/>
						{error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
						<button type="submit" disabled={isCreating || !title.trim()} className={`${btnInk} mt-4 w-full`}>
							{isCreating ? tx("albums.creating") : tx("albums.create")}
						</button>
					</form>
				</li>
			</ul>
		</AdminPage>
	);
}
