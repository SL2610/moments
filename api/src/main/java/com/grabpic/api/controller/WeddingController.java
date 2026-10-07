package com.grabpic.api.controller;

import com.grabpic.api.model.*;
import com.grabpic.api.repository.*;
import com.grabpic.api.service.JobQueueService;
import com.grabpic.api.service.JwtService;
import com.grabpic.api.service.LocalStorageService;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.InputStream;
import java.util.*;
import java.util.stream.Collectors;

/**
 * The guest experience inside one wedding: the shared photo pool, guest
 * uploads, and "this is me / that's them" name tags. The wedding is the
 * album named in the guest token (see GuestEntryController for joining).
 */
@RestController
@RequestMapping("/api/wedding")
public class WeddingController {

    private static final int PAGE_SIZE = 100;

    private final PhotoRepository photoRepository;
    private final GuestRepository guestRepository;
    private final PhotoTagRepository tagRepository;
    private final SharedAlbumRepository albumRepository;
    private final LocalStorageService storage;
    private final JobQueueService jobQueue;
    private final JwtService jwtService;

    public WeddingController(PhotoRepository photoRepository,
                             GuestRepository guestRepository,
                             PhotoTagRepository tagRepository,
                             SharedAlbumRepository albumRepository,
                             LocalStorageService storage,
                             JobQueueService jobQueue,
                             JwtService jwtService) {
        this.photoRepository = photoRepository;
        this.guestRepository = guestRepository;
        this.tagRepository = tagRepository;
        this.albumRepository = albumRepository;
        this.storage = storage;
        this.jobQueue = jobQueue;
        this.jwtService = jwtService;
    }

    /** The wedding this guest token belongs to; null for any other token. */
    static UUID albumOf(Jwt jwt) {
        if (!"guest".equals(jwt.getClaimAsString("typ"))) return null;
        String album = jwt.getClaimAsString("album");
        return album == null ? null : UUID.fromString(album);
    }

    private Map<UUID, String> guestNames(UUID albumId) {
        Map<UUID, String> names = new HashMap<>();
        for (Guest g : guestRepository.findByAlbumId(albumId)) {
            if (g.getName() != null) names.put(g.getId(), g.getName());
        }
        return names;
    }

    // ------------------------------------------------------------------- me

    public record NameRequest(String name) {}

    /** Guests stay anonymous until they upload or tag; then they pick a display name. */
    @PutMapping("/me")
    public ResponseEntity<?> setName(@RequestBody NameRequest request, @AuthenticationPrincipal Jwt jwt) {
        UUID albumId = albumOf(jwt);
        if (albumId == null) return ResponseEntity.status(403).build();
        String name = request.name() == null ? "" : request.name().trim();
        if (name.isEmpty() || name.length() > 80) {
            return ResponseEntity.badRequest().body(Map.of("error", "invalid-name"));
        }
        Guest guest = guestRepository.findById(UUID.fromString(jwt.getSubject())).orElse(null);
        if (guest == null || !albumId.equals(guest.getAlbumId())) return ResponseEntity.status(403).build();
        guest.setName(name);
        guestRepository.save(guest);
        return ResponseEntity.ok(Map.of(
                "accessToken", jwtService.issueGuestToken(guest.getId().toString(), name, albumId.toString()),
                "name", name));
    }

    // ---------------------------------------------------------------- photos

    @GetMapping("/photos")
    public ResponseEntity<?> photos(@RequestParam(defaultValue = "0") int page,
                                    @RequestParam(required = false) UUID person,
                                    @RequestParam(required = false) String source,
                                    @AuthenticationPrincipal Jwt jwt) {
        UUID albumId = albumOf(jwt);
        if (albumId == null) return ResponseEntity.status(403).build();

        List<Photo> photos;
        long total;
        if (person != null) {
            // A person's photos: tagged with them, regardless of access mode.
            List<UUID> photoIds = tagRepository.findByGuestId(person).stream()
                    .map(PhotoTag::getPhotoId).toList();
            photos = photoRepository.findAllById(photoIds).stream()
                    .filter(p -> p.getAlbum().getId().equals(albumId))
                    .sorted(Comparator.comparing(Photo::getCreatedAt,
                            Comparator.nullsFirst(Comparator.naturalOrder())))
                    .toList();
            total = photos.size();
        } else if ("guests".equals(source)) {
            Page<Photo> result = photoRepository.findByAlbumIdAndAccessModeAndUploadedByIsNotNull(
                    albumId, AccessMode.PUBLIC,
                    PageRequest.of(page, PAGE_SIZE, Sort.by("createdAt").descending()));
            photos = result.getContent();
            total = result.getTotalElements();
        } else if ("official".equals(source)) {
            Page<Photo> result = photoRepository.findByAlbumIdAndAccessModeAndUploadedByIsNull(
                    albumId, AccessMode.PUBLIC,
                    PageRequest.of(page, PAGE_SIZE, Sort.by("createdAt").ascending()));
            photos = result.getContent();
            total = result.getTotalElements();
        } else {
            Page<Photo> result = photoRepository.findByAlbumIdAndAccessMode(
                    albumId, AccessMode.PUBLIC,
                    PageRequest.of(page, PAGE_SIZE, Sort.by("createdAt").ascending()));
            photos = result.getContent();
            total = result.getTotalElements();
        }

        List<UUID> ids = photos.stream().map(Photo::getId).toList();
        Map<UUID, List<PhotoTag>> tagsByPhoto = ids.isEmpty() ? Map.of()
                : tagRepository.findByPhotoIdIn(ids).stream()
                        .collect(Collectors.groupingBy(PhotoTag::getPhotoId));
        Map<UUID, String> guestNames = guestNames(albumId);

        List<Map<String, Object>> items = new ArrayList<>();
        for (Photo photo : photos) {
            String key = photo.getStorageUrl();
            Map<String, Object> item = new HashMap<>();
            item.put("id", photo.getId().toString());
            item.put("viewUrl", storage.generateViewUrl(key));
            item.put("previewUrl", storage.generateDerivativeViewUrl(key, "previews"));
            item.put("thumbUrl", storage.generateDerivativeViewUrl(key, "thumbnails"));
            item.put("processed", photo.isProcessed());
            item.put("tags", tagsByPhoto.getOrDefault(photo.getId(), List.of()).stream()
                    .filter(t -> guestNames.containsKey(t.getGuestId()))
                    .map(t -> Map.of(
                            "guestId", t.getGuestId().toString(),
                            "name", guestNames.get(t.getGuestId())))
                    .toList());
            items.add(item);
        }
        long officialTotal = photoRepository.countByAlbumIdAndAccessModeAndUploadedByIsNull(albumId, AccessMode.PUBLIC);
        long guestTotal = photoRepository.countByAlbumIdAndAccessModeAndUploadedByIsNotNull(albumId, AccessMode.PUBLIC);
        return ResponseEntity.ok(Map.of(
                "photos", items,
                "page", page,
                "pageSize", PAGE_SIZE,
                "total", total,
                "officialTotal", officialTotal,
                "guestTotal", guestTotal
        ));
    }

    /** Guest upload into the shared pool. Photos are PUBLIC and face-indexed. */
    @PostMapping("/photos")
    public ResponseEntity<?> uploadPhoto(@RequestParam("file") MultipartFile file,
                                         @AuthenticationPrincipal Jwt jwt) throws Exception {
        UUID albumId = albumOf(jwt);
        if (albumId == null) return ResponseEntity.status(403).build();
        SharedAlbum album = albumRepository.getReferenceById(albumId);

        if (file.isEmpty() || file.getSize() > storage.maxPhotoBytes()) {
            return ResponseEntity.badRequest().body(Map.of("error", "file-too-large"));
        }
        byte[] head = new byte[12];
        try (InputStream in = file.getInputStream()) {
            if (in.readNBytes(head, 0, 12) < 12 || !isSupportedImage(head)) {
                return ResponseEntity.badRequest().body(Map.of("error", "invalid-image"));
            }
        }

        String key = storage.newOriginalKey(album.getId());
        try (InputStream in = file.getInputStream()) {
            storage.save(key, in);
        }

        Photo photo = new Photo();
        photo.setAlbum(album);
        photo.setStorageUrl(key);
        photo.setAccessMode(AccessMode.PUBLIC);
        photo.setProcessed(false);
        photo.setUploadedBy(UUID.fromString(jwt.getSubject()));
        Photo saved = photoRepository.save(photo);
        jobQueue.sendPhotoForProcessing(saved.getId().toString(), key);

        return ResponseEntity.ok(Map.of("id", saved.getId().toString()));
    }

    private static boolean isSupportedImage(byte[] head) {
        if (head[0] == (byte) 0xFF && head[1] == (byte) 0xD8 && head[2] == (byte) 0xFF) return true;
        byte[] png = {(byte) 0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n'};
        if (Arrays.equals(Arrays.copyOf(head, 8), png)) return true;
        return head[0] == 'R' && head[1] == 'I' && head[2] == 'F' && head[3] == 'F'
                && head[8] == 'W' && head[9] == 'E' && head[10] == 'B' && head[11] == 'P';
    }

    // ------------------------------------------------------------------ tags

    public record ClaimRequest(List<UUID> photoIds) {}

    /** "These are me": tags the current guest on all the given photos. */
    @PostMapping("/tags/claim")
    public ResponseEntity<?> claim(@RequestBody ClaimRequest request,
                                   @AuthenticationPrincipal Jwt jwt) {
        UUID albumId = albumOf(jwt);
        if (albumId == null) return ResponseEntity.status(403).build();
        List<UUID> photoIds = request.photoIds() == null ? List.of() : request.photoIds();
        if (photoIds.isEmpty() || photoIds.size() > 500) {
            return ResponseEntity.badRequest().body(Map.of("error", "invalid-photo-list"));
        }
        UUID guestId = UUID.fromString(jwt.getSubject());
        int tagged = 0;
        for (Photo photo : photoRepository.findAllById(photoIds)) {
            if (!photo.getAlbum().getId().equals(albumId)) continue;
            if (addTag(photo.getId(), guestId, guestId)) tagged++;
        }
        return ResponseEntity.ok(Map.of("tagged", tagged));
    }

    private boolean addTag(UUID photoId, UUID guestId, UUID taggedBy) {
        if (tagRepository.existsByPhotoIdAndGuestId(photoId, guestId)) return false;
        PhotoTag tag = new PhotoTag();
        tag.setPhotoId(photoId);
        tag.setGuestId(guestId);
        tag.setTaggedBy(taggedBy);
        try {
            tagRepository.save(tag);
            return true;
        } catch (Exception e) {
            return false; // unique(photo,guest) race
        }
    }

    /** Guests may only remove their own tag. */
    @DeleteMapping("/photos/{photoId}/tags/{guestId}")
    public ResponseEntity<?> removeTag(@PathVariable UUID photoId,
                                       @PathVariable UUID guestId,
                                       @AuthenticationPrincipal Jwt jwt) {
        boolean isSelf = albumOf(jwt) != null && guestId.toString().equals(jwt.getSubject());
        if (!isSelf) {
            return ResponseEntity.status(403).body(Map.of("error", "can-only-untag-self"));
        }
        tagRepository.findByPhotoIdAndGuestId(photoId, guestId).ifPresent(tagRepository::delete);
        return ResponseEntity.ok(Map.of("removed", true));
    }

    /** Tagged people, for the gallery's person filter. */
    @GetMapping("/people")
    public ResponseEntity<?> people(@AuthenticationPrincipal Jwt jwt) {
        UUID albumId = albumOf(jwt);
        if (albumId == null) return ResponseEntity.status(403).build();
        Map<UUID, Long> counts = new HashMap<>();
        for (Object[] row : tagRepository.countByGuest()) {
            counts.put((UUID) row[0], (Long) row[1]);
        }
        List<Map<String, Object>> people = guestRepository.findByAlbumId(albumId).stream()
                .filter(g -> g.getName() != null && counts.containsKey(g.getId()))
                .sorted(Comparator.comparing(Guest::getName))
                .map(g -> Map.<String, Object>of(
                        "id", g.getId().toString(),
                        "name", g.getName(),
                        "photoCount", counts.get(g.getId())))
                .toList();
        return ResponseEntity.ok(people);
    }
}
