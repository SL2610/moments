package com.grabpic.api.service;

import com.grabpic.api.model.AccessMode;
import com.grabpic.api.model.Photo;
import com.grabpic.api.model.SharedAlbum;
import com.grabpic.api.repository.PhotoRepository;
import com.grabpic.api.repository.SharedAlbumRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Stream;

/**
 * Bulk import of a host-mounted photo directory (default /import) into an album.
 * Files are hashed for duplicate detection, copied into local storage one at a
 * time (never loaded fully into memory), and queued for face processing.
 * Re-running an import retries failed files: duplicates are skipped by hash.
 */
@Service
public class ImportService {

    private static final Logger log = LoggerFactory.getLogger(ImportService.class);
    private static final Set<String> SUPPORTED_EXTENSIONS = Set.of("jpg", "jpeg", "png", "webp");
    private static final int MAX_RECORDED_FAILURES = 100;

    public static final class ImportStatus {
        public volatile String state = "RUNNING"; // RUNNING | COMPLETED | FAILED
        public volatile String error;
        public final AtomicInteger total = new AtomicInteger();
        public final AtomicInteger imported = new AtomicInteger();
        public final AtomicInteger duplicates = new AtomicInteger();
        public final AtomicInteger failed = new AtomicInteger();
        public final List<Map<String, String>> failures = Collections.synchronizedList(new ArrayList<>());
    }

    private final PhotoRepository photoRepository;
    private final SharedAlbumRepository albumRepository;
    private final LocalStorageService storage;
    private final JobQueueService jobQueue;
    private final Path importRoot;
    private final long maxPhotosPerUser;

    private final Map<UUID, ImportStatus> statuses = new ConcurrentHashMap<>();
    // ponytail: one import at a time is plenty for a single-machine deployment
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    public ImportService(PhotoRepository photoRepository,
                         SharedAlbumRepository albumRepository,
                         LocalStorageService storage,
                         JobQueueService jobQueue,
                         @Value("${storage.import-path}") String importPath,
                         @Value("${photos.max-per-user}") long maxPhotosPerUser) {
        this.photoRepository = photoRepository;
        this.albumRepository = albumRepository;
        this.storage = storage;
        this.jobQueue = jobQueue;
        this.importRoot = Path.of(importPath).toAbsolutePath().normalize();
        this.maxPhotosPerUser = maxPhotosPerUser;
    }

    public ImportStatus getStatus(UUID albumId) {
        return statuses.get(albumId);
    }

    /**
     * Starts an import for the album. Returns an error message, or null on success.
     * The requested path must resolve inside the import root (no traversal).
     */
    public String startImport(UUID albumId, String hostId, String requestedPath) {
        ImportStatus existing = statuses.get(albumId);
        if (existing != null && "RUNNING".equals(existing.state)) {
            return "An import is already running for this album.";
        }

        Path dir;
        try {
            String raw = (requestedPath == null || requestedPath.isBlank())
                    ? importRoot.toString() : requestedPath.trim();
            dir = Path.of(raw).toAbsolutePath().normalize().toRealPath();
        } catch (IOException e) {
            return "Import folder not found. Put photos under ./data/import on the host (mounted as /import).";
        }
        if (!dir.startsWith(importRoot)) {
            return "Import path must be inside " + importRoot + ".";
        }
        if (!Files.isDirectory(dir)) {
            return "Import path is not a directory.";
        }

        ImportStatus status = new ImportStatus();
        statuses.put(albumId, status);
        executor.submit(() -> runImport(albumId, hostId, dir, status));
        return null;
    }

    private void runImport(UUID albumId, String hostId, Path dir, ImportStatus status) {
        try (Stream<Path> walk = Files.walk(dir)) {
            List<Path> files = walk
                    .filter(Files::isRegularFile)
                    .filter(p -> SUPPORTED_EXTENSIONS.contains(extensionOf(p)))
                    .sorted()
                    .toList();
            status.total.set(files.size());

            SharedAlbum album = albumRepository.getReferenceById(albumId);
            long userPhotoCount = photoRepository.countByAlbumHostId(hostId);

            for (Path file : files) {
                if (userPhotoCount >= maxPhotosPerUser) {
                    recordFailure(status, file, "Photo quota reached (" + maxPhotosPerUser + " per user).");
                    continue;
                }
                try {
                    if (importOne(album, albumId, file)) {
                        status.imported.incrementAndGet();
                        userPhotoCount++;
                    } else {
                        status.duplicates.incrementAndGet();
                    }
                } catch (Exception e) {
                    log.warn("Import failed for {}: {}", file, e.getMessage());
                    recordFailure(status, file, e.getMessage());
                }
            }
            status.state = "COMPLETED";
        } catch (Exception e) {
            log.error("Import crashed for album {}: {}", albumId, e.getMessage());
            status.error = e.getMessage();
            status.state = "FAILED";
        }
    }

    /** Returns true if imported, false if skipped as duplicate. */
    private boolean importOne(SharedAlbum album, UUID albumId, Path file) throws Exception {
        long size = Files.size(file);
        if (size <= 0 || size > storage.maxPhotoBytes()) {
            throw new IOException("File is empty or exceeds " + (storage.maxPhotoBytes() / 1024 / 1024) + " MB.");
        }

        String hash = sha256(file);
        if (photoRepository.existsByAlbumIdAndContentHash(albumId, hash)) {
            return false;
        }

        String ext = extensionOf(file).replace("jpeg", "jpg");
        String key = "albums/" + albumId + "/" + UUID.randomUUID() + "." + ext;
        try (InputStream in = Files.newInputStream(file)) {
            storage.save(key, in);
        }

        Photo photo = new Photo();
        photo.setAlbum(album);
        photo.setStorageUrl(key);
        // Imported photos join the shared wedding pool visible to all guests.
        photo.setAccessMode(AccessMode.PUBLIC);
        photo.setProcessed(false);
        photo.setContentHash(hash);
        Photo saved = photoRepository.save(photo);

        jobQueue.sendPhotoForProcessing(saved.getId().toString(), key);
        return true;
    }

    private void recordFailure(ImportStatus status, Path file, String error) {
        status.failed.incrementAndGet();
        if (status.failures.size() < MAX_RECORDED_FAILURES) {
            status.failures.add(Map.of("file", file.toString(), "error", error == null ? "Unknown error" : error));
        }
    }

    private static String extensionOf(Path path) {
        String name = path.getFileName().toString().toLowerCase();
        int dot = name.lastIndexOf('.');
        return dot < 0 ? "" : name.substring(dot + 1);
    }

    private static String sha256(Path file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new DigestInputStream(Files.newInputStream(file), digest)) {
            byte[] buffer = new byte[64 * 1024];
            while (in.read(buffer) != -1) { /* stream through */ }
        }
        StringBuilder sb = new StringBuilder();
        for (byte b : digest.digest()) sb.append(String.format("%02x", b));
        return sb.toString();
    }
}
