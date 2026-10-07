"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Camera,
	Check,
	CheckSquare,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Columns3,
	Download,
	Images,
	LayoutGrid,
	Loader2,
	LogOut,
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
	getGuestSession,
	joinWedding,
	clearGuestSession,
	guestFetch,
} from "@/lib/guest";
import { useI18n, setLocale } from "@/lib/i18n/I18nProvider";
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

const EVENT_NAME = process.env.NEXT_PUBLIC_EVENT_NAME || "Your Names Here";
const EVENT_DATE = process.env.NEXT_PUBLIC_EVENT_DATE || "DD.MM.YYYY";

function landingSteps(t: (key: TranslationKey) => string) {
	return [
		{ title: t("guest.landing.steps.enter.title"), body: t("guest.landing.steps.enter.body") },
		{ title: t("guest.landing.steps.browse.title"), body: t("guest.landing.steps.browse.body") },
		{ title: t("guest.landing.steps.selfie.title"), body: t("guest.landing.steps.selfie.body") },
		{ title: t("guest.landing.steps.share.title"), body: t("guest.landing.steps.share.body") },
	];
}

/** Fades content up once it scrolls into view (see .lp-reveal in globals.css). */
function Reveal({
	children,
	delay = 0,
	className = "",
}: {
	children: React.ReactNode;
	delay?: number;
	className?: string;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const [visible, setVisible] = useState(false);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry.isIntersecting) {
					setVisible(true);
					observer.disconnect();
				}
			},
			{ threshold: 0.15 },
		);
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	return (
		<div
			ref={ref}
			className={`lp-reveal ${visible ? "lp-visible" : ""} ${className}`}
			style={{ transitionDelay: `${delay}ms` }}
		>
			{children}
		</div>
	);
}
const MAX_PHOTO_MB = Number(process.env.NEXT_PUBLIC_MAX_PHOTO_MB || "30");

// Matches the wedding stationery: letterspaced serif caps in bronze,
// a small heart between thin rules, then the date.
function Wordmark({ size = "lg" }: { size?: "sm" | "lg" }) {
	return (
		<div className="text-center" dir="ltr">
			<p
				className={`uppercase whitespace-nowrap text-violet-700 ${size === "lg" ? "text-3xl sm:text-4xl tracking-[0.3em]" : "text-sm sm:text-lg tracking-[0.12em] sm:tracking-[0.2em]"}`}
				style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}
			>
				{EVENT_NAME}
			</p>
			{size === "lg" ? (
				<div className="flex items-center justify-center gap-3 mt-3">
					<span className="h-px w-10 bg-violet-300" />
					<span className="text-violet-600 text-xs">♥</span>
					<span className="h-px w-10 bg-violet-300" />
				</div>
			) : null}
			<p
				className={`whitespace-nowrap tracking-[0.35em] text-violet-600/80 ${size === "lg" ? "mt-3 text-sm" : "mt-0.5 text-[9px] sm:text-[10px]"}`}
				style={{ fontFamily: "var(--font-display)" }}
			>
				{EVENT_DATE}
			</p>
		</div>
	);
}

export default function WeddingPage() {
	const { t, locale, dir } = useI18n();
	const [session, setSession] = useState<GuestSession | null>(null);
	const [sessionChecked, setSessionChecked] = useState(false);

	// join form
	const [name, setName] = useState("");
	const [phone, setPhone] = useState("");
	const [password, setPassword] = useState("");
	const [joinError, setJoinError] = useState("");
	const [isJoining, setIsJoining] = useState(false);
	const [showHero, setShowHero] = useState(true);
	// the couple may not have provided data/branding/invite-card.png
	const [showInviteCard, setShowInviteCard] = useState(true);

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
	const [isZipping, setIsZipping] = useState(false);

	useEffect(() => {
		setSession(getGuestSession());
		setSessionChecked(true);
		const mobileRegex =
			/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
		setIsMobile(mobileRegex.test(navigator.userAgent));
	}, []);

	const handleAuthFailure = useCallback(() => {
		clearGuestSession();
		setSession(null);
		setPhotos([]);
	}, []);

	const handleLeave = () => {
		clearGuestSession();
		setSession(null);
		setPhotos([]);
		setPeople([]);
		setPersonFilter(null);
		setIsSelecting(false);
		setSelectedIds([]);
		window.scrollTo(0, 0);
	};

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

	const formatPhone = (raw: string) => {
		const digits = raw.replace(/\D/g, "").slice(0, 10);
		return digits.length > 3 ? `${digits.slice(0, 3)}-${digits.slice(3)}` : digits;
	};

	// requires first + last name so tags/identities stay unique across guests
	const isFullName = (raw: string) =>
		raw.trim().split(/\s+/).filter((w) => w.length >= 2).length >= 2;

	const handleJoin = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!isFullName(name)) {
			setJoinError(t("guest.join.errors.invalidName"));
			return;
		}
		setIsJoining(true);
		setJoinError("");
		const { session: newSession, error, existingName } = await joinWedding(
			name.trim(),
			phone.trim(),
			password,
		);
		if (newSession) {
			setSession(newSession);
		} else {
			setJoinError(
				error === "wrong-password"
					? t("guest.join.errors.wrongPassword")
					: error === "invalid-name"
						? t("guest.join.errors.invalidName")
						: error === "invalid-phone"
							? t("guest.join.errors.invalidPhone")
							: error === "phone-name-mismatch"
								? t("guest.join.errors.phoneNameMismatch").replace("{name}", existingName ?? "")
								: t("guest.join.errors.generic"),
			);
		}
		setIsJoining(false);
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
				const me = { guestId: session.guest.id, name: session.guest.name };
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
		const files = Array.from(e.target.files).filter(
			(f) => f.size <= MAX_PHOTO_MB * 1024 * 1024,
		);
		e.target.value = "";
		if (files.length === 0) return;

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
				const me = { guestId: session.guest.id, name: session.guest.name };
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

	if (!sessionChecked) {
		return (
			<div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950">
				<Loader2 className="w-8 h-8 animate-spin text-violet-600" />
			</div>
		);
	}

	if (!session) {
		const steps = landingSteps(t);
		return (
			<div className="min-h-screen bg-zinc-50">
				<button
					onClick={() => setLocale(locale === "he" ? "en" : "he")}
					className="fixed top-3 end-3 z-50 text-xs font-semibold text-zinc-500 hover:text-zinc-900 px-2.5 py-1.5 rounded-lg bg-white/70 hover:bg-white shadow-sm backdrop-blur-sm transition-colors"
				>
					{locale === "he" ? "EN" : "עברית"}
				</button>

				{/* ================= mobile landing ================= */}
				<div className="lg:hidden">
					<section className="relative min-h-[100svh] flex flex-col items-center justify-center overflow-hidden px-6 py-10">
						<div className="relative z-10 flex flex-col items-center text-center">
							{showInviteCard && (
								/* eslint-disable-next-line @next/next/no-img-element */
								<img
									src="/branding/invite-card.png"
									alt={`${EVENT_NAME} · ${EVENT_DATE}`}
									onError={() => setShowInviteCard(false)}
									className="lp-rise w-auto max-h-[52svh] shadow-[0_18px_50px_rgba(45,34,29,0.12)]"
									style={{ animationDelay: "200ms" }}
								/>
							)}
							<h2
								className="lp-rise mt-10 text-4xl sm:text-5xl text-zinc-900"
								style={{ fontFamily: "var(--font-display-he)", animationDelay: "900ms" }}
							>
								{t("guest.landing.thankYouTitle")}
							</h2>
							<p
								className="lp-rise mt-4 max-w-xs text-zinc-500 leading-relaxed"
								style={{ animationDelay: "1150ms" }}
							>
								{t("guest.landing.thankYouBody")}
							</p>
						</div>

						<button
							onClick={() =>
								document
									.getElementById("lp-story")
									?.scrollIntoView({ behavior: "smooth" })
							}
							className="lp-fade absolute bottom-9 z-10 flex flex-col items-center gap-2"
							style={{ animationDelay: "1700ms" }}
							aria-label={t("guest.landing.scrollDown")}
						>
							<span className="text-[10px] tracking-[0.35em] text-zinc-500">
								{t("guest.landing.scrollCue")}
							</span>
							<ChevronDown className="lp-cue w-4 h-4 text-violet-600" />
						</button>
					</section>

					{showHero && (
						<section id="lp-story" className="px-8 pt-24 pb-8">
							<Reveal className="lp-photo max-w-md mx-auto">
								<figure className="relative">
									<div
										aria-hidden
										className="absolute inset-0 translate-x-3 translate-y-3 border border-violet-300/80"
									/>
									<div className="relative overflow-hidden">
										{/* eslint-disable-next-line @next/next/no-img-element */}
										<img
											src="/branding/hero.jpg"
											alt={t("guest.landing.heroAlt")}
											onError={() => setShowHero(false)}
											className="w-full object-cover max-h-[70vh]"
										/>
									</div>
									<figcaption className="mt-6 text-center text-sm text-zinc-500">
										{t("guest.landing.heroCaption")}
									</figcaption>
								</figure>
							</Reveal>
						</section>
					)}

					<section
						id={showHero ? undefined : "lp-story"}
						className="px-8 pt-20 pb-4"
					>
						<div className="max-w-md mx-auto">
							<Reveal>
								<h2
									className="text-center text-3xl text-zinc-900"
									style={{ fontFamily: "var(--font-display-he)" }}
								>
									{t("guest.landing.howItWorksTitle")}
								</h2>
							</Reveal>
							<div className="mt-12 space-y-9">
								{steps.map((step, index) => (
									<Reveal key={index} delay={index * 130}>
										<div className="flex items-start gap-5">
											<span
												className="shrink-0 w-11 h-11 rounded-full border border-violet-400/80 text-violet-700 flex items-center justify-center text-lg"
												style={{ fontFamily: "var(--font-display)" }}
											>
												{index + 1}
											</span>
											<div className="pt-1">
												<p className="font-medium text-zinc-800">{step.title}</p>
												<p className="text-sm text-zinc-500 mt-1 leading-relaxed">
													{step.body}
												</p>
											</div>
										</div>
									</Reveal>
								))}
							</div>
						</div>
					</section>
				</div>

				{/* ================= desktop landing ================= */}
				<div className="hidden lg:block">
					<section className="relative min-h-screen flex items-center justify-center overflow-hidden px-16">
						<div className="relative z-10 grid grid-cols-2 items-center gap-20 xl:gap-28 w-full max-w-6xl">
							{/* RTL: first column sits on the reading side (right) */}
							<div className="flex flex-col items-start justify-self-start max-w-lg">
								<h2
									className="lp-rise text-5xl xl:text-6xl whitespace-nowrap text-zinc-900"
									style={{ fontFamily: "var(--font-display-he)", animationDelay: "700ms" }}
								>
									{t("guest.landing.thankYouTitle")}
								</h2>
								<div
									className="lp-fade flex items-center gap-3 mt-8"
									style={{ animationDelay: "1000ms" }}
								>
									<span className="lp-grow h-px w-14 bg-violet-300" style={{ animationDelay: "1050ms" }} />
									<span className="text-violet-600 text-xs">♥</span>
								</div>
								<p
									className="lp-rise mt-7 max-w-sm text-lg text-zinc-500 leading-relaxed"
									style={{ animationDelay: "1150ms" }}
								>
									{t("guest.landing.thankYouBody")}
								</p>
								<Button
									onClick={() =>
										document
											.getElementById("lp-entry")
											?.scrollIntoView({ behavior: "smooth" })
									}
									className="lp-rise mt-10 min-h-12 px-12 bg-violet-600 hover:bg-violet-700 text-white text-base font-medium rounded-lg"
									style={{ animationDelay: "1400ms" }}
								>
									{t("guest.landing.enterGalleryButton")}
								</Button>
							</div>
							{showInviteCard && (
								/* eslint-disable-next-line @next/next/no-img-element */
								<img
									src="/branding/invite-card.png"
									alt={`${EVENT_NAME} · ${EVENT_DATE}`}
									onError={() => setShowInviteCard(false)}
									className="lp-rise w-auto max-h-[74vh] justify-self-end shadow-[0_24px_60px_rgba(45,34,29,0.14)]"
									style={{ animationDelay: "200ms" }}
								/>
							)}
						</div>

						<button
							onClick={() =>
								document
									.getElementById("lp-story-desktop")
									?.scrollIntoView({ behavior: "smooth" })
							}
							className="lp-fade absolute bottom-9 start-1/2 z-10 flex flex-col items-center gap-2"
							style={{ animationDelay: "1900ms" }}
							aria-label={t("guest.landing.scrollDown")}
						>
							<span className="text-[10px] tracking-[0.35em] text-zinc-500">
								{t("guest.landing.scrollCue")}
							</span>
							<ChevronDown className="lp-cue w-4 h-4 text-violet-600" />
						</button>
					</section>

					<section id="lp-story-desktop" className="px-16 py-32">
						<div className="mx-auto grid max-w-6xl grid-cols-5 items-center gap-24">
							<div className="col-span-3">
								<Reveal>
									<h2
										className="text-4xl text-zinc-900"
										style={{ fontFamily: "var(--font-display-he)" }}
									>
										{t("guest.landing.howItWorksTitle")}
									</h2>
								</Reveal>
								<div className="mt-14 space-y-11">
									{steps.map((step, index) => (
										<Reveal key={index} delay={index * 130}>
											<div className="flex items-start gap-6">
												<span
													className="shrink-0 w-12 h-12 rounded-full border border-violet-400/80 text-violet-700 flex items-center justify-center text-xl"
													style={{ fontFamily: "var(--font-display)" }}
												>
													{index + 1}
												</span>
												<div className="pt-1.5">
													<p className="text-lg font-medium text-zinc-800">
														{step.title}
													</p>
													<p className="text-zinc-500 mt-1 leading-relaxed">
														{step.body}
													</p>
												</div>
											</div>
										</Reveal>
									))}
								</div>
							</div>

							{showHero && (
								<Reveal className="lp-photo col-span-2" delay={150}>
									<figure className="relative">
										<div
											aria-hidden
											className="absolute inset-0 translate-x-3.5 translate-y-3.5 border border-violet-300/80"
										/>
										<div className="relative overflow-hidden">
											{/* eslint-disable-next-line @next/next/no-img-element */}
											<img
												src="/branding/hero.jpg"
												alt={t("guest.landing.heroAlt")}
												onError={() => setShowHero(false)}
												className="w-full object-cover max-h-[60vh]"
											/>
										</div>
										<figcaption className="mt-6 text-center text-sm text-zinc-500">
											{t("guest.landing.heroCaption")}
										</figcaption>
									</figure>
								</Reveal>
							)}
						</div>
					</section>
				</div>

				{/* ---------------- entry, set like an RSVP card */}
				<section id="lp-entry" className="px-8 pt-20 pb-8 sm:pt-24">
					<div className="max-w-sm mx-auto">
						<Reveal>
							<div className="flex items-center justify-center gap-3 mb-8">
								<span className="h-px w-10 bg-violet-300" />
								<span className="text-violet-600 text-xs">♥</span>
								<span className="h-px w-10 bg-violet-300" />
							</div>
							<h2
								className="text-center text-3xl text-zinc-900"
								style={{ fontFamily: "var(--font-display-he)" }}
							>
								{t("guest.join.heading")}
							</h2>
							<p className="text-center text-sm text-zinc-500 mt-3 mb-12">
								{t("guest.join.passwordHint")}
							</p>
							<form onSubmit={handleJoin} className="space-y-10">
								<div>
									<label
										htmlFor="lp-phone"
										className="block text-center text-[11px] tracking-[0.3em] text-zinc-500 mb-1"
									>
										{t("guest.join.phoneLabel")}
									</label>
									<input
										id="lp-phone"
										type="tel"
										dir="ltr"
										inputMode="tel"
										value={phone}
										onChange={(e) => setPhone(formatPhone(e.target.value))}
										placeholder="050-1234567"
										required
										autoFocus
										autoComplete="tel"
										className="w-full bg-transparent text-center text-lg text-zinc-900 border-0 border-b border-zinc-300 py-2.5 placeholder:text-zinc-300 transition-colors focus:outline-none focus:border-violet-600 focus:shadow-[0_1px_0_0_#8a6220]"
									/>
								</div>
								<div>
									<label
										htmlFor="lp-name"
										className="block text-center text-[11px] tracking-[0.3em] text-zinc-500 mb-1"
									>
										{t("guest.join.nameLabel")}
									</label>
									<input
										id="lp-name"
										type="text"
										value={name}
										onChange={(e) => setName(e.target.value)}
										placeholder={t("guest.join.namePlaceholder")}
										required
										autoComplete="name"
										className="w-full bg-transparent text-center text-lg text-zinc-900 border-0 border-b border-zinc-300 py-2.5 placeholder:text-zinc-300 transition-colors focus:outline-none focus:border-violet-600 focus:shadow-[0_1px_0_0_#8a6220]"
									/>
								</div>
								<div>
									<label
										htmlFor="lp-password"
										className="block text-center text-[11px] tracking-[0.3em] text-zinc-500 mb-1"
									>
										{t("guest.join.passwordLabel")}
									</label>
									<input
										id="lp-password"
										type="password"
										value={password}
										onChange={(e) => setPassword(e.target.value)}
										required
										autoComplete="current-password"
										className="w-full bg-transparent text-center text-lg text-zinc-900 border-0 border-b border-zinc-300 py-2.5 transition-colors focus:outline-none focus:border-violet-600 focus:shadow-[0_1px_0_0_#8a6220]"
									/>
								</div>

								{joinError && (
									<p className="text-center text-sm text-red-600">{joinError}</p>
								)}

								<Button
									type="submit"
									disabled={isJoining || !isFullName(name) || !phone.trim() || !password}
									className="w-full min-h-12 bg-violet-600 hover:bg-violet-700 text-white text-base font-medium rounded-lg"
								>
									{isJoining ? (
										<Loader2 className="w-5 h-5 animate-spin" />
									) : (
										t("guest.join.submitButton")
									)}
								</Button>
							</form>
						</Reveal>
					</div>
				</section>

				<footer className="pt-16 pb-10 text-center">
					<p
						dir="ltr"
						className="text-[11px] tracking-[0.35em] text-violet-600/60 uppercase"
						style={{ fontFamily: "var(--font-display)" }}
					>
						{EVENT_NAME} · {EVENT_DATE}
					</p>
				</footer>
			</div>
		);
	}


	const viewerPhoto = viewerIndex !== null ? photos[viewerIndex] : null;
	const canLoadMore = !personFilter && photos.length < total;

	return (
		<div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
			<header className="sticky top-0 z-30 bg-zinc-50/90 dark:bg-zinc-950/90 backdrop-blur-md border-b border-zinc-200 dark:border-zinc-800">
				<div className="max-w-[1440px] mx-auto px-3 sm:px-5 py-3 sm:py-4 flex items-center justify-between gap-2 sm:gap-4">
					<div className="flex items-center gap-1.5 sm:gap-3 min-w-0">
						<span className="text-sm text-zinc-600 truncate max-w-36 sm:max-w-56">
							{t("guest.gallery.greeting")}, {session.guest.name.split(" ")[0]}
						</span>
						<button
							onClick={handleLeave}
							className="shrink-0 p-2 sm:p-2.5 min-h-11 text-zinc-400 hover:text-violet-700 transition-colors rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-600"
							title={`${t("guest.gallery.logout")} (${session.guest.name})`}
							aria-label={t("guest.gallery.logout")}
						>
							<LogOut className="w-4 h-4 rtl:rotate-180" />
						</button>
					</div>
					<div className="flex items-center gap-2 sm:gap-3 shrink-0">
						<Wordmark size="sm" />
						<button
							onClick={() => setLocale(locale === "he" ? "en" : "he")}
							className="shrink-0 text-xs font-semibold text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white px-2 py-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
						>
							{locale === "he" ? "EN" : "עברית"}
						</button>
					</div>
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
								className={`p-2 mb-1.5 rounded-lg transition-colors ${galleryLayout === "masonry" ? "text-violet-700 bg-violet-100" : "text-zinc-500 hover:text-violet-700 hover:bg-zinc-100"}`}
							>
								<Columns3 className="w-5 h-5" />
							</button>
							<button
								onClick={() => chooseGalleryLayout("grid")}
								title={t("guest.gallery.layoutGrid")}
								aria-label={t("guest.gallery.layoutGrid")}
								className={`p-2 mb-1.5 rounded-lg transition-colors ${galleryLayout === "grid" ? "text-violet-700 bg-violet-100" : "text-zinc-500 hover:text-violet-700 hover:bg-zinc-100"}`}
							>
								<LayoutGrid className="w-5 h-5" />
							</button>
						<DropdownMenu.Root dir={dir}>
							<DropdownMenu.Trigger asChild>
								<button
									className="p-2 mb-1.5 rounded-lg text-zinc-500 hover:text-violet-700 hover:bg-zinc-100 shrink-0"
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
									className="z-40 min-w-48 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-lg p-1.5 space-y-0.5"
								>
									<DropdownMenu.Item
										onSelect={() => uploadInputRef.current?.click()}
										disabled={uploadProgress !== null}
										className="flex items-center gap-2.5 text-sm text-zinc-700 dark:text-zinc-200 px-3 py-2.5 rounded-lg outline-none data-[highlighted]:bg-zinc-100 dark:data-[highlighted]:bg-zinc-800 cursor-pointer"
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
										className="flex items-center gap-2.5 text-sm text-zinc-700 dark:text-zinc-200 px-3 py-2.5 rounded-lg outline-none data-[highlighted]:bg-zinc-100 dark:data-[highlighted]:bg-zinc-800 cursor-pointer"
									>
										<CheckSquare className="w-4 h-4" />
										{t("guest.gallery.selectionMode")}
									</DropdownMenu.Item>
									{personFilter && photos.length > 0 && (
										<DropdownMenu.Item
											onSelect={() => handleDownloadZip(photos)}
											disabled={isZipping}
											className="flex items-center gap-2.5 text-sm text-zinc-700 dark:text-zinc-200 px-3 py-2.5 rounded-lg outline-none data-[highlighted]:bg-zinc-100 dark:data-[highlighted]:bg-zinc-800 cursor-pointer"
										>
											{isZipping ? (
												<Loader2 className="w-4 h-4 animate-spin" />
											) : (
												<Download className="w-4 h-4" />
											)}
											{t("guest.gallery.downloadAll")}
										</DropdownMenu.Item>
									)}
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
								? "columns-2 sm:columns-3 lg:columns-4 gap-3 sm:gap-4"
								: "grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4"
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
								className={`group relative block w-full cursor-pointer bg-zinc-200 rounded-lg overflow-hidden border focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 transition-all ${galleryLayout === "masonry" ? "mb-3 sm:mb-4 break-inside-avoid" : "aspect-square"} ${isSelecting && selectedIds.includes(photo.id) ? "ring-2 ring-violet-600 border-violet-600 scale-[0.97]" : "border-zinc-200"}`}
							>
								{isSelecting && (
									<span
										className={`absolute top-2 start-2 z-10 w-6 h-6 rounded-full border-2 flex items-center justify-center shadow ${selectedIds.includes(photo.id) ? "bg-violet-600 border-violet-600" : "bg-black/25 border-white/80"}`}
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
									className={`img-fade object-cover transition-transform duration-500 group-hover:scale-105 ${loadedPhotoIds.has(photo.id) ? "img-loaded" : ""} ${galleryLayout === "masonry" ? "w-full h-auto" : "absolute inset-0 w-full h-full"}`}
								/>
								{photo.tags.length > 0 && (
									<span className="absolute bottom-2 start-2 flex items-center gap-1 min-w-0 max-w-[70%] text-[10px] bg-black/50 text-white px-2 py-0.5 rounded-full backdrop-blur-sm">
										<Tag className="w-2.5 h-2.5 shrink-0" />
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
											onClick={() => toggleSelfTag(photo)}
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
									className="mb-3 sm:mb-4 w-full break-inside-avoid rounded-lg bg-zinc-200/70 animate-pulse"
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
			</main>

			{/* ---------------------------------------- floating actions */}
			{!isSelecting && viewerIndex === null && !isSearchOpen && (
				<div className="fixed bottom-5 end-4 sm:end-6 z-40 flex flex-col items-end gap-3">
					<button
						onClick={() => setIsSearchOpen(true)}
						className="flex items-center gap-2.5 h-14 px-5 rounded-full bg-violet-600 hover:bg-violet-700 text-white font-medium shadow-xl transition-colors"
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
					className="fixed bottom-2 inset-x-2 sm:inset-x-auto sm:bottom-4 sm:left-1/2 sm:-translate-x-1/2 sm:min-w-[26rem] z-40 rounded-2xl px-3 py-2.5 shadow-2xl space-y-2"
					style={{ background: "#171311f0" }}
				>
					<div className="flex items-center gap-2">
						<button
							onClick={exitSelection}
							className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10"
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
							className="ms-auto px-3 py-1.5 rounded-lg text-sm text-white/75 hover:text-white hover:bg-white/10"
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
							className="flex flex-col items-center gap-1 py-2.5 rounded-xl text-xs bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40 transition-colors"
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
							className="flex flex-col items-center gap-1 py-2.5 rounded-xl text-xs bg-white/10 text-white/85 hover:bg-white/15 disabled:opacity-40 transition-colors"
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
								onClick={() => toggleSelfTag(viewerPhoto)}
								disabled={isTagging}
								className={`flex flex-col items-center gap-1 py-2.5 rounded-xl text-xs transition-colors ${viewerPhoto.tags.some((tag) => tag.guestId === session.guest.id) ? "bg-violet-600 text-white" : "bg-white/10 text-white/85 hover:bg-white/15"}`}
							>
								<Check className="w-4 h-4" />
								{viewerPhoto.tags.some((tag) => tag.guestId === session.guest.id) ? t("guest.tag.markedMine") : t("guest.tag.markMe")}
							</button>
							<button
								onClick={() =>
									downloadImage(viewerPhoto.viewUrl, `wedding-${viewerPhoto.id}.jpg`)
								}
								className="flex flex-col items-center gap-1 py-2.5 rounded-xl text-xs bg-white/10 text-white/85 hover:bg-white/15 transition-colors"
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
				<div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
					<div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-5 relative">
						<button
							onClick={closeSearch}
							className="absolute top-4 end-4 p-2 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
						>
							<X className="w-5 h-5" />
						</button>

						<div className="text-center">
							<h2
								className="text-2xl text-zinc-900 dark:text-zinc-50"
								style={{ fontFamily: "var(--font-display-he)" }}
							>
								{t("guest.selfieSearch.title")}
							</h2>
							<p className="text-sm text-zinc-500 mt-2">
								{t("guest.selfieSearch.subtitle")}
							</p>
						</div>

						{matches === null ? (
							<>
								{isCameraOpen && !selfie ? (
									<div className="space-y-3">
										<div className="relative w-full aspect-square rounded-2xl overflow-hidden bg-black">
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
												className="flex-1 min-h-11 rounded-lg"
											>
												{t("guest.selfieSearch.cancelButton")}
											</Button>
											<Button
												onClick={takeDesktopPhoto}
												className="flex-1 min-h-11 bg-violet-600 hover:bg-violet-700 text-white rounded-lg"
											>
												{t("guest.selfieSearch.captureButton")}
											</Button>
										</div>
									</div>
								) : selfie ? (
									<div className="text-center space-y-3">
										{/* eslint-disable-next-line @next/next/no-img-element */}
										<img
											src={URL.createObjectURL(selfie)}
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
										<div className="border-2 border-dashed border-violet-200 dark:border-violet-800 rounded-2xl p-10 flex flex-col items-center gap-3 hover:bg-violet-50 dark:hover:bg-violet-950 transition-colors">
											<div className="p-3 bg-violet-100 dark:bg-violet-900 rounded-full text-violet-600 dark:text-violet-400">
												{isMobile ? (
													<Camera className="w-6 h-6" />
												) : (
													<Video className="w-6 h-6" />
												)}
											</div>
											<p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
												{isMobile ? t("guest.selfieSearch.tapToCapture") : t("guest.selfieSearch.clickToCapture")}
											</p>
										</div>
									</div>
								)}

								{!isMobile && !isCameraOpen && !selfie && (
									<label className="block text-center text-xs text-zinc-500 cursor-pointer underline">
										{t("guest.selfieSearch.uploadFromComputer")}
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
									className="w-full min-h-12 bg-violet-600 hover:bg-violet-700 text-white text-base font-medium rounded-lg"
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
									className="rounded-lg min-h-11"
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
									<div className="text-center text-sm bg-violet-50 text-violet-800 rounded-xl px-4 py-3">
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
											className="w-full aspect-square object-cover rounded-lg"
										/>
									))}
								</div>
								<Button
									onClick={handleClaim}
									disabled={isClaiming}
									className="w-full min-h-12 bg-violet-600 hover:bg-violet-700 text-white text-base font-medium rounded-lg"
								>
									{isClaiming ? (
										<Loader2 className="w-5 h-5 animate-spin" />
									) : (
										t("guest.tag.confirmMe")
									)}
								</Button>
								<button
									onClick={() => {
										setMatches(null);
										setSelfie(null);
									}}
									className="block mx-auto text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 underline"
								>
									{t("guest.selfieSearch.searchAgainButton")}
								</button>
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
