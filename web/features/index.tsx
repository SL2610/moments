// Extension points for features built on top of the free core. This file is
// intentionally empty here; WED's private build replaces it with its own.
import type { ReactNode } from "react";
import type { GuestSession, WeddingInfo } from "@/lib/guest";

export interface GuestFeatureContext {
	/** Null while loading; features should render nothing until it arrives. */
	info: WeddingInfo | null;
	session: GuestSession | null;
	/** Joins the wedding if needed, then runs `then`. */
	start: (then: () => void) => void;
	/** Runs `action` once the guest has a display name. */
	withName: (action: () => void) => void;
	/** Photo ids from the guest's latest selfie search, if any. */
	matchedPhotoIds: string[];
	closeSearch: () => void;
}

export interface GuestFeatures {
	/** Under the entry form on the couple's cover page. */
	landing: ReactNode;
	/** Extra items in the gallery's "more" menu (radix DropdownMenu.Item). */
	menuItems: ReactNode;
	/** Under the selfie results. */
	results: ReactNode;
	/** Dialogs and full-screen layers. */
	overlays: ReactNode;
	/** Above the gallery grid. */
	galleryTop: ReactNode;
}

const NO_GUEST_FEATURES: GuestFeatures = { landing: null, menuItems: null, results: null, overlays: null, galleryTop: null };

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature the private build implements
export function useGuestFeatures(_ctx: GuestFeatureContext): GuestFeatures {
	return NO_GUEST_FEATURES;
}

export interface AlbumFeatures {
	/** Extra views for the couple, after "Photos". */
	tabs: { key: string; label: string }[];
	/** The panel for a non-photo tab. */
	panel: (key: string) => ReactNode;
	/** Something to show in the photo grid before photo `index`, in tab `view`. */
	gridInsert: (view: string, index: number) => ReactNode;
	/** Extra sections on the album settings page. */
	settings: ReactNode;
}

const NO_ALBUM_FEATURES: AlbumFeatures = { tabs: [], panel: () => null, gridInsert: () => null, settings: null };

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature the private build implements
export function useAlbumFeatures(_albumId: string, _albumTitle: string): AlbumFeatures {
	return NO_ALBUM_FEATURES;
}
