package com.grabpic.api.controller;

import com.grabpic.api.model.*;
import com.grabpic.api.repository.*;
import com.grabpic.api.service.JobQueueService;
import com.grabpic.api.service.JwtService;
import com.grabpic.api.service.LocalStorageService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.InputStream;
import java.security.MessageDigest;
import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

/**
 * The single-wedding guest experience: shared-password join, the shared photo
 * pool, guest uploads, and "this is me / that's them" name tags.
 *
 * The wedding album is the oldest album in the database (auto-created for the
 * first registered user when missing).
 */
@RestController
@RequestMapping("/api/wedding")
public class WeddingController {

    private static final int PAGE_SIZE = 100;

    private final SharedAlbumRepository albumRepository;
    private final PhotoRepository photoRepository;
    private final GuestRepository guestRepository;
    private final PhotoTagRepository tagRepository;
    private final UserRepository userRepository;
    private final LocalStorageService storage;
    private final JobQueueService jobQueue;
    private final JwtService jwtService;
    private final String guestPassword;
    private final String eventName;

    public WeddingController(SharedAlbumRepository albumRepository,
                             PhotoRepository photoRepository,
                             GuestRepository guestRepository,
                             PhotoTagRepository tagRepository,
                             UserRepository userRepository,
                             LocalStorageService storage,
                             JobQueueService jobQueue,
                             JwtService jwtService,
                             @Value("${wedding.guest-password:}") String guestPassword,
                             @Value("${wedding.event-name:Your Names Here}") String eventName) {
        this.albumRepository = albumRepository;
        this.photoRepository = photoRepository;
        this.guestRepository = guestRepository;
        this.tagRepository = tagRepository;
        this.userRepository = userRepository;
        this.storage = storage;
        this.jobQueue = jobQueue;
        this.jwtService = jwtService;
        this.guestPassword = guestPassword == null ? "" : guestPassword.trim();
        this.eventName = eventName;
    }

    private Optional<SharedAlbum> weddingAlbum() {
        List<SharedAlbum> albums = albumRepository.findAll(Sort.by("createdAt").ascending());
        if (!albums.isEmpty()) return Optional.of(albums.get(0));

        // First call before any album exists: create it for the first user.
        return userRepository.findAll().stream().findFirst().map(owner -> {
            SharedAlbum album = new SharedAlbum();
            album.setTitle(eventName);
            album.setHostId(owner.getId().toString());
            return albumRepository.save(album);
        });
    }

    private boolean isGuestOrAdmin(Jwt jwt) {
        String typ = jwt.getClaimAsString("typ");
        return "guest".equals(typ) || "access".equals(typ);
    }

    // ------------------------------------------------------------------ join

    public record JoinRequest(String name, String phone, String password) {}

    /** Strips separators; accepts 9-15 digits with optional leading +. Returns null if invalid. */
    private static String normalizePhone(String raw) {
        if (raw == null) return null;
        String phone = raw.replaceAll("[\\s\\-()]", "");
        return phone.matches("^\\+?\\d{9,15}$") ? phone : null;
    }

    /** Requires first + last name so guests stay uniquely identifiable when self-tagging. */
    private static boolean isFullName(String name) {
        long words = Arrays.stream(name.split("\\s+")).filter(w -> w.length() >= 2).count();
        return words >= 2;
    }

    // Unauthenticated: reveals only readiness, never the album id.
    @GetMapping
    public ResponseEntity<?> weddingInfo() {
        return ResponseEntity.ok(Map.of(
                "eventName", eventName,
                "ready", weddingAlbum().isPresent()
        ));
    }

    @PostMapping("/join")
    public ResponseEntity<?> join(@RequestBody JoinRequest request) {
        if (guestPassword.isEmpty()) {
            return ResponseEntity.status(503).body(Map.of("error", "Guest access is not configured (GUEST_PASSWORD)."));
        }
        String password = request.password() == null ? "" : request.password().trim();
        if (!MessageDigest.isEqual(password.getBytes(), guestPassword.getBytes())) {
            return ResponseEntity.status(401).body(Map.of("error", "wrong-password"));
        }
        String name = request.name() == null ? "" : request.name().trim();
        if (name.length() > 80 || !isFullName(name)) {
            return ResponseEntity.badRequest().body(Map.of("error", "invalid-name"));
        }
        String phone = normalizePhone(request.phone());
        if (phone == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "invalid-phone"));
        }
        Optional<SharedAlbum> albumOpt = weddingAlbum();
        if (albumOpt.isEmpty()) {
            return ResponseEntity.status(503).body(Map.of("error", "The wedding album is not set up yet."));
        }

        Optional<Guest> existingByPhone = guestRepository.findByPhone(phone);
        if (existingByPhone.isPresent() && !existingByPhone.get().getName().equalsIgnoreCase(name)) {
            return ResponseEntity.status(409).body(Map.of(
                    "error", "phone-name-mismatch",
                    "existingName", existingByPhone.get().getName()
            ));
        }

        Guest guest = joinGuest(name, phone);
        return ResponseEntity.ok(Map.of(
                "accessToken", jwtService.issueGuestToken(guest.getId().toString(), guest.getName()),
                "guest", Map.of("id", guest.getId().toString(), "name", guest.getName()),
                "albumId", albumOpt.get().getId().toString(),
                "eventName", eventName
        ));
    }

    /**
     * The phone number is the identity: same phone = same guest, name locked on first join
     * (the caller already rejects a mismatched name before this is called).
     * A guest previously created by name-tagging (no phone) is claimed on first
     * join with a matching name, so their tags carry over.
     */
    private Guest joinGuest(String name, String phone) {
        Optional<Guest> byPhone = guestRepository.findByPhone(phone);
        if (byPhone.isPresent()) {
            return byPhone.get();
        }
        Optional<Guest> taggedOnly =
                guestRepository.findFirstByNameIgnoreCaseAndPhoneIsNullOrderByCreatedAtAsc(name);
        if (taggedOnly.isPresent()) {
            Guest guest = taggedOnly.get();
            guest.setPhone(phone);
            guestRepository.save(guest);
            return guest;
        }
        Guest guest = new Guest();
        guest.setName(name);
        guest.setPhone(phone);
        try {
            return guestRepository.save(guest);
        } catch (Exception e) {
            // concurrent join with the same phone
            return guestRepository.findByPhone(phone).orElseThrow();
        }
    }

    // ---------------------------------------------------------------- photos

    @GetMapping("/photos")
    public ResponseEntity<?> photos(@RequestParam(defaultValue = "0") int page,
                                    @RequestParam(required = false) UUID person,
                                    @RequestParam(required = false) String source,
                                    @AuthenticationPrincipal Jwt jwt) {
        if (!isGuestOrAdmin(jwt)) return ResponseEntity.status(403).build();
        Optional<SharedAlbum> albumOpt = weddingAlbum();
        if (albumOpt.isEmpty()) return ResponseEntity.status(503).build();
        UUID albumId = albumOpt.get().getId();

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
        Map<UUID, String> guestNames = guestRepository.findAll().stream()
                .collect(Collectors.toMap(Guest::getId, Guest::getName));

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
                    .map(t -> Map.of(
                            "guestId", t.getGuestId().toString(),
                            "name", guestNames.getOrDefault(t.getGuestId(), "?")))
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
        if (!isGuestOrAdmin(jwt)) return ResponseEntity.status(403).build();
        Optional<SharedAlbum> albumOpt = weddingAlbum();
        if (albumOpt.isEmpty()) return ResponseEntity.status(503).build();
        SharedAlbum album = albumOpt.get();

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
        if (!"guest".equals(jwt.getClaimAsString("typ"))) return ResponseEntity.status(403).build();
        List<UUID> photoIds = request.photoIds() == null ? List.of() : request.photoIds();
        if (photoIds.isEmpty() || photoIds.size() > 500) {
            return ResponseEntity.badRequest().body(Map.of("error", "invalid-photo-list"));
        }
        UUID guestId = UUID.fromString(jwt.getSubject());
        int tagged = 0;
        for (Photo photo : photoRepository.findAllById(photoIds)) {
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

    /** Guests may only remove their own tag; admins can remove any. */
    @DeleteMapping("/photos/{photoId}/tags/{guestId}")
    public ResponseEntity<?> removeTag(@PathVariable UUID photoId,
                                       @PathVariable UUID guestId,
                                       @AuthenticationPrincipal Jwt jwt) {
        String typ = jwt.getClaimAsString("typ");
        boolean isAdmin = "access".equals(typ);
        boolean isSelf = "guest".equals(typ) && guestId.toString().equals(jwt.getSubject());
        if (!isAdmin && !isSelf) {
            return ResponseEntity.status(403).body(Map.of("error", "can-only-untag-self"));
        }
        tagRepository.findByPhotoIdAndGuestId(photoId, guestId).ifPresent(tagRepository::delete);
        return ResponseEntity.ok(Map.of("removed", true));
    }

    /** Tagged people, for the gallery's person filter. */
    @GetMapping("/people")
    public ResponseEntity<?> people(@AuthenticationPrincipal Jwt jwt) {
        if (!isGuestOrAdmin(jwt)) return ResponseEntity.status(403).build();
        Map<UUID, Long> counts = new HashMap<>();
        for (Object[] row : tagRepository.countByGuest()) {
            counts.put((UUID) row[0], (Long) row[1]);
        }
        List<Map<String, Object>> people = guestRepository.findAll().stream()
                .filter(g -> counts.containsKey(g.getId()))
                .sorted(Comparator.comparing(Guest::getName))
                .map(g -> Map.<String, Object>of(
                        "id", g.getId().toString(),
                        "name", g.getName(),
                        "photoCount", counts.get(g.getId())))
                .toList();
        return ResponseEntity.ok(people);
    }
}
