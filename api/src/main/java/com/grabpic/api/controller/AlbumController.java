package com.grabpic.api.controller;

import com.grabpic.api.dto.PhotoSaveRequest;
import com.grabpic.api.model.AccessMode;
import com.grabpic.api.model.Photo;
import com.grabpic.api.model.SharedAlbum;
import com.grabpic.api.repository.PhotoRepository;
import com.grabpic.api.repository.SharedAlbumRepository;
import com.grabpic.api.service.JobQueueService;
import com.grabpic.api.service.LocalStorageService;
import com.grabpic.api.service.TurnstileService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;

@RestController
@RequestMapping("/api/albums")
public class AlbumController {

    private final LocalStorageService storageService;
    private final SharedAlbumRepository albumRepository;
    private final PhotoRepository photoRepository;
    private final JobQueueService jobQueueService;
    private final TurnstileService turnstileService;
    private final long maxPhotosPerUser;

    public AlbumController(LocalStorageService storageService,
                           SharedAlbumRepository albumRepository,
                           PhotoRepository photoRepository,
                           JobQueueService jobQueueService,
                           TurnstileService turnstileService,
                           @Value("${photos.max-per-user}") long maxPhotosPerUser) {
        this.storageService = storageService;
        this.albumRepository = albumRepository;
        this.photoRepository = photoRepository;
        this.jobQueueService = jobQueueService;
        this.turnstileService = turnstileService;
        this.maxPhotosPerUser = maxPhotosPerUser;
    }

    @PostMapping
    public ResponseEntity<?> createAlbum(
            @RequestBody com.grabpic.api.dto.AlbumCreateRequest request,
            @AuthenticationPrincipal Jwt jwt) {

        SharedAlbum album = new SharedAlbum();
        album.setTitle(request.getTitle());

        album.setHostId(jwt.getSubject());

        SharedAlbum savedAlbum = albumRepository.save(album);
        return ResponseEntity.ok(new com.grabpic.api.dto.AlbumResponse(
                savedAlbum.getId().toString(),
                savedAlbum.getTitle(),
                savedAlbum.getCreatedAt().toString()
        ));
    }

    @GetMapping
    public ResponseEntity<List<com.grabpic.api.dto.AlbumResponse>> getAllAlbums(@AuthenticationPrincipal Jwt jwt) {
        String hostId = jwt.getSubject();
        List<SharedAlbum> albums = albumRepository.findByHostId(hostId);
        List<com.grabpic.api.dto.AlbumResponse> response = albums.stream()
                .map(a -> new com.grabpic.api.dto.AlbumResponse(
                        a.getId().toString(),
                        a.getTitle(),
                        a.getCreatedAt().toString()
                ))
                .toList();
        return ResponseEntity.ok(response);
    }

    private static final int MAX_UPLOAD_BATCH = 50;
    private static final int MAX_GUEST_SEARCH_RESULTS_IDS = 500;

    private com.grabpic.api.dto.PhotoResponse toPhotoResponse(Photo photo, boolean includeFaces) {
        String key = photo.getStorageUrl();
        int faceCount = 0;
        List<String> boxes = new ArrayList<>();
        if (includeFaces && photo.getFaces() != null) {
            faceCount = photo.getFaces().size();
            for (com.grabpic.api.model.PhotoEmbedding face : photo.getFaces()) {
                boxes.add(face.getBoxArea());
            }
        }
        return new com.grabpic.api.dto.PhotoResponse(
                photo.getId().toString(),
                storageService.generateViewUrl(key),
                storageService.generateDerivativeViewUrl(key, "previews"),
                storageService.generateDerivativeViewUrl(key, "thumbnails"),
                photo.getAccessMode() == AccessMode.PUBLIC,
                photo.isProcessed(),
                faceCount,
                boxes
        );
    }

    @PostMapping("/{albumId}/upload-urls")
    public ResponseEntity<?> getUploadUrls(
            @PathVariable UUID albumId,
            @RequestBody com.grabpic.api.dto.UploadUrlRequest request,
            @RequestHeader(value = "X-Turnstile-Token", required = false) String turnstileToken,
            HttpServletRequest httpRequest,
            @AuthenticationPrincipal Jwt jwt) {

        if (!turnstileService.isHuman(turnstileToken, httpRequest.getRemoteAddr())) {
            return ResponseEntity.status(403).body("Bot activity detected.");
        }

        Optional<SharedAlbum> albumOpt = albumRepository.findById(albumId);
        if (albumOpt.isEmpty()) return ResponseEntity.notFound().build();
        if (!albumOpt.get().getHostId().equals(jwt.getSubject())) {
            return ResponseEntity.status(403).body("You do not have permission to upload to this album.");
        }

        List<Long> fileSizes = request.getFileSizes();
        if (fileSizes == null || fileSizes.isEmpty() || fileSizes.size() > MAX_UPLOAD_BATCH) {
            return ResponseEntity.badRequest()
                    .body("Upload count must be between 1 and " + MAX_UPLOAD_BATCH + ".");
        }

        long maxBytes = storageService.maxPhotoBytes();
        for (Long size : fileSizes) {
            if (size == null || size <= 0 || size > maxBytes) {
                return ResponseEntity.badRequest()
                        .body("Each photo must be between 1 byte and " + (maxBytes / 1024 / 1024) + " MB.");
            }
        }

        long totalUserPhotos = photoRepository.countByAlbumHostId(jwt.getSubject());
        if (totalUserPhotos >= maxPhotosPerUser) {
            return ResponseEntity.badRequest().body(quotaMessage());
        }
        int allowed = (int) Math.min(fileSizes.size(), maxPhotosPerUser - totalUserPhotos);

        List<Map<String, String>> uploads = new ArrayList<>();
        for (int i = 0; i < allowed; i++) {
            String key = storageService.newOriginalKey(albumId);
            uploads.add(Map.of(
                    "key", key,
                    "uploadUrl", "/api/albums/" + albumId + "/photos/content?key=" + key
            ));
        }
        return ResponseEntity.ok(uploads);
    }

    private String quotaMessage() {
        return "You have reached the maximum of " + maxPhotosPerUser
                + " photos. Please delete old photos to free up space.";
    }

    @PostMapping("/{albumId}/photos")
    public ResponseEntity<?> saveUploadedPhotos(@PathVariable UUID albumId,
                                                @RequestBody PhotoSaveRequest request,
                                                @AuthenticationPrincipal Jwt jwt) {

        Optional<SharedAlbum> albumOpt = albumRepository.findById(albumId);
        if (albumOpt.isEmpty()) {
            return ResponseEntity.notFound().build();
        }

        SharedAlbum album = albumOpt.get();
        if (!album.getHostId().equals(jwt.getSubject())) {
            return ResponseEntity.status(403).body("You do not own this album.");
        }

        long totalUserPhotos = photoRepository.countByAlbumHostId(jwt.getSubject());
        int incoming = request.getPhotos().size();
        if (totalUserPhotos + incoming > maxPhotosPerUser) {
            return ResponseEntity.badRequest()
                    .body("Cannot save " + incoming + " photos. You already have " + totalUserPhotos
                            + " of " + maxPhotosPerUser + " allowed. Please delete old photos first.");
        }

        List<String> keysToCleanUp = new ArrayList<>();
        String expectedPrefix = "albums/" + albumId + "/";
        for (PhotoSaveRequest.PhotoItem item : request.getPhotos()) {
            String key = item.getStorageUrl();
            if (!storageService.isValidOriginalKey(key) || !key.startsWith(expectedPrefix)) {
                if (!keysToCleanUp.isEmpty()) storageService.deleteObjects(keysToCleanUp);
                return ResponseEntity.badRequest()
                        .body("Invalid photo reference detected. Please re-upload your photos.");
            }

            long objectSize = storageService.size(key);
            if (objectSize <= 0 || objectSize > storageService.maxPhotoBytes()) {
                keysToCleanUp.add(key);
                storageService.deleteObjects(keysToCleanUp);
                return ResponseEntity.badRequest()
                        .body("One or more photos failed validation (missing or too large).");
            }
            keysToCleanUp.add(key);
        }
        keysToCleanUp.clear();

        List<Photo> photosToSave = new ArrayList<>();

        for (PhotoSaveRequest.PhotoItem item : request.getPhotos()) {
            Photo photo = new Photo();
            photo.setAlbum(album);
            photo.setStorageUrl(item.getStorageUrl());
            photo.setAccessMode(item.isPublic() ? AccessMode.PUBLIC : AccessMode.PROTECTED);
            photo.setProcessed(false);

            photosToSave.add(photo);
        }

        photoRepository.saveAll(photosToSave);

        List<JobQueueService.PhotoMessage> jobMessages = photosToSave.stream()
                .map(p -> new JobQueueService.PhotoMessage(p.getId().toString(), p.getStorageUrl()))
                .toList();
        jobQueueService.sendPhotosForProcessingBatch(jobMessages);

        return ResponseEntity.ok().body("Successfully saved " + photosToSave.size() + " photos.");
    }

    @GetMapping("/{albumId}/photos")
    public ResponseEntity<?> getAlbumPhotos(@PathVariable UUID albumId,
                                            @AuthenticationPrincipal Jwt jwt) {

        Optional<SharedAlbum> albumOpt = albumRepository.findById(albumId);
        if (albumOpt.isEmpty()) return ResponseEntity.notFound().build();
        if (!albumOpt.get().getHostId().equals(jwt.getSubject())) {
            return ResponseEntity.status(403).body("You do not own this album.");
        }

        List<Photo> photos = photoRepository.findByAlbumId(albumId);
        List<com.grabpic.api.dto.PhotoResponse> response = new ArrayList<>();
        for (Photo photo : photos) {
            response.add(toPhotoResponse(photo, true));
        }

        return ResponseEntity.ok(response);
    }

    @DeleteMapping("/{albumId}/photos/{photoId}")
    public ResponseEntity<?> deletePhoto(@PathVariable UUID albumId,
                                         @PathVariable UUID photoId,
                                         @AuthenticationPrincipal Jwt jwt) {
        try {
            Optional<SharedAlbum> albumOpt = albumRepository.findById(albumId);
            if (albumOpt.isEmpty()) return ResponseEntity.notFound().build();
            if (!albumOpt.get().getHostId().equals(jwt.getSubject())) {
                return ResponseEntity.status(403).body("You do not own this album.");
            }

            Optional<Photo> photoOpt = photoRepository.findById(photoId);
            if (photoOpt.isEmpty()) return ResponseEntity.notFound().build();
            if (!photoOpt.get().getAlbum().getId().equals(albumId)) {
                return ResponseEntity.badRequest().body("Photo does not belong to this album.");
            }

            storageService.deleteObject(photoOpt.get().getStorageUrl());
            photoRepository.delete(photoOpt.get());
            return ResponseEntity.ok().body("Photo removed successfully.");
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body("Failed to delete photo");
        }
    }

    @DeleteMapping("/{albumId}")
    public ResponseEntity<?> deleteAlbum(@PathVariable UUID albumId,
                                         @AuthenticationPrincipal Jwt jwt) {
        try {
            Optional<SharedAlbum> albumOpt = albumRepository.findById(albumId);
            if (albumOpt.isEmpty()) return ResponseEntity.notFound().build();
            if (!albumOpt.get().getHostId().equals(jwt.getSubject())) {
                return ResponseEntity.status(403).body("You do not own this album.");
            }

            List<Photo> albumPhotos = photoRepository.findByAlbumId(albumId);
            List<String> keys = albumPhotos.stream()
                    .map(Photo::getStorageUrl)
                    .toList();
            storageService.deleteObjects(keys);

            albumRepository.delete(albumOpt.get());
            return ResponseEntity.ok().body("Album deleted successfully.");
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body("Failed to delete album");
        }
    }

    @GetMapping("/{albumId}/guest/details")
    public ResponseEntity<?> getGuestAlbumDetails(@PathVariable UUID albumId) {
        Optional<SharedAlbum> albumOpt = albumRepository.findById(albumId);

        if (albumOpt.isEmpty()) {
            return ResponseEntity.notFound().build();
        }

        SharedAlbum album = albumOpt.get();

        List<Photo> allPhotos = photoRepository.findByAlbumId(albumId);
        List<com.grabpic.api.dto.PhotoResponse> publicPhotos = new ArrayList<>();

        for (Photo photo : allPhotos) {
            if (photo.getAccessMode() == AccessMode.PUBLIC) {
                publicPhotos.add(toPhotoResponse(photo, false));
            }
        }

        return ResponseEntity.ok().body(
                java.util.Map.of(
                        "title", album.getTitle(),
                        "publicPhotos", publicPhotos
                )
        );
    }

    @PutMapping("/{albumId}/photos/{photoId}/privacy")
    public ResponseEntity<?> togglePhotoPrivacy(@PathVariable UUID albumId,
                                                @PathVariable UUID photoId,
                                                @RequestParam boolean makePublic,
                                                @AuthenticationPrincipal Jwt jwt) {
        try {
            Optional<SharedAlbum> albumOpt = albumRepository.findById(albumId);
            if (albumOpt.isEmpty()) return ResponseEntity.notFound().build();
            if (!albumOpt.get().getHostId().equals(jwt.getSubject())) {
                return ResponseEntity.status(403).body("You do not own this album.");
            }

            Optional<Photo> photoOpt = photoRepository.findById(photoId);
            if (photoOpt.isEmpty()) {
                return ResponseEntity.notFound().build();
            }

            Photo photo = photoOpt.get();
            if (!photo.getAlbum().getId().equals(albumId)) {
                return ResponseEntity.badRequest().body("Photo does not belong to this album");
            }

            AccessMode previousMode = photo.getAccessMode();
            AccessMode nextMode = makePublic ? AccessMode.PUBLIC : AccessMode.PROTECTED;

            photo.setAccessMode(nextMode);
            photoRepository.save(photo);

            if (previousMode == AccessMode.PUBLIC
                    && nextMode == AccessMode.PROTECTED
                    && !photo.isProcessed()) {
                jobQueueService.sendPhotoForProcessing(photo.getId().toString(), photo.getStorageUrl());
            }

            return ResponseEntity.ok().body("Privacy updated.");
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body("Failed to update privacy");
        }
    }

    @PostMapping("/{albumId}/guest/search-results")
    public ResponseEntity<?> getGuestSearchResults(@PathVariable UUID albumId, @RequestBody List<UUID> photoIds) {
        if (photoIds == null || photoIds.isEmpty()) {
            return ResponseEntity.badRequest().body("No photo IDs provided.");
        }
        if (photoIds.size() > MAX_GUEST_SEARCH_RESULTS_IDS) {
            return ResponseEntity.badRequest()
                    .body("Too many photo IDs. Maximum is " + MAX_GUEST_SEARCH_RESULTS_IDS + ".");
        }

        Optional<SharedAlbum> albumOpt = albumRepository.findById(albumId);
        if (albumOpt.isEmpty()) {
            return ResponseEntity.notFound().build();
        }

        List<Photo> allPhotos = photoRepository.findAllById(photoIds);
        List<com.grabpic.api.dto.PhotoResponse> matchedPhotos = new ArrayList<>();

        for (Photo photo : allPhotos) {
            if (photo.getAlbum().getId().equals(albumId)) {
                matchedPhotos.add(toPhotoResponse(photo, false));
            }
        }
        return ResponseEntity.ok(matchedPhotos);
    }

    @PostMapping("/{albumId}/photos/backfill-processing")
    public ResponseEntity<?> backfillPhotoProcessing(@PathVariable UUID albumId,
                                                     @AuthenticationPrincipal Jwt jwt) {
        Optional<SharedAlbum> albumOpt = albumRepository.findById(albumId);
        if (albumOpt.isEmpty()) return ResponseEntity.notFound().build();
        if (!albumOpt.get().getHostId().equals(jwt.getSubject())) {
            return ResponseEntity.status(403).body("You do not own this album.");
        }

        List<Photo> albumPhotos = photoRepository.findByAlbumId(albumId);
        List<JobQueueService.PhotoMessage> unprocessed = albumPhotos.stream()
                .filter(photo -> !photo.isProcessed())
                .map(photo -> new JobQueueService.PhotoMessage(photo.getId().toString(), photo.getStorageUrl()))
                .toList();

        jobQueueService.sendPhotosForProcessingBatch(unprocessed);
        return ResponseEntity.ok().body(
                java.util.Map.of(
                        "queued", unprocessed.size(),
                        "albumId", albumId.toString()
                )
        );
    }
}
