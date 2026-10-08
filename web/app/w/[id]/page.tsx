"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
	Camera,
	BookOpen,
	Check,
	CheckSquare,
	ChevronLeft,
	Columns3,
	Download,
	Images,
	LayoutGrid,
	Loader2,
	Share2,
	Menu,
	Plus,
	Tag,
	UserSearch,
	X,
} from "lucide-react";
import { BarAction, ChampagneRule, CoupleMark, Finding, GuestBar, Lockup, SelfieTips, Viewer, WeddingStory } from "./screens";
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

const MAX_PHOTO_MB = Number(process.env.NEXT_PUBLIC_MAX_PHOTO_MB || "30");

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

	// viewer: over the gallery, or over the selfie results when viewerList is set
	const [viewerIndex, setViewerIndex] = useState<number | null>(null);
	const [viewerList, setViewerList] = useState<Photo[] | null>(null);
	const viewing = viewerList ?? photos;
	// hearted photos, by id only: view URLs are signed and expire
	const [favorites, setFavorites] = useState<string[]>([]);
	useEffect(() => {
		setFavorites(JSON.parse(localStorage.getItem(`wed.favorites.${publicId}`) || "[]"));
	}, [publicId]);
	const toggleFavorite = (photoId: string) => {
		const next = favorites.includes(photoId) ? favorites.filter((f) => f !== photoId) : [...favorites, photoId];
		setFavorites(next);
		localStorage.setItem(`wed.favorites.${publicId}`, JSON.stringify(next));
	};
	const loadMoreRef = useRef<HTMLDivElement>(null);
	const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const longPressFired = useRef(false);
	const longPressStart = useRef<{ x: number; y: number } | null>(null);
	const [isTagging, setIsTagging] = useState(false);

	// selfie search
	const [isSearchOpen, setIsSearchOpen] = useState(false);
	const [isSearching, setIsSearching] = useState(false);
	const [searchError, setSearchError] = useState("");
	const [matches, setMatches] = useState<Photo[] | null>(null);
	const [isClaiming, setIsClaiming] = useState(false);
	// "all", or a chapter key from features.groups
	const [resultTab, setResultTab] = useState("all");
	const [storyOpen, setStoryOpen] = useState(false);
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
			if (e.key === "Escape") {
				setViewerIndex(null);
				setViewerList(null);
			}
			else if (e.key === "ArrowRight" && viewerIndex < viewing.length - 1)
				setViewerIndex(viewerIndex + 1);
			else if (e.key === "ArrowLeft" && viewerIndex > 0)
				setViewerIndex(viewerIndex - 1);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [viewerIndex, viewing.length]);

	// lock background scroll while a fullscreen overlay is open, so the
	// mobile keyboard opening (e.g. the tag input) doesn't scroll/shift
	// the page behind the fixed overlay
	useEffect(() => {
		if (viewerIndex === null && !isSearchOpen && !storyOpen) return;
		const { overflow } = document.body.style;
		document.body.style.overflow = "hidden";
		return () => {
			document.body.style.overflow = overflow;
		};
	}, [viewerIndex, isSearchOpen, storyOpen]);

	// preload the neighboring previews for instant next/prev
	useEffect(() => {
		if (viewerIndex === null) return;
		for (const i of [viewerIndex - 1, viewerIndex + 1]) {
			const photo = viewing[i];
			if (photo) {
				const img = new window.Image();
				img.src = photo.previewUrl || photo.viewUrl;
			}
		}
	}, [viewerIndex, viewing]);

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

	// Once refused, the shutter falls back to the phone's own camera picker instead of asking again.
	const [cameraDenied, setCameraDenied] = useState(false);
	const startCamera = async () => {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: "user" },
				audio: false,
			});
			streamRef.current = stream;
			setIsCameraOpen(true);
		} catch {
			setCameraDenied(true);
			if (!isMobile) setSearchError(t("guest.selfieSearch.cameraError"));
		}
	};

	const onSelfieScreen = isSearchOpen && !isSearching && matches === null;
	useEffect(() => {
		if (onSelfieScreen && !isCameraOpen && !cameraDenied) startCamera();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [onSelfieScreen, cameraDenied]);

	const takePhoto = () => {
		if (!videoRef.current) return;
		const canvas = document.createElement("canvas");
		canvas.width = videoRef.current.videoWidth;
		canvas.height = videoRef.current.videoHeight;
		canvas.getContext("2d")?.drawImage(videoRef.current, 0, 0);
		canvas.toBlob(
			(blob) => {
				if (blob) {
					stopCamera();
					handleSearch(new File([blob], "selfie.jpg", { type: "image/jpeg" }));
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

	/** Runs as soon as a selfie is taken or picked: there is nothing to confirm. */
	const handleSearch = async (selfie: File) => {
		if (!session) return;
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
		setViewerList(null);
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

	/** Fresh photo details (signed URLs) for ids, in the ids' order; the endpoint takes 500 at a time. */
	const photosById = useCallback(
		async (ids: string[]): Promise<Photo[]> => {
			if (!session || ids.length === 0) return [];
			const chunks = Array.from({ length: Math.ceil(ids.length / 500) }, (_, i) => ids.slice(i * 500, i * 500 + 500));
			const found = new Map<string, Photo>();
			for (const chunk of chunks) {
				const res = await guestFetch(`/api/albums/${session.albumId}/guest/search-results`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(chunk),
				});
				if (!res.ok) continue;
				for (const p of await res.json()) found.set(p.id, { ...p, tags: [] });
			}
			return ids.flatMap((id) => found.get(id) ?? []);
		},
		[session],
	);

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

	const closeViewer = () => {
		setViewerIndex(null);
		setViewerList(null);
	};

	/** One photo to the phone's share sheet (save to Photos lives there); a download elsewhere. */
	const sharePhoto = async (photo: Photo) => {
		try {
			const blob = await fetchImageAsBlob(photo.viewUrl);
			const file = new File([blob], `wedding-${photo.id}.jpg`, { type: blob.type || "image/jpeg" });
			if (navigator.canShare?.({ files: [file] })) {
				await navigator.share({ files: [file] });
				return;
			}
		} catch (err) {
			if ((err as DOMException)?.name === "AbortError") return;
		}
		downloadImage(photo.viewUrl, `wedding-${photo.id}.jpg`);
	};

	const pickSelfie = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		e.target.value = "";
		if (!file) return;
		stopCamera();
		handleSearch(file);
	};

	const downloadFavorites = async () => {
		if (favorites.length > 0) await handleDownloadZip(await photosById(favorites));
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
				<p className="mt-3 mb-16 max-w-xs text-zinc-500">{t("guest.landing.notFoundBody")}</p>
				<div className="w-full max-w-xs">
					<Lockup />
				</div>
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
			<div className="relative min-h-[100svh] flex flex-col bg-zinc-50 overflow-hidden">
				{/* The couple's cover, full-bleed and washed toward the text, in WED's frame. */}
				{info.coverUrl && (
					<>
						{/* eslint-disable-next-line @next/next/no-img-element */}
						<img src={info.coverUrl} alt="" className="develop absolute inset-0 w-full h-full object-cover object-[65%_center]" />
						{/* Any couple's photo can sit here, so the wash guarantees the text, whatever the picture. */}
						<div aria-hidden className="absolute inset-0 bg-gradient-to-r rtl:bg-gradient-to-l from-zinc-50 from-10% via-zinc-50/75 via-45% to-zinc-50/0" />
						<div aria-hidden className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-zinc-50 via-zinc-50/60 to-transparent" />
					</>
				)}

				<GuestBar
					className="relative border-b border-zinc-900/10"
					start={<CoupleMark names={info.eventName} />}
					end={<span className="text-zinc-900">{langToggle}</span>}
				/>

				<main className="relative flex-1 w-full max-w-6xl mx-auto px-6 sm:px-10 flex flex-col justify-end pb-10 pt-24">
					<div className="max-w-md">
						{dateMeta && <p className="lp-fade meta text-zinc-600" dir="ltr">{dateMeta}</p>}
						<h1
							className="lp-rise mt-4 text-[clamp(3.6rem,17vw,6.5rem)] leading-[0.95] tracking-[-0.025em] text-zinc-900"
							style={{ fontFamily: "var(--font-display)", animationDelay: "200ms" }}
						>
							{info.eventName}
						</h1>
						<p className="lp-rise mt-6 max-w-[19rem] text-lg leading-relaxed text-zinc-700" style={{ animationDelay: "450ms" }}>
							{t("guest.landing.tagline")}
						</p>

						<form
							onSubmit={(e) => {
								e.preventDefault();
								handleStart("selfie");
							}}
							className="lp-rise mt-8 space-y-3"
							style={{ animationDelay: "600ms" }}
						>
							{info.passwordRequired && (
								<div className="max-w-xs">
									<label htmlFor="lp-password" className="block text-sm text-zinc-700 mb-1.5">
										{t("guest.join.passwordLabel")}
									</label>
									<input
										id="lp-password"
										type="password"
										value={password}
										onChange={(e) => setPassword(e.target.value)}
										required
										autoComplete="current-password"
										className="w-full h-[52px] rounded-[2px] bg-white/90 px-4 text-base text-zinc-900 border border-zinc-300 focus:outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900"
									/>
									<p className="mt-1.5 text-sm text-zinc-600">{t("guest.join.passwordHint")}</p>
								</div>
							)}
							{joinError && <p role="alert" className="text-sm text-red-700">{joinError}</p>}
							<button
								type="submit"
								disabled={isJoining}
								className="h-14 min-w-[15rem] rounded-[2px] bg-zinc-900 text-zinc-50 text-base inline-flex items-center justify-center gap-3 px-8 transition-colors hover:bg-violet-600 disabled:opacity-60"
							>
								{isJoining ? (
									<Loader2 className="w-5 h-5 animate-spin" />
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
								className="block min-h-11 text-zinc-700 underline underline-offset-[6px] decoration-zinc-400 hover:decoration-zinc-900"
							>
								{t("guest.landing.seeAlbum")}
							</button>
						</form>
						{features.landing}
					</div>
				</main>

				<footer className="relative w-full max-w-6xl mx-auto px-6 sm:px-10 pb-8">
					<Lockup />
				</footer>
			</div>
		);
	}

	const viewerPhoto = viewerIndex !== null ? viewing[viewerIndex] : null;
	// Result tabs: every chapter the guest appears in, after "All photos".
	const resultTabs = [
		{ key: "all", label: t("guest.results.allTab") },
		...features.groups.filter((g) => matches?.some((m) => g.photoIds.includes(m.id))),
	];
	const tabGroup = features.groups.find((g) => g.key === resultTab);
	const shownMatches = tabGroup ? (matches ?? []).filter((m) => tabGroup.photoIds.includes(m.id)) : (matches ?? []);
	const canLoadMore = !personFilter && photos.length < total;

	return (
		<div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
			<header className="sticky top-0 z-30 bg-zinc-50 border-b border-zinc-200">
				<GuestBar
					className="max-w-[1440px] mx-auto"
					start={<CoupleMark names={info.eventName} />}
					end={
						<>
							{favorites.length > 0 && (
								<BarAction onClick={downloadFavorites} disabled={isZipping} busy={isZipping}>
									{t("guest.gallery.downloadSelected").replace("{count}", String(favorites.length))}
								</BarAction>
							)}
						<DropdownMenu.Root dir={dir}>
							<DropdownMenu.Trigger asChild>
								<button
									className="p-2 -me-2 text-zinc-800 hover:text-zinc-950"
									aria-label={t("guest.gallery.moreActions")}
								>
									<Menu className="w-6 h-6" strokeWidth={1.25} />
								</button>
							</DropdownMenu.Trigger>
							<DropdownMenu.Portal>
								<DropdownMenu.Content
									align="end"
									sideOffset={6}
									collisionPadding={12}
									className="z-40 min-w-52 bg-[#fbf9f5] border border-zinc-300 p-1.5 space-y-0.5 shadow-[0_18px_40px_-20px_rgba(25,25,23,0.5)]"
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
									{features.groups.length > 0 && (
										<DropdownMenu.Item onSelect={() => setStoryOpen(true)} className="flex items-center gap-2.5 text-sm text-zinc-700 dark:text-zinc-200 px-3 py-2.5 rounded-[2px] outline-none data-[highlighted]:bg-zinc-100 dark:data-[highlighted]:bg-zinc-800 cursor-pointer">
											<BookOpen className="w-4 h-4" />
											{t("guest.story.title")}
										</DropdownMenu.Item>
									)}
									{features.menuItems}
									<DropdownMenu.Item onSelect={() => setLocale(locale === "he" ? "en" : "he")} lang={locale === "he" ? "en" : "he"} className="flex items-center gap-2.5 text-sm text-zinc-700 dark:text-zinc-200 px-3 py-2.5 rounded-[2px] outline-none data-[highlighted]:bg-zinc-100 dark:data-[highlighted]:bg-zinc-800 cursor-pointer">
										{locale === "he" ? "English" : "עברית"}
									</DropdownMenu.Item>
								</DropdownMenu.Content>
							</DropdownMenu.Portal>
						</DropdownMenu.Root>
						</>
					}
				/>
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
									className={`pb-2.5 sm:pb-3 border-b-2 -mb-px whitespace-nowrap text-sm sm:text-base transition-colors ${active ? "border-champagne text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-800"}`}
								>
									{label}
									<span className={`ms-2 text-xs ${active ? "text-[#7a6442]" : "text-zinc-400"}`}>
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
								className={`p-2 mb-1.5 rounded-[2px] transition-colors ${galleryLayout === "masonry" ? "text-zinc-900" : "text-zinc-400 hover:text-zinc-900"}`}
							>
								<Columns3 className="w-5 h-5" />
							</button>
							<button
								onClick={() => chooseGalleryLayout("grid")}
								title={t("guest.gallery.layoutGrid")}
								aria-label={t("guest.gallery.layoutGrid")}
								className={`p-2 mb-1.5 rounded-[2px] transition-colors ${galleryLayout === "grid" ? "text-zinc-900" : "text-zinc-400 hover:text-zinc-900"}`}
							>
								<LayoutGrid className="w-5 h-5" />
							</button>
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
								className={`group relative block w-full cursor-pointer bg-[#f3efe9] overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 transition-all ${galleryLayout === "masonry" ? "mb-2 sm:mb-3 break-inside-avoid" : "aspect-square"} ${isSelecting && selectedIds.includes(photo.id) ? "ring-2 ring-violet-600 border-violet-600 scale-[0.97]" : "border-zinc-200"}`}
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
					<div className="max-w-md mx-auto py-12">
						<Lockup />
					</div>
				)}
			</main>

			{/* ---------------------------------------- floating actions */}
			{!isSelecting && viewerIndex === null && !isSearchOpen && !storyOpen && (
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
					style={{ background: "#11100ff0" }}
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

			{/* ------------------------------------- selfie, finding, results: full screens */}
			{isSearchOpen &&
				(isSearching ? (
					<Finding names={info.eventName} prints={photos.slice(0, 4)} />
				) : matches === null ? (
					<div role="dialog" aria-modal="true" aria-labelledby="search-title" className="fixed inset-0 z-50 overflow-y-auto bg-zinc-50 flex flex-col">
						<GuestBar
							start={
								<button onClick={closeSearch} aria-label={t("guest.back")} className="p-2 -ms-2 text-zinc-800 hover:text-zinc-950">
									<ChevronLeft className="w-6 h-6 rtl:rotate-180" strokeWidth={1.25} />
								</button>
							}
							center={<CoupleMark names={info.eventName} />}
							end={<ChampagneRule />}
						/>
						<main className="flex-1 w-full max-w-md mx-auto px-6 pb-8 flex flex-col">
							<h2 id="search-title" className="mt-6 text-[clamp(2.4rem,11vw,3rem)] leading-[1.05] tracking-[-0.02em] text-zinc-900" style={{ fontFamily: "var(--font-display)" }}>
								{t("guest.selfie.title")}
							</h2>
							<p className="mt-2 max-w-[19rem] text-zinc-600">{t("guest.selfie.body")}</p>

							{/* the viewfinder: crop marks around a face guide */}
							<div className="crop crop-flip mt-8 mx-3">
								<div className="relative aspect-[4/5] overflow-hidden bg-[#f3efe9]">
									{isCameraOpen && (
										<video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover scale-x-[-1]" />
									)}
									<div aria-hidden className="absolute inset-0 flex items-center justify-center">
										<div className={`h-[64%] aspect-[3/4] rounded-[50%] border border-dashed ${isCameraOpen ? "border-white/90" : "border-zinc-500/50"}`} />
									</div>
								</div>
							</div>

							<div className="mt-7 flex justify-center">
								{isMobile && !isCameraOpen ? (
									<label aria-label={t("guest.selfie.shutter")} className="w-16 h-16 rounded-full bg-zinc-900 text-zinc-50 flex items-center justify-center cursor-pointer transition-colors hover:bg-violet-600 focus-within:ring-2 focus-within:ring-zinc-900 focus-within:ring-offset-2">
										<Camera className="w-6 h-6" strokeWidth={1.5} />
										<input type="file" accept="image/*" capture="user" className="sr-only" onChange={pickSelfie} />
									</label>
								) : (
									<button
										onClick={isCameraOpen ? takePhoto : startCamera}
										aria-label={t("guest.selfie.shutter")}
										className="w-16 h-16 rounded-full bg-zinc-900 text-zinc-50 flex items-center justify-center transition-colors hover:bg-violet-600"
									>
										<Camera className="w-6 h-6" strokeWidth={1.5} />
									</button>
								)}
							</div>

							<div className="mt-8">
								<SelfieTips />
							</div>

							{searchError && <p role="alert" className="mt-6 text-sm text-red-700 text-center">{searchError}</p>}

							<label className="mt-8 self-center min-h-11 inline-flex items-center text-zinc-800 underline underline-offset-[6px] decoration-zinc-300 hover:decoration-zinc-900 cursor-pointer">
								{t("guest.selfieSearch.choosePhoto")}
								<input type="file" accept="image/*" className="sr-only" onChange={pickSelfie} />
							</label>
							<p className="mt-6 text-xs text-zinc-500 text-center">{t("guest.selfieSearch.privacyNote")}</p>
						</main>
					</div>
				) : (
					<div role="dialog" aria-modal="true" aria-labelledby="results-title" className="fixed inset-0 z-50 overflow-y-auto bg-zinc-50">
						<GuestBar
							className="sticky top-0 z-10 bg-zinc-50"
							start={<CoupleMark names={info.eventName} />}
							end={
								<>
									{matches.length > 0 && (
										<BarAction onClick={() => handleDownloadZip(matches)} disabled={isZipping} busy={isZipping}>
											{t("guest.gallery.downloadAll")}
										</BarAction>
									)}
									<button onClick={closeSearch} aria-label={t("guest.results.toAlbum")} className="p-2 -me-2 text-zinc-800 hover:text-zinc-950">
										<X className="w-6 h-6" strokeWidth={1.25} />
									</button>
								</>
							}
						/>
						<main className="max-w-3xl mx-auto px-5 sm:px-8 pb-14">
							{matches.length === 0 ? (
								<div className="pt-10 max-w-md">
									<h2 id="results-title" className="text-[clamp(2.1rem,9vw,3rem)] leading-[1.08] tracking-[-0.02em] text-zinc-900" style={{ fontFamily: "var(--font-display)" }}>
										{t("guest.selfieSearch.noMatchTitle")}
									</h2>
									<p className="mt-4 text-zinc-600">
										{searchSessionId ? t("guest.selfieSearch.noMatchRetryWithSession") : t("guest.selfieSearch.noMatchRetryFresh")}
									</p>
									<button onClick={() => setMatches(null)} className="mt-8 h-14 px-8 rounded-[2px] bg-zinc-900 text-zinc-50 hover:bg-violet-600 transition-colors">
										{t("guest.selfieSearch.tryAgainButton")}
									</button>
								</div>
							) : (
								<>
									<h2 id="results-title" className="mt-6 text-[clamp(2.1rem,9vw,3.2rem)] leading-[1.08] tracking-[-0.02em] text-zinc-900" style={{ fontFamily: "var(--font-display)" }}>
										{t("guest.results.title").replace("{count}", matches.length.toLocaleString(locale === "he" ? "he-IL" : "en-US"))}
									</h2>
									<p className="mt-2 text-lg text-zinc-600">{t("guest.results.body")}</p>
									{needsSecondSelfie && (
										<p className="mt-6 border-s border-champagne ps-4 text-sm text-zinc-700">
											{t("guest.selfieSearch.needsSecondSelfieHint")}{" "}
											<button onClick={() => setMatches(null)} className="underline underline-offset-4">
												{t("guest.selfieSearch.anotherPhotoButton")}
											</button>
										</p>
									)}
									{resultTabs.length > 1 && (
										<nav className="mt-7 flex gap-6 overflow-x-auto border-b border-zinc-200 [scrollbar-width:none]" aria-label={t("guest.gallery.tabsAriaLabel")}>
											{resultTabs.map((tab) => (
												<button
													key={tab.key}
													onClick={() => setResultTab(tab.key)}
													aria-pressed={resultTab === tab.key}
													className={`pb-2.5 -mb-px border-b whitespace-nowrap text-sm transition-colors ${resultTab === tab.key ? "border-champagne text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-800"}`}
												>
													{tab.label}
												</button>
											))}
										</nav>
									)}
									<ul className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-2">
										{shownMatches.map((photo, i) => (
											<li key={photo.id}>
												<button
													onClick={() => {
														setViewerList(shownMatches);
														setViewerIndex(i);
													}}
													className="block w-full aspect-[4/5] overflow-hidden bg-[#f3efe9] focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
												>
													{/* eslint-disable-next-line @next/next/no-img-element */}
													<img src={photo.thumbUrl || photo.viewUrl} alt="" loading="lazy" className="w-full h-full object-cover object-[center_20%] transition-transform duration-500 hover:scale-[1.03]" />
												</button>
											</li>
										))}
									</ul>
									<div className="mt-10 flex flex-wrap items-center gap-x-7 gap-y-3">
										<button
											onClick={() => withName(handleClaim)}
											disabled={isClaiming}
											className="h-14 px-8 rounded-[2px] bg-zinc-900 text-zinc-50 hover:bg-violet-600 transition-colors disabled:opacity-60"
										>
											{isClaiming ? <Loader2 className="w-5 h-5 animate-spin" /> : t("guest.selfieSearch.addToMine")}
										</button>
										<button onClick={shareOnWhatsApp} className="min-h-11 inline-flex items-center gap-2 text-zinc-800 underline underline-offset-[6px] decoration-zinc-300 hover:decoration-zinc-900">
											<Share2 className="w-4 h-4" />
											{t("guest.selfieSearch.shareWhatsApp")}
										</button>
										<button onClick={() => setMatches(null)} className="min-h-11 text-zinc-600 underline underline-offset-[6px] decoration-zinc-300 hover:decoration-zinc-900">
											{t("guest.selfieSearch.searchAgainButton")}
										</button>
									</div>
									{features.results}
								</>
							)}
						</main>
					</div>
				))}

			{storyOpen && (
				<WeddingStory
					names={info.eventName}
					groups={features.groups}
					load={photosById}
					onClose={() => setStoryOpen(false)}
					onOpenPhoto={(list, i) => {
						setViewerList(list as Photo[]);
						setViewerIndex(i);
					}}
					topAction={
						favorites.length > 0 && (
							<BarAction onClick={downloadFavorites} disabled={isZipping} busy={isZipping}>
								{t("guest.gallery.downloadSelected").replace("{count}", String(favorites.length))}
							</BarAction>
						)
					}
				/>
			)}

			{/* -------------------------------------------------- photo viewer */}
			{viewerPhoto && viewerIndex !== null && (
				<Viewer
					list={viewing}
					index={viewerIndex}
					total={viewerList ? viewerList.length : total}
					onIndex={setViewerIndex}
					onClose={closeViewer}
					isFavorite={favorites.includes(viewerPhoto.id)}
					onFavorite={() => toggleFavorite(viewerPhoto.id)}
					onShare={() => sharePhoto(viewerPhoto)}
					extra={
						viewerList ? undefined : (
							<>
								{viewerPhoto.tags.map((tag) => (
									<span key={tag.guestId} className="flex items-center gap-1.5 text-xs bg-white/12 text-white/90 px-3 py-1 rounded-full">
										{tag.name}
										{tag.guestId === session.guest.id && (
											<button onClick={() => removeTag(viewerPhoto.id, tag.guestId)} className="text-white/50 hover:text-white" title={t("guest.viewer.removeTagTitle")}>
												<X className="w-3 h-3" />
											</button>
										)}
									</span>
								))}
								{!viewerPhoto.tags.some((tag) => tag.guestId === session.guest.id) && (
									<button
										onClick={() => withName(() => toggleSelfTag(viewerPhoto))}
										disabled={isTagging}
										className="flex items-center gap-1.5 text-xs border border-white/25 text-white/85 hover:text-white px-3 py-1 rounded-full"
									>
										<Check className="w-3 h-3" />
										{t("guest.tag.markMe")}
									</button>
								)}
							</>
						)
					}
				/>
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
							className="w-full h-12 rounded-[2px] border border-zinc-300 bg-white px-4 text-base focus:outline-none focus:border-violet-600 focus:ring-1 focus:ring-violet-600"
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
