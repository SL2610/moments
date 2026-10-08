"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
	Camera,
	Check,
	CheckSquare,
	ChevronLeft,
	ChevronRight,
	Columns3,
	Download,
	Images,
	LayoutGrid,
	Loader2,
	Share2,
	MoreVertical,
	Plus,
	Tag,
	UserSearch,
	Video,
	X,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import JSZip from "jszip";
import { fetchImageAsBlob, downloadImage } from "@/lib/download";
import {
	GuestSession,
	WeddingInfo,
	getGuestSession,
	joinWedding,
	clearGuestSession,
	guestFetch,
	fetchWeddingInfo,
	setActiveWedding,
	setGuestName,
} from "@/lib/guest";
import { useI18n, setLocale } from "@/lib/i18n/I18nProvider";
import { useGuestFeatures } from "@/features";
import type { TranslationKey } from "@/lib/i18n/locale";

interface PhotoTag {
	guestId: string;
	name: string;
}

interface Photo {
	id: string;
	viewUrl: string;
	previewUrl: string;
	thumbUrl: string;
	processed: boolean;
	tags: PhotoTag[];
}

interface Person {
	id: string;
	name: string;
	photoCount: number;
}

const SHOW_CREDIT = process.env.NEXT_PUBLIC_SHOW_CREDIT !== "false";

// Small "Made with WED" line; self-hosters can hide it with SHOW_CREDIT=false.
function Credit() {
	if (!SHOW_CREDIT) return null;
	return (
		<p className="meta text-zinc-500 shrink-0" dir="ltr">
			<a href="https://sagi-lior-wedding.com" className="hover:text-zinc-900">
				Made with WED
			</a>
		</p>
	);
}

const MAX_PHOTO_MB = Number(process.env.NEXT_PUBLIC_MAX_PHOTO_MB || "30");

// The couple's names as a running head, the date as a caption beneath.
function Wordmark({ name, date }: { name: string; date: string; size?: "sm" | "lg" }) {
	return (
		<div className="text-start min-w-0">
			<p className="truncate text-xl sm:text-2xl leading-none text-zinc-900" style={{ fontFamily: "var(--font-display)" }}>
				{name}
			</p>
			{date && (
				<p className="meta text-zinc-500 mt-1.5" dir="ltr">
					{date.replace(/[./-]/g, " · ")}
				</p>
			)}
		</div>
	);
}

export default function WeddingPage() {
	const { t, locale, dir } = useI18n();
	const { id: publicId } = useParams<{ id: string }>();
	const [session, setSession] = useState<GuestSession | null>(null);
	const [sessionChecked, setSessionChecked] = useState(false);
	// null while loading; false when the link matches no wedding
	const [info, setInfo] = useState<WeddingInfo | false | null>(null);

	// entry: the link is the key; a password only if the couple set one
	const [password, setPassword] = useState("");
	const [joinError, setJoinError] = useState("");
	const [isJoining, setIsJoining] = useState(false);

	// a name is asked only before the first upload or tag
	const [namePrompt, setNamePrompt] = useState<(() => void) | null>(null);
	const [nameInput, setNameInput] = useState("");
	const [isSavingName, setIsSavingName] = useState(false);

	// gallery
	const [photos, setPhotos] = useState<Photo[]>([]);
	const [total, setTotal] = useState(0);
	const [page, setPage] = useState(0);
	const [isLoading, setIsLoading] = useState(false);
	const [people, setPeople] = useState<Person[]>([]);
	const [personFilter, setPersonFilter] = useState<string | null>(null);
	// the couple's official album vs photos added by guests
	const [sourceView, setSourceView] = useState<"official" | "guests">("official");
	const [sourceTotals, setSourceTotals] = useState({ official: 0, guests: 0 });
	const [galleryLayout, setGalleryLayout] = useState<"masonry" | "grid">(() =>
		typeof window !== "undefined" && localStorage.getItem("wedding.galleryLayout") === "grid"
			? "grid"
			: "masonry",
	);
	const chooseGalleryLayout = (layout: "masonry" | "grid") => {
		setGalleryLayout(layout);
		localStorage.setItem("wedding.galleryLayout", layout);
	};
	// tracked in state (not via classList mutation) so the fade-in survives
	// re-renders, which otherwise reset className back to its JSX value
	const [loadedPhotoIds, setLoadedPhotoIds] = useState<Set<string>>(new Set());
	const markPhotoLoaded = (photoId: string) =>
		setLoadedPhotoIds((prev) => (prev.has(photoId) ? prev : new Set(prev).add(photoId)));

	// batch selection (download / self-tag many photos at once)
	const [isSelecting, setIsSelecting] = useState(false);
	const [selectedIds, setSelectedIds] = useState<string[]>([]);
	const [isBatchWorking, setIsBatchWorking] = useState(false);

	// viewer
	const [viewerIndex, setViewerIndex] = useState<number | null>(null);
	const touchStartX = useRef<number | null>(null);
	const loadMoreRef = useRef<HTMLDivElement>(null);
	const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const longPressFired = useRef(false);
	const longPressStart = useRef<{ x: number; y: number } | null>(null);
	const [isTagging, setIsTagging] = useState(false);

	// selfie search
	const [isSearchOpen, setIsSearchOpen] = useState(false);
	const [selfie, setSelfie] = useState<File | null>(null);
	const [selfiePreview, setSelfiePreview] = useState("");
	useEffect(() => {
		if (!selfie) return setSelfiePreview("");
		const url = URL.createObjectURL(selfie);
		setSelfiePreview(url);
		return () => URL.revokeObjectURL(url);
	}, [selfie]);
	const [isSearching, setIsSearching] = useState(false);
	const [searchError, setSearchError] = useState("");
	const [matches, setMatches] = useState<Photo[] | null>(null);
	const [isClaiming, setIsClaiming] = useState(false);
	const [searchSessionId, setSearchSessionId] = useState<string | null>(null);
	const [needsSecondSelfie, setNeedsSecondSelfie] = useState(false);
	const [isMobile, setIsMobile] = useState(true);
	const [isCameraOpen, setIsCameraOpen] = useState(false);
	const videoRef = useRef<HTMLVideoElement>(null);
	const streamRef = useRef<MediaStream | null>(null);

	// upload
	const uploadInputRef = useRef<HTMLInputElement>(null);
	const [uploadProgress, setUploadProgress] = useState<string | null>(null);
	const [uploadNotice, setUploadNotice] = useState("");
	const [isZipping, setIsZipping] = useState(false);

	useEffect(() => {
		setActiveWedding(publicId);
		setSession(getGuestSession());
		setSessionChecked(true);
		fetchWeddingInfo(publicId).then((data) => setInfo(data ?? false));
		const mobileRegex =
			/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
		setIsMobile(mobileRegex.test(navigator.userAgent));
	}, [publicId]);

	const handleAuthFailure = useCallback(() => {
		clearGuestSession();
		setSession(null);
		setPhotos([]);
	}, []);

	const loadPhotos = useCallback(
		async (
			pageToLoad: number,
			person: string | null,
			append: boolean,
			source?: "official" | "guests",
		) => {
			setIsLoading(true);
			try {
				const params = new URLSearchParams({ page: String(pageToLoad) });
				if (person) params.set("person", person);
				else params.set("source", source ?? "official");
				const res = await guestFetch(`/api/wedding/photos?${params}`);
				if (res.status === 401 || res.status === 403) {
					handleAuthFailure();
					return;
				}
				if (!res.ok) return;
				const data = await res.json();
				setTotal(data.total);
				if (data.officialTotal !== undefined) {
					setSourceTotals({ official: data.officialTotal, guests: data.guestTotal });
				}
				setPage(pageToLoad);
				setPhotos((prev) =>
					append ? [...prev, ...data.photos] : data.photos,
				);
			} catch {
				/* network hiccup: keep whatever is shown */
			} finally {
				setIsLoading(false);
			}
		},
		[handleAuthFailure],
	);

	// keyboard navigation in the fullscreen viewer
	useEffect(() => {
		if (viewerIndex === null) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setViewerIndex(null);
			else if (e.key === "ArrowRight" && viewerIndex < photos.length - 1)
				setViewerIndex(viewerIndex + 1);
			else if (e.key === "ArrowLeft" && viewerIndex > 0)
				setViewerIndex(viewerIndex - 1);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [viewerIndex, photos.length]);

	// lock background scroll while a fullscreen overlay is open, so the
	// mobile keyboard opening (e.g. the tag input) doesn't scroll/shift
	// the page behind the fixed overlay
	useEffect(() => {
		if (viewerIndex === null && !isSearchOpen) return;
		const { overflow } = document.body.style;
		document.body.style.overflow = "hidden";
		return () => {
			document.body.style.overflow = overflow;
		};
	}, [viewerIndex, isSearchOpen]);

	// preload the neighboring previews for instant next/prev
	useEffect(() => {
		if (viewerIndex === null) return;
		for (const i of [viewerIndex - 1, viewerIndex + 1]) {
			const photo = photos[i];
			if (photo) {
				const img = new window.Image();
				img.src = photo.previewUrl || photo.viewUrl;
			}
		}
	}, [viewerIndex, photos]);

	// infinite scroll (replaces the load-more button)
	useEffect(() => {
		const el = loadMoreRef.current;
		if (!el) return;
		const io = new IntersectionObserver(
			([entry]) => {
				if (entry.isIntersecting && !isLoading && !personFilter && photos.length < total) {
					loadPhotos(page + 1, null, true, sourceView);
				}
			},
			{ rootMargin: "800px" },
		);
		io.observe(el);
		return () => io.disconnect();
	});

	const loadPeople = useCallback(async () => {
		try {
			const res = await guestFetch("/api/wedding/people");
			if (res.ok) setPeople(await res.json());
		} catch {
			/* ignore */
		}
	}, []);

	useEffect(() => {
		if (!session) return;
		loadPhotos(0, personFilter, false, sourceView);
		loadPeople();
	}, [session, personFilter, sourceView, loadPhotos, loadPeople]);

	/** Joins anonymously (plus the couple's password, if set), then goes on to the selfie or the album. */
	const handleStart = async (next: "selfie" | "album" | (() => void)) => {
		setJoinError("");
		let current = session;
		if (!current) {
			setIsJoining(true);
			const { session: joined, error } = await joinWedding(password);
			setIsJoining(false);
			if (!joined) {
				setJoinError(
					error === "wrong-password"
						? t("guest.join.errors.wrongPassword")
						: t("guest.join.errors.generic"),
				);
				return;
			}
			current = joined;
			setSession(joined);
		}
		window.scrollTo(0, 0);
		if (next === "selfie") setIsSearchOpen(true);
		if (typeof next === "function") next();
	};

	/** Runs the action once the guest has a display name, asking for one first if needed. */
	const withName = (action: () => void) => {
		if (session?.guest.name) action();
		else setNamePrompt(() => action);
	};

	const saveName = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!nameInput.trim()) return;
		setIsSavingName(true);
		const updated = await setGuestName(nameInput.trim());
		setIsSavingName(false);
		if (!updated) return;
		setSession(updated);
		const action = namePrompt;
		setNamePrompt(null);
		// the new token carries the name; run after state settles
		setTimeout(() => action?.(), 0);
	};

	const shareOnWhatsApp = () => {
		const text = t("guest.selfieSearch.whatsAppText")
			.replace("{name}", info ? info.eventName : "")
			.replace("{url}", window.location.href);
		window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
	};

	// ---------------------------------------------------------------- camera

	const stopCamera = useCallback(() => {
		streamRef.current?.getTracks().forEach((t) => t.stop());
		streamRef.current = null;
		setIsCameraOpen(false);
	}, []);

	useEffect(() => {
		if (isCameraOpen && videoRef.current && streamRef.current) {
			videoRef.current.srcObject = streamRef.current;
		}
	}, [isCameraOpen]);

	useEffect(() => () => stopCamera(), [stopCamera]);

	const startDesktopCamera = async () => {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				video: true,
				audio: false,
			});
			streamRef.current = stream;
			setIsCameraOpen(true);
		} catch {
			setSearchError(t("guest.selfieSearch.cameraError"));
		}
	};

	const takeDesktopPhoto = () => {
		if (!videoRef.current) return;
		const canvas = document.createElement("canvas");
		canvas.width = videoRef.current.videoWidth;
		canvas.height = videoRef.current.videoHeight;
		canvas.getContext("2d")?.drawImage(videoRef.current, 0, 0);
		canvas.toBlob(
			(blob) => {
				if (blob) {
					setSelfie(new File([blob], "selfie.jpg", { type: "image/jpeg" }));
					stopCamera();
				}
			},
			"image/jpeg",
			0.9,
		);
	};

	// ---------------------------------------------------------------- search

	const SEARCH_ERROR_KEYS: Record<string, TranslationKey> = {
		"no-face": "guest.selfieSearch.errors.noFace",
		"multiple-faces": "guest.selfieSearch.errors.multipleFaces",
		"invalid-image": "guest.selfieSearch.errors.invalidImage",
		"invalid-file-type": "guest.selfieSearch.errors.invalidFileType",
		"file-too-large": "guest.selfieSearch.errors.fileTooLarge",
		"rate-limited": "guest.selfieSearch.errors.rateLimited",
		"reindex-required": "guest.selfieSearch.errors.reindexRequired",
		"search-timeout": "guest.selfieSearch.errors.searchTimeout",
	};

	const handleSearch = async () => {
		if (!selfie || !session) return;
		setIsSearching(true);
		setSearchError("");
		setMatches(null);
		try {
			const formData = new FormData();
			formData.append("file", selfie);
			formData.append("album_id", session.albumId);
			// Photos already tagged as this guest boost the identity search.
			formData.append("guest_id", session.guest.id);
			// A previous selfie from this session strengthens the next search.
			if (searchSessionId) formData.append("search_id", searchSessionId);
			const aiRes = await fetch("/api/ai/search", {
				method: "POST",
				body: formData,
			});
			if (!aiRes.ok) {
				const data = await aiRes.json().catch(() => ({}));
				const key = SEARCH_ERROR_KEYS[data?.code as string];
				throw new Error(key ? t(key) : t("guest.selfieSearch.errors.default"));
			}
			const {
				matched_photo_ids: ids,
				search_id: sid,
				needs_second_selfie: needsSecond,
			} = await aiRes.json();
			if (sid) setSearchSessionId(sid);
			setNeedsSecondSelfie(Boolean(needsSecond));
			if (!ids || ids.length === 0) {
				setMatches([]);
				return;
			}
			const detailsRes = await guestFetch(
				`/api/albums/${session.albumId}/guest/search-results`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(ids),
				},
			);
			if (!detailsRes.ok) throw new Error(t("guest.selfieSearch.errors.default"));
			const found: Photo[] = (await detailsRes.json()).map(
				(p: Omit<Photo, "tags">) => ({ ...p, tags: [] }),
			);
			setMatches(found);
		} catch (err) {
			setSearchError(err instanceof Error ? err.message : t("guest.selfieSearch.errors.generic"));
		} finally {
			setIsSearching(false);
		}
	};

	const handleClaim = async () => {
		if (!matches || matches.length === 0 || !session) return;
		setIsClaiming(true);
		try {
			const res = await guestFetch("/api/wedding/tags/claim", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ photoIds: matches.map((p) => p.id) }),
			});
			if (res.ok) {
				closeSearch();
				setPersonFilter(session.guest.id);
				loadPeople();
			}
		} finally {
			setIsClaiming(false);
		}
	};

	const closeSearch = () => {
		setIsSearchOpen(false);
		setSelfie(null);
		setMatches(null);
		setSearchError("");
		setSearchSessionId(null);
		setNeedsSecondSelfie(false);
		stopCamera();
	};

	// ------------------------------------------------------------------ tags

	/** Grid quick action: toggle my own tag on a photo (self-tag by guest id, never by name). */
	const toggleSelfTag = async (photo: Photo) => {
		if (!session) return;
		const mine = photo.tags.find((t) => t.guestId === session.guest.id);
		if (mine) {
			await removeTag(photo.id, session.guest.id);
			return;
		}
		setIsTagging(true);
		try {
			const res = await guestFetch("/api/wedding/tags/claim", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ photoIds: [photo.id] }),
			});
			if (res.ok) {
				const me = { guestId: session.guest.id, name: getGuestSession()?.guest.name ?? "" };
				setPhotos((prev) =>
					prev.map((p) =>
						p.id === photo.id && !p.tags.some((t) => t.guestId === me.guestId)
							? { ...p, tags: [...p.tags, me] }
							: p,
					),
				);
				loadPeople();
			}
		} finally {
			setIsTagging(false);
		}
	};

	const removeTag = async (photoId: string, guestId: string) => {
		const res = await guestFetch(
			`/api/wedding/photos/${photoId}/tags/${guestId}`,
			{ method: "DELETE" },
		);
		if (res.ok) {
			setPhotos((prev) =>
				prev.map((p) =>
					p.id === photoId
						? { ...p, tags: p.tags.filter((t) => t.guestId !== guestId) }
						: p,
				),
			);
			loadPeople();
		}
	};

	// ---------------------------------------------------------------- upload

	// Phone photos are often 5-10 MB; downscaling before upload makes guest
	// uploads roughly 10x faster over the tunnel with no visible quality loss.
	// Photographer originals go through the admin import untouched.
	const compressForUpload = async (file: File): Promise<Blob> => {
		if (file.size < 1_500_000) return file;
		try {
			const bitmap = await createImageBitmap(file, {
				imageOrientation: "from-image",
			});
			const maxEdge = 2560;
			const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
			const canvas = document.createElement("canvas");
			canvas.width = Math.round(bitmap.width * scale);
			canvas.height = Math.round(bitmap.height * scale);
			canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
			bitmap.close();
			const blob = await new Promise<Blob | null>((resolve) =>
				canvas.toBlob(resolve, "image/jpeg", 0.85),
			);
			return blob && blob.size < file.size ? blob : file;
		} catch {
			return file;
		}
	};

	const uploadProgressMessage = (current: number, total: number) =>
		t("guest.gallery.uploadProgress")
			.replace("{current}", String(current))
			.replace("{total}", String(total));

	const handleUploadFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
		if (!e.target.files || e.target.files.length === 0) return;
		const picked = Array.from(e.target.files);
		const files = picked.filter((f) => f.size <= MAX_PHOTO_MB * 1024 * 1024);
		e.target.value = "";
		setUploadNotice("");

		let done = 0;
		let finished = 0;
		const queue = [...files];
		setUploadProgress(uploadProgressMessage(1, files.length));

		const worker = async () => {
			for (;;) {
				const file = queue.shift();
				if (!file) return;
				try {
					const blob = await compressForUpload(file);
					const formData = new FormData();
					if (blob === file) {
						formData.append("file", file);
					} else {
						formData.append("file", blob, file.name.replace(/\.\w+$/, "") + ".jpg");
					}
					const res = await guestFetch("/api/wedding/photos", {
						method: "POST",
						body: formData,
					});
					if (res.ok) done++;
				} catch {
					/* continue with the rest */
				}
				finished++;
				setUploadProgress(
					uploadProgressMessage(Math.min(finished + 1, files.length), files.length),
				);
			}
		};
		// 3 uploads in flight at once
		await Promise.all(Array.from({ length: Math.min(3, files.length) }, worker));

		setUploadProgress(null);
		if (done < picked.length) {
			setUploadNotice(
				t("guest.gallery.uploadFailed")
					.replace("{failed}", String(picked.length - done))
					.replace("{total}", String(picked.length))
					.replace("{max}", String(MAX_PHOTO_MB)),
			);
		}
		if (done > 0) {
			setPersonFilter(null);
			setSourceView("guests");
			loadPhotos(0, null, false, "guests");
		}
	};

	const handleDownloadZip = async (list: Photo[]) => {
		if (list.length === 0) return;
		setIsZipping(true);
		try {
			// Touch devices: share the images themselves so the native sheet can
			// save straight to the photo gallery (ZIP only as fallback / desktop).
			const isTouch = window.matchMedia?.("(hover: none) and (pointer: coarse)").matches;
			if (isTouch && typeof navigator.canShare === "function" && list.length <= 30) {
				try {
					const files = await Promise.all(
						list.map(async (photo, i) => {
							const blob = await fetchImageAsBlob(photo.viewUrl);
							return new File([blob], `wedding-${i + 1}.jpg`, {
								type: blob.type || "image/jpeg",
							});
						}),
					);
					if (navigator.canShare({ files })) {
						await navigator.share({ files });
						return;
					}
				} catch (err) {
					if ((err as DOMException)?.name === "AbortError") return;
					// fall through to the ZIP download
				}
			}
			const zip = new JSZip();
			await Promise.all(
				list.map(async (photo, i) => {
					const blob = await fetchImageAsBlob(photo.viewUrl);
					zip.file(`wedding-${i + 1}.jpg`, blob);
				}),
			);
			const blob = await zip.generateAsync({ type: "blob" });
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = "wedding-photos.zip";
			link.click();
			URL.revokeObjectURL(url);
		} finally {
			setIsZipping(false);
		}
	};

	const toggleSelect = (photoId: string) => {
		setSelectedIds((prev) =>
			prev.includes(photoId)
				? prev.filter((id) => id !== photoId)
				: [...prev, photoId],
		);
	};

	const exitSelection = () => {
		setIsSelecting(false);
		setSelectedIds([]);
	};

	// long-press (hard click) on a photo tile enters selection mode with that photo selected
	const startLongPress = (x: number, y: number, photoId: string) => {
		longPressStart.current = { x, y };
		longPressTimer.current = setTimeout(() => {
			longPressFired.current = true;
			setIsSelecting(true);
			toggleSelect(photoId);
		}, 500);
	};

	const cancelLongPress = () => {
		if (longPressTimer.current) clearTimeout(longPressTimer.current);
		longPressTimer.current = null;
		longPressStart.current = null;
	};

	/** "These are me" on every selected photo. */
	const handleBatchClaim = async () => {
		if (selectedIds.length === 0 || !session) return;
		setIsBatchWorking(true);
		try {
			const res = await guestFetch("/api/wedding/tags/claim", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ photoIds: selectedIds }),
			});
			if (res.ok) {
				const me = { guestId: session.guest.id, name: getGuestSession()?.guest.name ?? "" };
				setPhotos((prev) =>
					prev.map((p) =>
						selectedIds.includes(p.id) &&
						!p.tags.some((t) => t.guestId === me.guestId)
							? { ...p, tags: [...p.tags, me] }
							: p,
					),
				);
				loadPeople();
				exitSelection();
			}
		} finally {
			setIsBatchWorking(false);
		}
	};

	// ---------------------------------------------------------------- render

	const features = useGuestFeatures({
		info: info || null,
		session,
		start: (then) => handleStart(then),
		withName,
		matchedPhotoIds: matches?.map((p) => p.id) ?? [],
		closeSearch,
	});

	if (!sessionChecked || info === null) {
		return (
			<div className="min-h-screen flex items-center justify-center bg-zinc-50">
				<Loader2 className="w-8 h-8 animate-spin text-violet-600" />
			</div>
		);
	}

	if (info === false) {
		return (
			<main className="min-h-screen flex flex-col items-center justify-center px-8 text-center bg-zinc-50">
				<h1 className="text-3xl text-zinc-900" style={{ fontFamily: "var(--font-display)" }}>
					{t("guest.landing.notFoundTitle")}
				</h1>
				<p className="mt-3 max-w-xs text-zinc-500">{t("guest.landing.notFoundBody")}</p>
				<Credit />
			</main>
		);
	}

	const langToggle = (
		<button
			onClick={() => setLocale(locale === "he" ? "en" : "he")}
			className="text-sm font-medium px-3 min-h-11"
		>
			{locale === "he" ? "EN" : "עברית"}
		</button>
	);

	if (!session) {
		const dateMeta = info.eventDate.replace(/[./-]/g, " · ");
		return (
			<div className="min-h-[100svh] bg-[#faf8f3] flex flex-col">
				{/* The couple's album cover, set like a magazine: their names lead, WED is only the credit. */}
				<div className="flex items-center justify-between px-6 pt-5 text-zinc-500">
					<p className="meta" dir="ltr">{dateMeta}</p>
					{langToggle}
				</div>

				<main className="flex-1 w-full max-w-xl mx-auto px-6">
					<h1
						className="lp-rise mt-4 text-[clamp(3.2rem,15vw,6rem)] leading-[0.9] tracking-[-0.035em] text-zinc-900"
						style={{ fontFamily: "var(--font-display)", animationDelay: "200ms" }}
					>
						{info.eventName}
					</h1>

					{info.coverUrl && (
						<div className="crop mt-7">
							<div className="overflow-hidden aspect-[4/5] bg-zinc-100">
								{/* eslint-disable-next-line @next/next/no-img-element */}
								<img src={info.coverUrl} alt="" className="develop w-full h-full object-cover" />
							</div>
						</div>
					)}

					<div className="mt-6 flex items-baseline justify-between gap-4 border-b border-zinc-300 pb-3">
						<p className="meta text-zinc-900" dir="ltr">{info.eventName}</p>
						<p className="meta text-zinc-500">{t("guest.landing.ourWedding")}</p>
					</div>

					<p className="lp-rise mt-6 text-lg text-zinc-600" style={{ animationDelay: "500ms" }}>
						{t("guest.landing.tagline")}
					</p>

					<form
						onSubmit={(e) => {
							e.preventDefault();
							handleStart("selfie");
						}}
						className="lp-rise mt-7 space-y-3"
						style={{ animationDelay: "650ms" }}
					>
						{info.passwordRequired && (
							<div>
								<label htmlFor="lp-password" className="block text-sm text-zinc-600 mb-1.5">
									{t("guest.join.passwordLabel")}
								</label>
								<input
									id="lp-password"
									type="password"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									required
									autoComplete="current-password"
									className="w-full h-[52px] rounded-[2px] bg-white px-4 text-base text-zinc-900 border border-zinc-300 focus:outline-none focus:border-violet-600 focus:ring-1 focus:ring-violet-600"
								/>
								<p className="mt-1.5 text-sm text-zinc-500">{t("guest.join.passwordHint")}</p>
							</div>
						)}
						{joinError && <p role="alert" className="text-sm text-red-700">{joinError}</p>}
						<button
							type="submit"
							disabled={isJoining}
							className="w-full h-14 rounded-[2px] bg-zinc-900 text-zinc-50 text-base font-medium flex items-center justify-between px-5 transition-colors hover:bg-violet-600 disabled:opacity-60"
						>
							{isJoining ? (
								<Loader2 className="w-5 h-5 animate-spin mx-auto" />
							) : (
								<>
									<span>{t("guest.landing.findPhotos")}</span>
									<span aria-hidden className="rtl:-scale-x-100">→</span>
								</>
							)}
						</button>
						<button
							type="button"
							onClick={() => handleStart("album")}
							disabled={isJoining}
							className="min-h-11 text-zinc-700 underline underline-offset-[6px] decoration-zinc-300 hover:decoration-zinc-900"
						>
							{t("guest.landing.seeAlbum")}
						</button>
					</form>
					{features.landing}
				</main>

				<footer className="px-6 pt-10 pb-8 flex items-end justify-between gap-6 text-zinc-500 max-w-xl w-full mx-auto">
					<p className="text-sm max-w-[16rem]">{t("guest.selfieSearch.privacyNote")}</p>
					<Credit />
				</footer>
			</div>
		);
	}

	const viewerPhoto = viewerIndex !== null ? photos[viewerIndex] : null;
	const canLoadMore = !personFilter && photos.length < total;

	return (
		<div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
			<header className="sticky top-0 z-30 bg-zinc-50 border-b border-zinc-200">
				<div className="max-w-[1440px] mx-auto px-5 sm:px-8 py-4 flex items-center justify-between gap-4">
					<Wordmark name={info.eventName} date={info.eventDate} />
					<div className="text-zinc-500 shrink-0">{langToggle}</div>
				</div>
			</header>

			<input
				ref={uploadInputRef}
				type="file"
				accept="image/*"
				multiple
				className="hidden"
				onChange={handleUploadFiles}
			/>

			<main className="max-w-[1440px] mx-auto px-5 py-6 space-y-6">
				{features.galleryTop}
				<div className="flex items-end justify-between gap-3 border-b border-zinc-200 -mt-1">
					<nav className="flex gap-6 sm:gap-9 overflow-x-auto" aria-label={t("guest.gallery.tabsAriaLabel")}>
						{(
							[
								["wedding", t("guest.gallery.tabs.wedding"), sourceTotals.official],
								["guests", t("guest.gallery.tabs.guests"), sourceTotals.guests],
								["you", t("guest.gallery.tabs.mine"), people.find((p) => p.id === session.guest.id)?.photoCount ?? 0],
							] as const
						).map(([key, label, count]) => {
							const active =
								key === "you"
									? personFilter === session.guest.id
									: !personFilter && sourceView === (key === "wedding" ? "official" : "guests");
							return (
								<button
									key={key}
									onClick={() => {
										if (key === "you") {
											setPersonFilter(session.guest.id);
										} else {
											setPersonFilter(null);
											setSourceView(key === "wedding" ? "official" : "guests");
										}
									}}
									className={`pb-2.5 sm:pb-3 border-b-2 -mb-px whitespace-nowrap text-sm sm:text-base transition-colors ${active ? "border-violet-600 text-violet-800 font-medium" : "border-transparent text-zinc-500 hover:text-zinc-800"}`}
								>
									{label}
									<span className={`ms-2 text-xs ${active ? "text-violet-500" : "text-zinc-400"}`}>
										{count}
									</span>
								</button>
							);
						})}
					</nav>
					{!isSelecting && (
						<div className="flex items-center gap-1 shrink-0">
							<button
								onClick={() => chooseGalleryLayout("masonry")}
								title={t("guest.gallery.layoutMasonry")}
								aria-label={t("guest.gallery.layoutMasonry")}
								className={`p-2 mb-1.5 rounded-[2px] transition-colors ${galleryLayout === "masonry" ? "text-violet-700 bg-violet-100" : "text-zinc-500 hover:text-violet-700 hover:bg-zinc-100"}`}
							>
								<Columns3 className="w-5 h-5" />
							</button>
							<button
								onClick={() => chooseGalleryLayout("grid")}
								title={t("guest.gallery.layoutGrid")}
								aria-label={t("guest.gallery.layoutGrid")}
								className={`p-2 mb-1.5 rounded-[2px] transition-colors ${galleryLayout === "grid" ? "text-violet-700 bg-violet-100" : "text-zinc-500 hover:text-violet-700 hover:bg-zinc-100"}`}
							>
								<LayoutGrid className="w-5 h-5" />
							</button>
						<DropdownMenu.Root dir={dir}>
							<DropdownMenu.Trigger asChild>
								<button
									className="p-2 mb-1.5 rounded-[2px] text-zinc-500 hover:text-violet-700 hover:bg-zinc-100 shrink-0"
									aria-label={t("guest.gallery.moreActions")}
								>
									<MoreVertical className="w-5 h-5" />
								</button>
							</DropdownMenu.Trigger>
							<DropdownMenu.Portal>
								<DropdownMenu.Content
									align="end"
									sideOffset={6}
									collisionPadding={12}
									className="z-40 min-w-52 bg-[#faf8f3] border border-zinc-300 p-1.5 space-y-0.5 shadow-[0_18px_40px_-20px_rgba(25,25,23,0.5)]"
								>
									<DropdownMenu.Item
										onSelect={() => withName(() => uploadInputRef.current?.click())}
										disabled={uploadProgress !== null}
										className="flex items-center gap-2.5 text-sm text-zinc-700 dark:text-zinc-200 px-3 py-2.5 rounded-[2px] outline-none data-[highlighted]:bg-zinc-100 dark:data-[highlighted]:bg-zinc-800 cursor-pointer"
									>
										{uploadProgress ? (
											<Loader2 className="w-4 h-4 animate-spin" />
										) : (
											<Plus className="w-4 h-4" />
										)}
										{t("guest.gallery.addPhotos")}
									</DropdownMenu.Item>
									<DropdownMenu.Item
										onSelect={() => setIsSelecting(true)}
										disabled={photos.length === 0}
										className="flex items-center gap-2.5 text-sm text-zinc-700 dark:text-zinc-200 px-3 py-2.5 rounded-[2px] outline-none data-[highlighted]:bg-zinc-100 dark:data-[highlighted]:bg-zinc-800 cursor-pointer"
									>
										<CheckSquare className="w-4 h-4" />
										{t("guest.gallery.selectionMode")}
									</DropdownMenu.Item>
									{personFilter && photos.length > 0 && (
										<DropdownMenu.Item
											onSelect={() => handleDownloadZip(photos)}
											disabled={isZipping}
											className="flex items-center gap-2.5 text-sm text-zinc-700 dark:text-zinc-200 px-3 py-2.5 rounded-[2px] outline-none data-[highlighted]:bg-zinc-100 dark:data-[highlighted]:bg-zinc-800 cursor-pointer"
										>
											{isZipping ? (
												<Loader2 className="w-4 h-4 animate-spin" />
											) : (
												<Download className="w-4 h-4" />
											)}
											{t("guest.gallery.downloadAll")}
										</DropdownMenu.Item>
									)}
									{features.menuItems}
								</DropdownMenu.Content>
							</DropdownMenu.Portal>
						</DropdownMenu.Root>
						</div>
					)}
				</div>

				{uploadProgress && (
					<p className="text-sm text-violet-700 dark:text-violet-300">
						{uploadProgress}
					</p>
				)}
				{uploadNotice && (
					<p role="alert" className="text-sm text-red-700 dark:text-red-400">
						{uploadNotice}
					</p>
				)}

				{photos.length === 0 && !isLoading ? (
					<div className="text-center py-24">
						<Images className="w-10 h-10 text-zinc-300 dark:text-zinc-600 mx-auto mb-4" />
						<p className="text-zinc-500">
							{personFilter
								? t("guest.gallery.emptyTagged")
								: t("guest.gallery.emptyAlbum")}
						</p>
					</div>
				) : (
					<div
						className={
							galleryLayout === "masonry"
								? "columns-2 sm:columns-3 lg:columns-4 gap-2 sm:gap-3"
								: "grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-1.5 sm:gap-2"
						}
					>
						{photos.map((photo, index) => (
							<div
								key={photo.id}
								role="button"
								tabIndex={0}
								onClick={() => {
									if (longPressFired.current) {
										longPressFired.current = false;
										return;
									}
									if (isSelecting) toggleSelect(photo.id);
									else setViewerIndex(index);
								}}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") {
										e.preventDefault();
										if (isSelecting) toggleSelect(photo.id);
										else setViewerIndex(index);
									}
								}}
								onPointerDown={(e) => {
									if (isSelecting || e.pointerType === "mouse") return;
									startLongPress(e.clientX, e.clientY, photo.id);
								}}
								onPointerMove={(e) => {
									const start = longPressStart.current;
									if (!start) return;
									if (
										Math.abs(e.clientX - start.x) > 10 ||
										Math.abs(e.clientY - start.y) > 10
									)
										cancelLongPress();
								}}
								onPointerUp={cancelLongPress}
								onPointerLeave={cancelLongPress}
								onPointerCancel={cancelLongPress}
								className={`group relative block w-full cursor-pointer bg-[#eee9e1] overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 transition-all ${galleryLayout === "masonry" ? "mb-2 sm:mb-3 break-inside-avoid" : "aspect-square"} ${isSelecting && selectedIds.includes(photo.id) ? "ring-2 ring-violet-600 border-violet-600 scale-[0.97]" : "border-zinc-200"}`}
							>
								{isSelecting && (
									<span
										className={`absolute top-2 start-2 z-10 w-6 h-6 border flex items-center justify-center ${selectedIds.includes(photo.id) ? "bg-zinc-900 border-zinc-900" : "bg-zinc-50/70 border-zinc-50"}`}
									>
										{selectedIds.includes(photo.id) && (
											<Check className="w-4 h-4 text-white" />
										)}
									</span>
								)}
								{/* eslint-disable-next-line @next/next/no-img-element */}
								<img
									ref={(el) => {
										if (el?.complete) markPhotoLoaded(photo.id);
									}}
									src={photo.thumbUrl || photo.viewUrl}
									alt=""
									loading="lazy"
									onLoad={() => markPhotoLoaded(photo.id)}
									className={`img-fade object-cover transition-transform duration-500 group-hover:scale-[1.03] ${loadedPhotoIds.has(photo.id) ? "img-loaded" : ""} ${galleryLayout === "masonry" ? "w-full h-auto" : "absolute inset-0 w-full h-full"}`}
								/>
								{/* who is in it; redundant (so hidden) on the guest's own tab */}
								{photo.tags.length > 0 && personFilter !== session.guest.id && (
									<span className="absolute bottom-0 inset-x-0 flex items-center gap-1 min-w-0 px-2 pt-6 pb-1.5 text-xs text-zinc-50 bg-gradient-to-t from-zinc-950/55 to-transparent">
										<Tag className="w-3 h-3 shrink-0" />
										<span className="truncate">
											{photo.tags.map((t) => t.name).join(", ")}
										</span>
									</span>
								)}

								{/* hover quick actions (desktop) */}
								{!isSelecting && (
									<div
										className="absolute inset-x-0 top-0 p-2 flex items-center justify-end gap-1.5 bg-gradient-to-b from-black/50 to-transparent opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
										onClick={(e) => e.stopPropagation()}
									>
										<button
											onClick={() => withName(() => toggleSelfTag(photo))}
											title={photo.tags.some((tag) => tag.guestId === session.guest.id) ? t("guest.tag.removeMine") : t("guest.tag.markMe")}
											className={`p-1.5 rounded-full backdrop-blur-sm transition-colors ${photo.tags.some((tag) => tag.guestId === session.guest.id) ? "bg-violet-600 text-white" : "bg-white/85 text-zinc-800 hover:bg-white"}`}
										>
											<Check className="w-3.5 h-3.5" />
										</button>
										<button
											onClick={() =>
												downloadImage(photo.viewUrl, `wedding-${photo.id}.jpg`)
											}
											title={t("guest.gallery.downloadTitle")}
											className="p-1.5 rounded-full bg-white/85 text-zinc-800 hover:bg-white backdrop-blur-sm"
										>
											<Download className="w-3.5 h-3.5" />
										</button>
									</div>
								)}
							</div>
						))}
					</div>
				)}

				{isLoading && photos.length === 0 && (
					<div className="columns-2 sm:columns-3 lg:columns-4 gap-3 sm:gap-4">
						{[210, 160, 250, 180, 230, 150, 200, 260, 170, 220, 190, 240].map(
							(h, i) => (
								<div
									key={i}
									className="mb-3 sm:mb-4 w-full break-inside-avoid rounded-[2px] bg-zinc-200/70 animate-pulse"
									style={{ height: `${h}px` }}
								/>
							),
						)}
					</div>
				)}

				{isLoading && photos.length > 0 && (
					<div className="flex justify-center py-6">
						<Loader2 className="w-5 h-5 animate-spin text-violet-500" />
					</div>
				)}

				{canLoadMore && <div ref={loadMoreRef} className="h-1" aria-hidden />}
				{!canLoadMore && photos.length > 0 && (
					<div className="flex justify-center py-10">
						<Credit />
					</div>
				)}
			</main>

			{/* ---------------------------------------- floating actions */}
			{!isSelecting && viewerIndex === null && !isSearchOpen && (
				<div className="fixed bottom-5 end-4 sm:end-6 z-40 flex flex-col items-end gap-3">
					<button
						onClick={() => setIsSearchOpen(true)}
						className="flex items-center gap-2.5 h-14 px-6 rounded-[2px] bg-violet-600 hover:bg-violet-700 text-zinc-50 font-medium shadow-[0_12px_30px_-12px_rgba(25,25,23,0.55)] transition-colors"
					>
						<UserSearch className="w-5 h-5" />
						<span className="hidden sm:inline">{t("guest.selfieSearch.title")}</span>
						<span className="sm:hidden">{t("guest.selfieSearch.findMeButton")}</span>
					</button>
				</div>
			)}

			{/* ---------------------------------------- selection action bar */}
			{isSelecting && (
				<div
					className="fixed bottom-2 inset-x-2 sm:inset-x-auto sm:bottom-4 sm:left-1/2 sm:-translate-x-1/2 sm:min-w-[26rem] z-40 rounded-[2px] px-3 py-2.5 shadow-2xl space-y-2"
					style={{ background: "#171311f0" }}
				>
					<div className="flex items-center gap-2">
						<button
							onClick={exitSelection}
							className="p-1.5 rounded-[2px] text-white/60 hover:text-white hover:bg-white/10"
							title={t("guest.selection.exitTitle")}
						>
							<X className="w-4 h-4" />
						</button>
						<span className="text-sm text-white/90">
							{t("guest.selection.selectedCount").replace("{count}", String(selectedIds.length))}
						</span>
						<button
							onClick={() =>
								setSelectedIds(
									selectedIds.length === photos.length ? [] : photos.map((p) => p.id),
								)
							}
							className="ms-auto px-3 py-1.5 rounded-[2px] text-sm text-white/75 hover:text-white hover:bg-white/10"
						>
							{selectedIds.length === photos.length ? t("guest.selection.clearAll") : t("guest.selection.selectAll")}
						</button>
					</div>

					<div className="grid grid-cols-2 gap-2">
						<button
							onClick={() =>
								handleDownloadZip(photos.filter((p) => selectedIds.includes(p.id)))
							}
							disabled={selectedIds.length === 0 || isZipping}
							className="flex flex-col items-center gap-1 py-2.5 rounded-[2px] text-xs bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40 transition-colors"
						>
							{isZipping ? (
								<Loader2 className="w-4 h-4 animate-spin" />
							) : (
								<Download className="w-4 h-4" />
							)}
							{t("guest.gallery.saveButton")}
						</button>
						<button
							onClick={handleBatchClaim}
							disabled={selectedIds.length === 0 || isBatchWorking}
							className="flex flex-col items-center gap-1 py-2.5 rounded-[2px] text-xs bg-white/10 text-white/85 hover:bg-white/15 disabled:opacity-40 transition-colors"
						>
							{isBatchWorking ? (
								<Loader2 className="w-4 h-4 animate-spin" />
							) : (
								<Check className="w-4 h-4" />
							)}
							{t("guest.tag.markMe")}
						</button>
					</div>
				</div>
			)}

			{/* -------------------------------------------------- photo viewer */}
			{viewerPhoto && (
				<div
					className="fixed inset-0 z-50 flex flex-col"
					style={{ background: "#171311f2" }}
				>
					<div className="flex items-center justify-between p-2 sm:p-4">
						<button
							onClick={() => setViewerIndex(null)}
							className="p-3 text-white/70 hover:text-white rounded-full hover:bg-white/10 transition-colors"
						>
							<X className="w-5 h-5" />
						</button>
						<span className="text-white/50 text-sm">
							{viewerIndex! + 1} / {photos.length}
						</span>
						<span className="w-11" aria-hidden />
					</div>

					<div
						className="relative flex-1 flex items-center justify-center px-4 min-h-0"
						onTouchStart={(e) => (touchStartX.current = e.touches[0].clientX)}
						onTouchEnd={(e) => {
							const start = touchStartX.current;
							touchStartX.current = null;
							if (start === null || viewerIndex === null) return;
							const dx = e.changedTouches[0].clientX - start;
							if (Math.abs(dx) < 50) return;
							if (dx < 0 && viewerIndex < photos.length - 1)
								setViewerIndex(viewerIndex + 1);
							else if (dx > 0 && viewerIndex > 0) setViewerIndex(viewerIndex - 1);
						}}
					>
						{viewerIndex! < photos.length - 1 && (
							<button
								onClick={() => setViewerIndex(viewerIndex! + 1)}
								className="absolute start-3 z-10 p-3 text-white/70 hover:text-white rounded-full hover:bg-white/10"
							>
								<ChevronRight className="w-6 h-6 rtl:rotate-180" />
							</button>
						)}
						{/* eslint-disable-next-line @next/next/no-img-element */}
						<img
							src={viewerPhoto.previewUrl || viewerPhoto.viewUrl}
							alt=""
							className="max-w-full max-h-full object-contain rounded-sm"
						/>
						{viewerIndex! > 0 && (
							<button
								onClick={() => setViewerIndex(viewerIndex! - 1)}
								className="absolute end-3 z-10 p-3 text-white/70 hover:text-white rounded-full hover:bg-white/10"
							>
								<ChevronLeft className="w-6 h-6 rtl:rotate-180" />
							</button>
						)}
					</div>

					<div className="p-3 sm:p-4 space-y-3 max-w-md mx-auto w-full">
						{viewerPhoto.tags.length > 0 && (
							<div className="flex flex-wrap items-center gap-1.5 justify-center">
								{viewerPhoto.tags.map((tag) => (
									<span
										key={tag.guestId}
										className="flex items-center gap-1.5 text-xs bg-white/12 text-white/90 px-3 py-1 rounded-full"
									>
										{tag.name}
										{tag.guestId === session.guest.id && (
											<button
												onClick={() => removeTag(viewerPhoto.id, tag.guestId)}
												className="text-white/50 hover:text-white"
												title={t("guest.viewer.removeTagTitle")}
											>
												<X className="w-3 h-3" />
											</button>
										)}
									</span>
								))}
							</div>
						)}

						<div className="grid grid-cols-2 gap-2">
							<button
								onClick={() => withName(() => toggleSelfTag(viewerPhoto))}
								disabled={isTagging}
								className={`flex flex-col items-center gap-1 py-2.5 rounded-[2px] text-xs transition-colors ${viewerPhoto.tags.some((tag) => tag.guestId === session.guest.id) ? "bg-violet-600 text-white" : "bg-white/10 text-white/85 hover:bg-white/15"}`}
							>
								<Check className="w-4 h-4" />
								{viewerPhoto.tags.some((tag) => tag.guestId === session.guest.id) ? t("guest.tag.markedMine") : t("guest.tag.markMe")}
							</button>
							<button
								onClick={() =>
									downloadImage(viewerPhoto.viewUrl, `wedding-${viewerPhoto.id}.jpg`)
								}
								className="flex flex-col items-center gap-1 py-2.5 rounded-[2px] text-xs bg-white/10 text-white/85 hover:bg-white/15 transition-colors"
							>
								<Download className="w-4 h-4" />
								{t("guest.gallery.saveButton")}
							</button>
						</div>
					</div>
				</div>
			)}

			{/* -------------------------------------------------- selfie search */}
			{isSearchOpen && (
				<div role="dialog" aria-modal="true" aria-labelledby="search-title" className="fixed inset-0 z-50 bg-zinc-950/55 sm:flex sm:items-center sm:justify-center sm:p-6">
					<div className="relative h-full sm:h-auto w-full sm:max-w-lg sm:max-h-[92vh] overflow-y-auto bg-[#faf8f3] px-6 pt-6 pb-8 space-y-6">
						<div className="flex items-start justify-between gap-4">
							<div>
								<p className="meta text-zinc-500" dir="ltr">{info.eventName}</p>
								<h2
									id="search-title"
									className="mt-2 text-[2.1rem] leading-tight text-zinc-900"
									style={{ fontFamily: "var(--font-display)" }}
								>
									{t("guest.selfieSearch.title")}
								</h2>
							</div>
							<button
								onClick={closeSearch}
								aria-label={t("guest.selfieSearch.cancelButton")}
								className="p-2 -m-2 text-zinc-500 hover:text-zinc-900"
							>
								<X className="w-5 h-5" />
							</button>
						</div>

						{matches === null ? (
							<>
								{isCameraOpen && !selfie ? (
									<div className="space-y-3">
										<div className="relative w-full aspect-square rounded-[2px] overflow-hidden bg-black">
											<video
												ref={videoRef}
												autoPlay
												playsInline
												muted
												className="w-full h-full object-cover scale-x-[-1]"
											/>
										</div>
										<div className="flex gap-2">
											<Button
												variant="outline"
												onClick={stopCamera}
												className="flex-1 min-h-11 rounded-[2px]"
											>
												{t("guest.selfieSearch.cancelButton")}
											</Button>
											<Button
												onClick={takeDesktopPhoto}
												className="flex-1 min-h-11 bg-violet-600 hover:bg-violet-700 text-white rounded-[2px]"
											>
												{t("guest.selfieSearch.captureButton")}
											</Button>
										</div>
									</div>
								) : selfie ? (
									<div className="text-center space-y-3">
										{/* eslint-disable-next-line @next/next/no-img-element */}
										<img
											src={selfiePreview}
											alt=""
											className="w-36 h-36 mx-auto rounded-full object-cover border-4 border-violet-100 dark:border-violet-900"
										/>
										<button
											onClick={() => {
												setSelfie(null);
												if (!isMobile) startDesktopCamera();
											}}
											className="text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 underline"
										>
											{t("guest.selfieSearch.retakeButton")}
										</button>
									</div>
								) : (
									<div className="relative">
										{isMobile ? (
											<input
												type="file"
												accept="image/*"
												capture="user"
												onChange={(e) =>
													e.target.files?.[0] &&
													setSelfie(e.target.files[0])
												}
												className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
											/>
										) : (
											<button
												onClick={startDesktopCamera}
												className="absolute inset-0 w-full h-full z-10"
											/>
										)}
										{/* a viewfinder: crop marks around a face guide */}
										<div className="crop mx-2 my-3">
											<div className="aspect-[4/5] bg-[#eee9e1] flex flex-col items-center justify-center gap-5 transition-colors hover:bg-[#e2dcd2]">
												<div aria-hidden className="h-[46%] aspect-[3/4] rounded-[50%] border border-dashed border-zinc-500/60" />
												<p className="flex items-center gap-2 text-base text-zinc-800">
													{isMobile ? <Camera className="w-5 h-5" /> : <Video className="w-5 h-5" />}
													{isMobile ? t("guest.selfieSearch.tapToCapture") : t("guest.selfieSearch.clickToCapture")}
												</p>
											</div>
										</div>
									</div>
								)}

								{!isCameraOpen && !selfie && (
									<ul className="grid grid-cols-3 gap-3 text-center text-sm text-zinc-600">
										<li>{t("guest.selfieSearch.tipLight")}</li>
										<li>{t("guest.selfieSearch.tipLook")}</li>
										<li>{t("guest.selfieSearch.tipAlone")}</li>
									</ul>
								)}

								{!isCameraOpen && !selfie && (
									<label className="block text-center text-sm text-zinc-700 cursor-pointer underline decoration-zinc-300 underline-offset-[6px]">
										{isMobile ? t("guest.selfieSearch.choosePhoto") : t("guest.selfieSearch.uploadFromComputer")}
										<input
											type="file"
											accept="image/*"
											onChange={(e) =>
												e.target.files?.[0] && setSelfie(e.target.files[0])
											}
											className="hidden"
										/>
									</label>
								)}

								{searchError && (
									<p className="text-sm text-red-600 dark:text-red-400 text-center">
										{searchError}
									</p>
								)}

								<Button
									onClick={handleSearch}
									disabled={!selfie || isSearching}
									className="w-full min-h-12 bg-violet-600 hover:bg-violet-700 text-white text-base font-medium rounded-[2px]"
								>
									{isSearching ? (
										<>
											<Loader2 className="w-5 h-5 animate-spin me-2" />
											{t("guest.selfieSearch.searchingButton")}
										</>
									) : (
										t("guest.selfieSearch.findMeButton")
									)}
								</Button>

								<p className="text-xs text-zinc-400 text-center">
									{t("guest.selfieSearch.privacyNote")}
								</p>
							</>
						) : matches.length === 0 ? (
							<div className="text-center space-y-4 py-4">
								<p className="text-zinc-600 dark:text-zinc-300">
									{t("guest.selfieSearch.noMatchTitle")}
								</p>
								<p className="text-sm text-zinc-500">
									{searchSessionId
										? t("guest.selfieSearch.noMatchRetryWithSession")
										: t("guest.selfieSearch.noMatchRetryFresh")}
								</p>
								<Button
									variant="outline"
									onClick={() => {
										setMatches(null);
										setSelfie(null);
									}}
									className="rounded-[2px] min-h-11"
								>
									{t("guest.selfieSearch.tryAgainButton")}
								</Button>
							</div>
						) : (
							<div className="space-y-4">
								<p className="text-center text-zinc-700 dark:text-zinc-200 font-medium">
									{t("guest.selfieSearch.foundCount").replace("{count}", String(matches.length))}
								</p>
								{needsSecondSelfie && (
									<div className="text-center text-sm bg-violet-50 text-violet-800 rounded-[2px] px-4 py-3">
										{t("guest.selfieSearch.needsSecondSelfieHint")}
										<button
											onClick={() => {
												setMatches(null);
												setSelfie(null);
											}}
											className="block mx-auto mt-1.5 underline underline-offset-4 font-medium"
										>
											{t("guest.selfieSearch.anotherPhotoButton")}
										</button>
									</div>
								)}
								<div className="grid grid-cols-3 gap-2 max-h-64 overflow-y-auto">
									{matches.map((photo) => (
										/* eslint-disable-next-line @next/next/no-img-element */
										<img
											key={photo.id}
											src={photo.thumbUrl || photo.viewUrl}
											alt=""
											className="w-full aspect-square object-cover rounded-[2px]"
										/>
									))}
								</div>
								<Button
									onClick={() => handleDownloadZip(matches)}
									disabled={isZipping}
									className="w-full min-h-12 bg-violet-600 hover:bg-violet-700 text-white text-base font-medium"
								>
									{isZipping ? (
										<Loader2 className="w-5 h-5 animate-spin" />
									) : (
										<>
											<Download className="w-5 h-5" />
											{t("guest.selfieSearch.saveAll").replace("{count}", String(matches.length))}
										</>
									)}
								</Button>
								<div className="grid grid-cols-2 gap-2">
									<Button onClick={shareOnWhatsApp} variant="outline" className="min-h-11">
										<Share2 className="w-4 h-4" />
										{t("guest.selfieSearch.shareWhatsApp")}
									</Button>
									<Button
										onClick={() => withName(handleClaim)}
										disabled={isClaiming}
										variant="outline"
										className="min-h-11"
									>
										{isClaiming ? <Loader2 className="w-4 h-4 animate-spin" /> : t("guest.selfieSearch.addToMine")}
									</Button>
								</div>
								<button
									onClick={() => {
										setMatches(null);
										setSelfie(null);
									}}
									className="block mx-auto text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 underline"
								>
									{t("guest.selfieSearch.searchAgainButton")}
								</button>
								{features.results}
							</div>
						)}
					</div>
				</div>
			)}
			{features.overlays}
			{namePrompt && (
				<div
					role="dialog"
					aria-modal="true"
					aria-labelledby="name-title"
					className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-zinc-950/50 p-4"
					onClick={() => setNamePrompt(null)}
				>
					<form
						onSubmit={saveName}
						onClick={(e) => e.stopPropagation()}
						className="w-full max-w-sm bg-white rounded p-6 space-y-4"
					>
						<h2 id="name-title" className="text-2xl text-zinc-900" style={{ fontFamily: "var(--font-display)" }}>
							{t("guest.name.title")}
						</h2>
						<p className="text-zinc-600">{t("guest.name.body")}</p>
						<input
							autoFocus
							value={nameInput}
							onChange={(e) => setNameInput(e.target.value)}
							maxLength={80}
							autoComplete="name"
							aria-labelledby="name-title"
							className="w-full h-12 rounded-[2px] border border-zinc-300 bg-[#faf8f3] px-4 text-base focus:outline-none focus:border-violet-600 focus:ring-1 focus:ring-violet-600"
						/>
						<div className="flex gap-2">
							<Button type="submit" disabled={isSavingName || !nameInput.trim()} className="flex-1 min-h-12">
								{isSavingName ? <Loader2 className="w-5 h-5 animate-spin" /> : t("guest.name.save")}
							</Button>
							<Button type="button" variant="outline" className="min-h-12" onClick={() => setNamePrompt(null)}>
								{t("guest.selfieSearch.cancelButton")}
							</Button>
						</div>
					</form>
				</div>
			)}
		</div>
	);
}
