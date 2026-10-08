"use client";

import { useState, useRef, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Turnstile } from "@marsidev/react-turnstile";
import { useRequireAuth } from "@/lib/useRequireAuth";
import { CheckCircle2, AlertCircle, Loader2, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import AlbumSettings, { type Album } from "@/components/AlbumSettings";
import { useAlbumFeatures } from "@/features";
import { useAdminText } from "@/lib/i18n/admin";
import { AdminPage, AlbumNav, Loading, PageHead, Section, btnInk, btnLine, field, formatDate, linkQuiet } from "@/components/admin/Kit";

function AlbumFeatureSettings({ albumId }: { albumId: string }) {
	return <>{useAlbumFeatures(albumId, "").settings}</>;
}

interface UploadPhoto {
	id: string;
	file: File;
	previewUrl: string;
	isPublic: boolean;
	status: "idle" | "uploading" | "success" | "error";
}

interface ImportStatus {
	state: "NONE" | "RUNNING" | "COMPLETED" | "FAILED";
	total?: number;
	imported?: number;
	duplicates?: number;
	failed?: number;
	failures?: { file: string; error: string }[];
	error?: string;
}

export default function AlbumUploadPage() {
	const { isLoading: isAuthLoading, isAuthenticated } = useRequireAuth();
	const params = useParams<{ id: string }>();
	const router = useRouter();
	const albumId = params?.id || "unknown-album";
	const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
	const isTurnstileEnabled = Boolean(turnstileSiteKey);

	const [photos, setPhotos] = useState<UploadPhoto[]>([]);
	const [isUploading, setIsUploading] = useState(false);
	const [fullScreenImage, setFullScreenImage] = useState<string | null>(null);
	const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
	const [turnstileWidgetKey, setTurnstileWidgetKey] = useState(0);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const [importPath, setImportPath] = useState("/import");
	const [importStatus, setImportStatus] = useState<ImportStatus | null>(null);
	const [isImportPolling, setIsImportPolling] = useState(false);
	const tx = useAdminText();
	const [notice, setNotice] = useState("");
	const [album, setAlbum] = useState<Album | null>(null);

	useEffect(() => {
		if (!isAuthenticated) return;
		apiFetch("/api/albums")
			.then((res) => (res.ok ? res.json() : []))
			.then((albums: Album[]) => setAlbum(albums.find((a) => a.id === albumId) ?? null))
			.catch(() => setAlbum(null));
	}, [albumId, isAuthenticated]);

	useEffect(() => {
		if (!albumId || albumId === "unknown-album" || !isAuthenticated) return;
		let cancelled = false;

		const poll = async () => {
			try {
				const res = await apiFetch(`/api/albums/${albumId}/import/status`);
				if (!res.ok || cancelled) return;
				const status: ImportStatus = await res.json();
				setImportStatus(status.state === "NONE" ? null : status);
				if (status.state === "RUNNING") setIsImportPolling(true);
				else setIsImportPolling(false);
			} catch {
				/* ignore */
			}
		};

		poll();
		const interval = setInterval(() => {
			if (isImportPolling) poll();
		}, 2000);
		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, [albumId, isAuthenticated, isImportPolling]);

	const handleStartImport = async () => {
		try {
			const res = await apiFetch(`/api/albums/${albumId}/import`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ path: importPath }),
			});
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				setNotice(data.error || tx("genericError"));
				return;
			}
			setImportStatus({ state: "RUNNING" });
			setIsImportPolling(true);
		} catch {
			setNotice(tx("offline"));
		}
	};

	if (isAuthLoading || !isAuthenticated) return <Loading />;

	const MAX_PHOTO_MB = Number(process.env.NEXT_PUBLIC_MAX_PHOTO_MB || "30");
	const MAX_PHOTO_SIZE = MAX_PHOTO_MB * 1024 * 1024;

	const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
		if (!e.target.files) return;

		const selected = Array.from(e.target.files);
		const oversized = selected.filter((f) => f.size > MAX_PHOTO_SIZE);
		if (oversized.length > 0) {
			setNotice(tx("add.tooBig", { n: oversized.length, max: MAX_PHOTO_MB }));
		}

		const newFiles = selected
			.filter((f) => f.size <= MAX_PHOTO_SIZE)
			.map((file) => ({
				id: Math.random().toString(36).substring(7),
				file,
				previewUrl: URL.createObjectURL(file),
				isPublic: false,
				status: "idle" as const,
			}));

		setPhotos((prev) => [...prev, ...newFiles]);
		if (fileInputRef.current) fileInputRef.current.value = "";
	};

	const togglePrivacy = (id: string) => {
		setPhotos((prev) =>
			prev.map((p) => (p.id === id ? { ...p, isPublic: !p.isPublic } : p)),
		);
	};

	const setAllPrivacy = (makePublic: boolean) => {
		setPhotos((prev) => prev.map((p) => ({ ...p, isPublic: makePublic })));
	};

	const removePhoto = (id: string) => {
		setPhotos((prev) => prev.filter((p) => p.id !== id));
	};

	const resetTurnstile = () => {
		setTurnstileToken(null);
		setTurnstileWidgetKey((prev) => prev + 1);
	};

	const handleUploadToS3 = async () => {
		const pendingPhotos = photos.filter(
			(p) => p.status === "idle" || p.status === "error",
		);
		if (pendingPhotos.length === 0) return;
		if (isTurnstileEnabled && !turnstileToken) {
			setNotice(tx("add.botCheck"));
			return;
		}

		setIsUploading(true);
		let turnstileWasUsed = false;
		let didRedirectToAlbum = false;

		try {
			const fileSizes = pendingPhotos.map((p) => p.file.size);
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
			};
			if (turnstileToken) {
				headers["X-Turnstile-Token"] = turnstileToken;
			}

			const response = await apiFetch(`/api/albums/${albumId}/upload-urls`, {
				method: "POST",
				headers,
				body: JSON.stringify({ fileSizes }),
			});
			turnstileWasUsed = isTurnstileEnabled && Boolean(turnstileToken);

			if (!response.ok) {
				const errorMsg = await response.text();
				if (response.status === 405) {
					throw new Error(
						"Upload endpoint rejected the HTTP method (405). Check backend deployment and NEXT_PUBLIC_API_URL format.",
					);
				}
				throw new Error(
					errorMsg || "Unable to prepare your upload. Please try again.",
				);
			}

			const uploadTargets: { key: string; uploadUrl: string }[] =
				await response.json();
			const uploadPromises = pendingPhotos.map(async (photo, index) => {
				setPhotos((prev) =>
					prev.map((p) =>
						p.id === photo.id ? { ...p, status: "uploading" } : p,
					),
				);

				try {
					const target = uploadTargets[index];
					if (!target) throw new Error("No upload slot (quota reached)");

					const uploadRes = await apiFetch(target.uploadUrl, {
						method: "PUT",
						body: photo.file,
						headers: {
							"Content-Type": photo.file.type || "image/jpeg",
						},
					});

					if (uploadRes.ok) {
						setPhotos((prev) =>
							prev.map((p) =>
								p.id === photo.id ? { ...p, status: "success" } : p,
							),
						);

						return { ...photo, status: "success", actualS3Key: target.key };
					} else {
						throw new Error("Upload failed");
					}
				} catch {
					setPhotos((prev) =>
						prev.map((p) =>
							p.id === photo.id ? { ...p, status: "error" } : p,
						),
					);
					return null;
				}
			});

			const results = await Promise.all(uploadPromises);
			const successfulPhotos = results.filter((p) => p !== null);

			if (successfulPhotos.length > 0) {
				const payload = {
					photos: successfulPhotos.map((p) => ({
						storageUrl: p.actualS3Key,
						isPublic: p.isPublic,
						public: p.isPublic,
					})),
				};

				const dbResponse = await apiFetch(`/api/albums/${albumId}/photos`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload),
				});

				if (!dbResponse.ok) {
					const errorMsg = await dbResponse.text();
					console.error("AWS Upload succeeded, but Database save failed.");
					setNotice(errorMsg || tx("add.saveError"));
				} else {
					console.log("Successfully saved to database!");
					setPhotos([]);
					didRedirectToAlbum = true;
					router.push(`/dashboard/albums/${albumId}/view`);
					return;
				}
			}
		} catch (error) {
			console.error("Upload process failed:", error);
			const message =
				error instanceof Error && error.message
					? error.message
					: "Something went wrong while uploading. Please try again.";
			setNotice(message || tx("add.uploadError"));
		} finally {
			if (turnstileWasUsed && !didRedirectToAlbum) {
				resetTurnstile();
			}
			setIsUploading(false);
		}
	};

	const pending = photos.filter((p) => p.status === "idle" || p.status === "error").length;

	return (
		<AdminPage>
			<PageHead
				back
				meta={formatDate(album?.eventDate) || tx("meta")}
				title={<span dir="auto">{album?.title ?? "…"}</span>}
			/>
			<AlbumNav albumId={albumId} current="page" />

			{notice && (
				<div role="alert" className="mb-8 flex items-start justify-between gap-4 border-s-2 border-red-700 bg-[#fbfaf7] px-4 py-3 text-red-800">
					<p>{notice}</p>
					<button onClick={() => setNotice("")} aria-label={tx("photo.close")} className="p-1 text-red-800/70 hover:text-red-900">
						<X className="w-4 h-4" />
					</button>
				</div>
			)}

			{album && <AlbumSettings album={album} onChange={setAlbum} />}

			<AlbumFeatureSettings albumId={albumId} />

			<Section
				id="add"
				title={tx("add.title")}
				body={tx("add.body")}
				aside={
					photos.length > 0 && (
						<div className="flex flex-wrap gap-x-5">
							<button onClick={() => setAllPrivacy(true)} className={linkQuiet}>{tx("add.allPublic")}</button>
							<button onClick={() => setAllPrivacy(false)} className={linkQuiet}>{tx("add.allProtected")}</button>
						</div>
					)
				}
			>
				<input type="file" multiple accept="image/*" ref={fileInputRef} onChange={handleFileSelect} className="hidden" />
				<div className="flex flex-wrap items-center gap-3">
					<button onClick={() => fileInputRef.current?.click()} className={btnLine}>
						{tx("add.select")}
					</button>
					{photos.length > 0 && (
						<button
							onClick={handleUploadToS3}
							disabled={pending === 0 || isUploading || (isTurnstileEnabled && !turnstileToken)}
							className={btnInk}
						>
							{isUploading ? (
								<>
									<Loader2 className="w-4 h-4 animate-spin" /> {tx("add.uploading")}
								</>
							) : (
								tx("add.upload", { n: pending })
							)}
						</button>
					)}
					{isTurnstileEnabled && photos.length > 0 && (
						<Turnstile
							key={turnstileWidgetKey}
							siteKey={turnstileSiteKey!}
							onSuccess={(token) => setTurnstileToken(token)}
							onExpire={() => setTurnstileToken(null)}
							onError={() => setTurnstileToken(null)}
						/>
					)}
				</div>

				{photos.length === 0 ? (
					<p className="mt-6 text-zinc-500">{tx("add.empty")}</p>
				) : (
					<ul className="mt-8 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
						{photos.map((photo) => (
							<li key={photo.id}>
								<button type="button" onClick={() => setFullScreenImage(photo.previewUrl)} className="relative block w-full aspect-square overflow-hidden bg-[#ebe3d6]">
									{/* eslint-disable-next-line @next/next/no-img-element */}
									<img src={photo.previewUrl} alt="" className="h-full w-full object-cover" />
									{photo.status === "uploading" && (
										<span className="absolute inset-0 flex items-center justify-center bg-zinc-950/40">
											<Loader2 className="w-6 h-6 animate-spin text-zinc-50" />
										</span>
									)}
									{photo.status === "success" && <CheckCircle2 className="absolute top-2 end-2 w-6 h-6 text-zinc-50 drop-shadow" />}
									{photo.status === "error" && <AlertCircle className="absolute top-2 end-2 w-6 h-6 text-red-500 drop-shadow" />}
								</button>
								<div className="mt-2 flex items-baseline justify-between gap-2">
									<button onClick={() => togglePrivacy(photo.id)} className="text-start text-sm text-zinc-700 hover:text-zinc-900">
										{photo.isPublic ? tx("add.public") : tx("add.protected")}
									</button>
									<button onClick={() => removePhoto(photo.id)} className="text-sm text-zinc-400 hover:text-red-700">
										{tx("add.remove")}
									</button>
								</div>
							</li>
						))}
					</ul>
				)}

				<details className="mt-10 max-w-2xl">
					<summary className="cursor-pointer text-zinc-700 underline decoration-zinc-300 underline-offset-[6px]">{tx("privacy.title")}</summary>
					<p className="mt-3 text-zinc-600">{tx("privacy.public")}</p>
					<p className="mt-2 text-zinc-600">{tx("privacy.protected")}</p>
				</details>
			</Section>

			<Section title={tx("import.title")} body={tx("import.body")}>
				<div className="flex flex-wrap items-end gap-3 max-w-xl">
					<div className="flex-1 min-w-48">
						<label htmlFor="import-path" className="block text-sm text-zinc-600 mb-1.5">{tx("import.folder")}</label>
						<input id="import-path" dir="ltr" value={importPath} onChange={(e) => setImportPath(e.target.value)} placeholder="/import" className={field} />
					</div>
					<button onClick={handleStartImport} disabled={importStatus?.state === "RUNNING"} className={btnLine}>
						{importStatus?.state === "RUNNING" ? (
							<>
								<Loader2 className="w-4 h-4 animate-spin" /> {tx("import.running")}
							</>
						) : (
							tx("import.start")
						)}
					</button>
				</div>
				{importStatus && importStatus.state !== "NONE" && (
					<div className="mt-5 space-y-2">
						<p className="meta text-zinc-600">
							{tx("import.progress", {
								found: importStatus.total ?? 0,
								imported: importStatus.imported ?? 0,
								dup: importStatus.duplicates ?? 0,
								failed: importStatus.failed ?? 0,
							})}
						</p>
						{importStatus.state === "COMPLETED" && <p className="text-zinc-700">{tx("import.done")}</p>}
						{importStatus.state === "FAILED" && (
							<p className="text-red-700">{tx("import.failed", { error: importStatus.error || "" })}</p>
						)}
						{(importStatus.failures?.length ?? 0) > 0 && (
							<details className="text-sm text-zinc-500">
								<summary className="cursor-pointer">{tx("import.failedFiles")}</summary>
								<ul className="mt-1 space-y-0.5 font-mono text-xs" dir="ltr">
									{importStatus.failures!.map((f, i) => (
										<li key={i}>
											{f.file}: {f.error}
										</li>
									))}
								</ul>
							</details>
						)}
					</div>
				)}
			</Section>

			{fullScreenImage && (
				<div
					role="dialog"
					aria-modal="true"
					className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/90 p-6"
					onClick={() => setFullScreenImage(null)}
				>
					<button onClick={() => setFullScreenImage(null)} aria-label={tx("photo.close")} className="absolute top-4 end-4 p-2 text-zinc-50/80 hover:text-zinc-50">
						<X className="w-6 h-6" />
					</button>
					{/* eslint-disable-next-line @next/next/no-img-element */}
					<img src={fullScreenImage} alt="" className="max-h-full max-w-full object-contain" />
				</div>
			)}
		</AdminPage>
	);
}
