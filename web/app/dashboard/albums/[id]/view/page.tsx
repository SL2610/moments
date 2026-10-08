"use client";

import { Fragment, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Check, Loader2, Lock, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { apiFetch } from "@/lib/api";
import { useAlbumFeatures } from "@/features";
import { useAdminText } from "@/lib/i18n/admin";
import { AdminPage, AlbumNav, Loading, PageHead, btnInk, btnLine, formatDate, linkQuiet } from "@/components/admin/Kit";
import Link from "next/link";
import { useRequireAuth } from "@/lib/useRequireAuth";
import JSZip from "jszip";
import { fetchImageAsBlob, downloadImage } from "@/lib/download";

import { guestLink } from "@/lib/guestLink";

interface Photo {
	id: string;
	viewUrl: string;
	previewUrl: string;
	thumbUrl: string;
	isPublic: boolean;
	processed: boolean;
	faceCount: number;
	faceBoxes: string[];
}

export default function AlbumViewPage() {
	const { isLoading: isAuthLoading, isAuthenticated } = useRequireAuth();
	const tx = useAdminText();
	const params = useParams<{ id: string }>();
	const router = useRouter();
	const albumId = params?.id || "";

	const [photos, setPhotos] = useState<Photo[]>([]);
	const [isLoading, setIsLoading] = useState(true);

	const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
	const [imageDims, setImageDims] = useState({ width: 1, height: 1 });
	const [showBoxes, setShowBoxes] = useState(false);

	const [isSelectionMode, setIsSelectionMode] = useState(false);
	const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);

	const [isShareModalOpen, setIsShareModalOpen] = useState(false);
	const [isCopied, setIsCopied] = useState(false);
	const [isDownloadingZip, setIsDownloadingZip] = useState(false);

	useEffect(() => {
		let hasUnprocessed = false;

		const fetchPhotos = async () => {
			try {
				const response = await apiFetch(`/api/albums/${albumId}/photos`);
				if (!response.ok) throw new Error("Failed to fetch photos");
				const data: Photo[] = await response.json();
				hasUnprocessed = data.some((p) => !p.processed);
				setPhotos(data);
			} catch (error) {
				console.error("Error loading album:", error);
			} finally {
				setIsLoading(false);
			}
		};

		if (!albumId) return;
		fetchPhotos();

		// Poll while photos are still being scanned (replaces Supabase Realtime).
		const interval = setInterval(() => {
			if (hasUnprocessed) fetchPhotos();
		}, 5000);

		return () => clearInterval(interval);
	}, [albumId]);

	const [publicId, setPublicId] = useState("");
	const [albumTitle, setAlbumTitle] = useState("");
	const [albumDate, setAlbumDate] = useState("");
	useEffect(() => {
		apiFetch("/api/albums")
			.then((res) => (res.ok ? res.json() : []))
			.then((albums: { id: string; publicId: string; title: string; eventDate: string | null }[]) => {
				const album = albums.find((a) => a.id === albumId);
				setAlbumDate(album?.eventDate ?? "");
				setPublicId(album?.publicId ?? "");
				setAlbumTitle(album?.title ?? "");
			});
	}, [albumId]);

	const features = useAlbumFeatures(albumId, albumTitle);
	const [view, setView] = useState("photos");
	const [notice, setNotice] = useState("");
	// A tab whose panel is empty shows the photo grid (with any grid inserts for that tab).
	const featurePanel = view === "photos" ? null : features.panel(view);
	const shareUrl = publicId ? guestLink(publicId) : "";

	const handleShareClick = () => {
		setIsShareModalOpen(true);
		setIsCopied(false);
	};

	const handleCopyLink = () => {
		const url = shareUrl;
		navigator.clipboard.writeText(url);
		setIsCopied(true);
		setTimeout(() => setIsCopied(false), 2000);
	};

	const toggleSelection = (photoId: string) => {
		setSelectedPhotoIds((prev) =>
			prev.includes(photoId)
				? prev.filter((id) => id !== photoId)
				: [...prev, photoId],
		);
	};

	const handleDeleteSelected = async () => {
		if (selectedPhotoIds.length === 0) return;
		const count = selectedPhotoIds.length;
		const confirmDelete = window.confirm(tx("photos.confirmDelete", { n: count }));
		if (!confirmDelete) return;

		try {
			for (const id of selectedPhotoIds) {
				await apiFetch(`/api/albums/${albumId}/photos/${id}`, {
					method: "DELETE",
				});
			}
			setPhotos((prev) => prev.filter((p) => !selectedPhotoIds.includes(p.id)));
			setSelectedPhotoIds([]);
			setIsSelectionMode(false);
		} catch (error) {
			console.error("Batch delete failed:", error);
			setNotice(tx("genericError"));
		}
	};

	const handleSelectAll = () => {
		if (selectedPhotoIds.length === photos.length) {
			setSelectedPhotoIds([]);
		} else {
			setSelectedPhotoIds(photos.map((p) => p.id));
		}
	};

	const handleDownloadSelectedZip = async () => {
		const idsToDownload = selectedPhotoIds.length > 0 ? selectedPhotoIds : [];
		if (idsToDownload.length === 0) return;

		setIsDownloadingZip(true);
		try {
			const zip = new JSZip();
			const photosToDownload = photos.filter((p) =>
				idsToDownload.includes(p.id),
			);

			const fetchPromises = photosToDownload.map(async (photo, index) => {
				const blob = await fetchImageAsBlob(photo.viewUrl);
				const ext = blob.type.includes("png") ? "png" : "jpg";
				zip.file(`wedding-${index + 1}.${ext}`, blob);
			});

			await Promise.all(fetchPromises);

			const zipBlob = await zip.generateAsync({ type: "blob" });
			const url = URL.createObjectURL(zipBlob);
			const link = document.createElement("a");
			link.href = url;
			link.download = `wedding-album-${albumId}.zip`;
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(url);
		} catch (error) {
			console.error("Zip download failed:", error);
			setNotice(tx("genericError"));
		} finally {
			setIsDownloadingZip(false);
		}
	};

	const handleTogglePrivacySelected = async (makePublic: boolean) => {
		if (selectedPhotoIds.length === 0) return;

		const message = makePublic ? tx("privacy.public") : tx("privacy.protected");
		const confirmToggle = window.confirm(message);
		if (!confirmToggle) return;

		try {
			for (const id of selectedPhotoIds) {
				await apiFetch(
					`/api/albums/${albumId}/photos/${id}/privacy?makePublic=${makePublic}`,
					{ method: "PUT" },
				);
			}
			setPhotos((prev) =>
				prev.map((p) =>
					selectedPhotoIds.includes(p.id) ? { ...p, isPublic: makePublic } : p,
				),
			);
			setSelectedPhotoIds([]);
			setIsSelectionMode(false);
		} catch (error) {
			console.error("Batch privacy toggle failed:", error);
			setNotice(tx("genericError"));
		}
	};

	const handleTogglePrivacySingle = async () => {
		if (!selectedPhoto) return;
		const newStatus = !selectedPhoto.isPublic;

		try {
			const res = await apiFetch(
				`/api/albums/${albumId}/photos/${selectedPhoto.id}/privacy?makePublic=${newStatus}`,
				{ method: "PUT" },
			);
			if (res.ok) {
				setPhotos((prev) =>
					prev.map((p) =>
						p.id === selectedPhoto.id ? { ...p, isPublic: newStatus } : p,
					),
				);
				setSelectedPhoto({ ...selectedPhoto, isPublic: newStatus });
			}
		} catch (error) {
			console.error("Privacy toggle failed:", error);
		}
	};

	const handleDeleteAlbum = async () => {
		const confirmDelete = window.confirm(tx("photos.confirmDeleteAlbum"));
		if (!confirmDelete) return;

		try {
			const res = await apiFetch(`/api/albums/${albumId}`, {
				method: "DELETE",
			});
			if (res.ok) {
				router.push("/dashboard");
			} else {
				setNotice(tx("genericError"));
			}
		} catch (error) {
			console.error("Delete album failed:", error);
		}
	};

	const handleDownload = async () => {
		if (!selectedPhoto) return;
		try {
			await downloadImage(selectedPhoto.viewUrl, `wedding-${selectedPhoto.id}.jpg`);
		} catch (error) {
			console.error("Single photo download failed:", error);
			setNotice(tx("genericError"));
		}
	};

	const handleDeleteSingle = async () => {
		if (!selectedPhoto) return;
		const confirmDelete = window.confirm(tx("photos.confirmDeleteOne"));
		if (!confirmDelete) return;

		try {
			const res = await apiFetch(
				`/api/albums/${albumId}/photos/${selectedPhoto.id}`,
				{ method: "DELETE" },
			);
			if (res.ok) {
				setPhotos((prev) => prev.filter((p) => p.id !== selectedPhoto.id));
				setSelectedPhoto(null);
			} else {
				setNotice(tx("genericError"));
			}
		} catch (error) {
			console.error("Delete failed:", error);
		}
	};

	if (isAuthLoading || !isAuthenticated || isLoading) return <Loading />;

	const closePhoto = () => {
		setSelectedPhoto(null);
		setImageDims({ width: 1, height: 1 });
		setShowBoxes(false);
	};

	return (
		<AdminPage>
			<PageHead
				back
				meta={formatDate(albumDate) || tx("meta")}
				title={<span dir="auto">{albumTitle || "…"}</span>}
				actions={
					<button onClick={handleShareClick} className={btnInk}>
						{tx("photos.share")}
					</button>
				}
			/>
			<AlbumNav albumId={albumId} current="photos" />

			{notice && (
				<div role="alert" className="mb-8 flex items-start justify-between gap-4 border-s-2 border-red-700 bg-[#faf8f3] px-4 py-3 text-red-800">
					<p>{notice}</p>
					<button onClick={() => setNotice("")} aria-label={tx("photo.close")} className="p-1">
						<X className="w-4 h-4" />
					</button>
				</div>
			)}

			{/* views: photos, plus whatever the build adds (stories, blessings...) */}
			{features.tabs.length > 0 && (
				<div role="tablist" aria-label={tx("photos.title")} className="flex gap-7 overflow-x-auto mb-8">
					{[{ key: "photos", label: tx("photos.tabPhotos") }, ...features.tabs].map((tab) => (
						<button
							key={tab.key}
							role="tab"
							aria-selected={view === tab.key}
							onClick={() => setView(tab.key)}
							className={`shrink-0 pb-2 border-b text-base transition-colors ${view === tab.key ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-900"}`}
						>
							{tab.label}
						</button>
					))}
				</div>
			)}

			{featurePanel ? (
				featurePanel
			) : (
				<>
					{/* toolbar */}
					<div className="sticky top-14 z-20 -mx-6 sm:-mx-10 px-6 sm:px-10 py-3 mb-6 bg-zinc-50/95 border-b border-zinc-300 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
						{isSelectionMode ? (
							<>
								<p className="meta text-zinc-700">{tx("photos.selected", { n: selectedPhotoIds.length })}</p>
								<div className="flex flex-wrap items-center gap-x-5">
									<button onClick={handleSelectAll} className={linkQuiet}>{tx("photos.selectAll")}</button>
									<button onClick={() => handleTogglePrivacySelected(true)} disabled={selectedPhotoIds.length === 0} className={linkQuiet}>
										{tx("photos.makePublic")}
									</button>
									<button onClick={() => handleTogglePrivacySelected(false)} disabled={selectedPhotoIds.length === 0} className={linkQuiet}>
										{tx("photos.makeProtected")}
									</button>
									<button onClick={handleDownloadSelectedZip} disabled={selectedPhotoIds.length === 0 || isDownloadingZip} className={linkQuiet}>
										{isDownloadingZip ? <Loader2 className="w-4 h-4 animate-spin" /> : tx("photos.download")}
									</button>
									<button onClick={handleDeleteSelected} disabled={selectedPhotoIds.length === 0} className={`${linkQuiet} text-red-700 hover:text-red-800`}>
										{tx("photos.delete")}
									</button>
									<button
										onClick={() => {
											setIsSelectionMode(false);
											setSelectedPhotoIds([]);
										}}
										className={btnLine}
									>
										{tx("photos.done")}
									</button>
								</div>
							</>
						) : (
							<>
								<p className="meta text-zinc-600">{tx("photos.count", { n: photos.length })}</p>
								<div className="flex flex-wrap items-center gap-x-5">
									<Link href={`/dashboard/albums/${albumId}#add`} className={linkQuiet}>{tx("nav.add")}</Link>
									<button onClick={() => setIsSelectionMode(true)} disabled={photos.length === 0} className={linkQuiet}>
										{tx("photos.select")}
									</button>
								</div>
							</>
						)}
					</div>

					{photos.length === 0 ? (
						<div className="py-20">
							<p className="text-lg text-zinc-600">{tx("photos.empty")}</p>
							<Link href={`/dashboard/albums/${albumId}`} className={`${btnInk} mt-6`}>{tx("nav.add")}</Link>
						</div>
					) : (
						<ul className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-5">
							{photos.map((photo, index) => {
								const selected = selectedPhotoIds.includes(photo.id);
								return [
									<Fragment key={`insert-${index}`}>{features.gridInsert(view, index)}</Fragment>,
									<li key={photo.id}>
										<button
											type="button"
											onClick={() => (isSelectionMode ? toggleSelection(photo.id) : setSelectedPhoto(photo))}
											aria-pressed={isSelectionMode ? selected : undefined}
											className={`group relative block w-full aspect-square overflow-hidden bg-[#eee9e1] ${selected ? "crop" : ""}`}
										>
											{/* eslint-disable-next-line @next/next/no-img-element */}
											<img
												src={photo.thumbUrl || photo.viewUrl}
												alt=""
												loading="lazy"
												className={`h-full w-full object-cover transition duration-500 ${selected ? "scale-[0.92]" : "group-hover:scale-[1.03]"}`}
											/>
											{isSelectionMode && (
												<span
													aria-hidden
													className={`absolute top-2 start-2 flex h-6 w-6 items-center justify-center border ${selected ? "bg-zinc-900 border-zinc-900" : "bg-zinc-50/80 border-zinc-50"}`}
												>
													{selected && <Check className="h-4 w-4 text-zinc-50" />}
												</span>
											)}
										</button>
										<p className="mt-1.5 flex items-center justify-between gap-2 text-xs text-zinc-500">
											<span>
												{!photo.processed && !photo.isPublic
													? tx("photos.scanning")
													: photo.faceCount > 0
														? tx("photos.faces", { n: photo.faceCount })
														: ""}
											</span>
											{!photo.isPublic && (
												<span className="inline-flex items-center gap-1" title={tx("photos.protected")}>
													<Lock className="h-3 w-3" aria-label={tx("photos.protected")} />
												</span>
											)}
										</p>
									</li>,
								];
							})}
						</ul>
					)}

					<div className="mt-20 border-t border-zinc-300 pt-6">
						<button onClick={handleDeleteAlbum} className={`${linkQuiet} text-red-700 hover:text-red-800`}>
							{tx("photos.deleteAlbum")}
						</button>
					</div>
				</>
			)}

			{isShareModalOpen && (
				<div
					role="dialog"
					aria-modal="true"
					aria-labelledby="share-title"
					className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-zinc-950/55 p-3 sm:p-6"
					onClick={() => setIsShareModalOpen(false)}
				>
					<div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-[#faf8f3] p-7">
						<div className="flex items-start justify-between gap-4">
							<h2 id="share-title" className="text-3xl text-zinc-900" style={{ fontFamily: "var(--font-display)" }}>
								{tx("share.title")}
							</h2>
							<button onClick={() => setIsShareModalOpen(false)} aria-label={tx("photo.close")} className="p-2 -m-2 text-zinc-500 hover:text-zinc-900">
								<X className="w-5 h-5" />
							</button>
						</div>
						<p className="mt-2 text-zinc-600">{tx("share.body")}</p>
						<div className="crop mt-6 mx-auto w-fit bg-white p-4">
							<QRCodeSVG value={shareUrl} size={200} level="M" marginSize={0} fgColor="#191917" bgColor="#ffffff" />
						</div>
						<p dir="ltr" className="mt-6 break-all text-center text-sm text-zinc-700">{shareUrl.replace(/^https?:\/\//, "")}</p>
						<button onClick={handleCopyLink} className={`${btnInk} mt-4 w-full`}>
							{isCopied ? tx("settings.copied") : tx("settings.copy")}
						</button>
					</div>
				</div>
			)}

			{selectedPhoto && (
				<div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex flex-col bg-zinc-950" onClick={closePhoto}>
					<div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-zinc-50" onClick={(e) => e.stopPropagation()}>
						<p className="meta text-zinc-400">{tx("photos.faces", { n: selectedPhoto.faceCount })}</p>
						<div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
							<button onClick={handleTogglePrivacySingle} className="min-h-10 text-zinc-100 underline decoration-zinc-600 underline-offset-[6px] hover:decoration-zinc-100">
								{selectedPhoto.isPublic ? tx("photo.public") : tx("photo.protected")}
							</button>
							<button onClick={() => setShowBoxes(!showBoxes)} className="min-h-10 text-zinc-300 hover:text-zinc-50">
								{showBoxes ? tx("photo.hideFaces") : tx("photo.showFaces")}
							</button>
							<button onClick={handleDownload} className="min-h-10 text-zinc-300 hover:text-zinc-50">{tx("photos.download")}</button>
							<button onClick={handleDeleteSingle} className="min-h-10 text-red-300 hover:text-red-200">{tx("photos.delete")}</button>
							<button onClick={closePhoto} aria-label={tx("photo.close")} className="p-2 text-zinc-300 hover:text-zinc-50">
								<X className="w-5 h-5" />
							</button>
						</div>
					</div>
					<div className="relative flex-1 min-h-0 flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
						<div className="relative inline-block max-h-full">
							{/* eslint-disable-next-line @next/next/no-img-element */}
							<img
								src={selectedPhoto.previewUrl || selectedPhoto.viewUrl}
								alt=""
								className="block max-h-[calc(100svh-7rem)] max-w-full w-auto h-auto"
								onLoad={(e) => setImageDims({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
							/>
							{showBoxes &&
								selectedPhoto.faceBoxes?.map((boxStr, idx) => {
									const box = JSON.parse(boxStr);
									return (
										<div
											key={idx}
											className="crop crop-light absolute"
											style={{
												left: `${(box.x / imageDims.width) * 100}%`,
												top: `${(box.y / imageDims.height) * 100}%`,
												width: `${(box.w / imageDims.width) * 100}%`,
												height: `${(box.h / imageDims.height) * 100}%`,
											}}
										/>
									);
								})}
						</div>
					</div>
				</div>
			)}
		</AdminPage>
	);
}
