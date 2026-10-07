package com.grabpic.api.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Filesystem-backed photo storage. Replaces S3 presigned URLs with
 * short-lived HMAC-signed view URLs served by this API.
 *
 * Layout under the storage root:
 *   albums/{albumId}/{photoId}.{ext}                  original
 *   albums/{albumId}/previews/{photoId}.webp          fullscreen preview (worker-generated)
 *   albums/{albumId}/thumbnails/{photoId}.webp        gallery thumbnail (worker-generated)
 */
@Service
public class LocalStorageService {

    private static final Logger log = LoggerFactory.getLogger(LocalStorageService.class);
    private static final Duration VIEW_URL_TTL = Duration.ofHours(7);

    // Keys are UUID-based by construction, so a valid key can never traverse paths.
    private static final Pattern ORIGINAL_KEY_PATTERN = Pattern.compile(
            "^albums/[0-9a-fA-F\\-]{36}/[0-9a-fA-F\\-]{36}\\.(jpg|jpeg|png|webp)$");
    private static final Pattern ANY_KEY_PATTERN = Pattern.compile(
            "^albums/[0-9a-fA-F\\-]{36}/((previews|thumbnails)/)?[0-9a-fA-F\\-]{36}\\.(jpg|jpeg|png|webp)$");

    private final Path root;
    private final byte[] viewUrlSecret;
    private final long maxPhotoBytes;

    public LocalStorageService(@Value("${storage.path}") String storagePath,
                               @Value("${storage.view-url-secret}") String viewUrlSecret,
                               @Value("${photos.max-size-mb}") long maxPhotoSizeMb) {
        if (viewUrlSecret == null || viewUrlSecret.getBytes(StandardCharsets.UTF_8).length < 32) {
            throw new IllegalStateException("VIEW_URL_SECRET must be at least 32 bytes. Generate one with: openssl rand -base64 48");
        }
        this.root = Path.of(storagePath).toAbsolutePath().normalize();
        this.viewUrlSecret = viewUrlSecret.getBytes(StandardCharsets.UTF_8);
        this.maxPhotoBytes = maxPhotoSizeMb * 1024 * 1024;
        try {
            Files.createDirectories(root);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot create storage directory " + root, e);
        }
    }

    public long maxPhotoBytes() {
        return maxPhotoBytes;
    }

    public boolean isValidOriginalKey(String key) {
        return key != null && ORIGINAL_KEY_PATTERN.matcher(key).matches();
    }

    public boolean isValidKey(String key) {
        return key != null && ANY_KEY_PATTERN.matcher(key).matches();
    }

    public String newOriginalKey(UUID albumId) {
        return "albums/" + albumId + "/" + UUID.randomUUID() + ".jpg";
    }

    /** Resolves a validated key to an absolute path under the storage root. */
    public Path resolve(String key) {
        if (!isValidKey(key)) {
            throw new IllegalArgumentException("Invalid storage key");
        }
        Path resolved = root.resolve(key).normalize();
        if (!resolved.startsWith(root)) {
            throw new IllegalArgumentException("Invalid storage key");
        }
        return resolved;
    }

    /** Streams the input to the key location, enforcing the size limit. Returns bytes written. */
    public long save(String key, InputStream in) throws IOException {
        Path target = resolve(key);
        Files.createDirectories(target.getParent());
        Path temp = Files.createTempFile(target.getParent(), ".upload-", ".tmp");
        long written = 0;
        try (var out = Files.newOutputStream(temp)) {
            byte[] buffer = new byte[64 * 1024];
            int n;
            while ((n = in.read(buffer)) != -1) {
                written += n;
                if (written > maxPhotoBytes) {
                    throw new IOException("File exceeds the maximum size of " + (maxPhotoBytes / 1024 / 1024) + " MB");
                }
                out.write(buffer, 0, n);
            }
        } catch (IOException e) {
            Files.deleteIfExists(temp);
            throw e;
        }
        Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING);
        return written;
    }

    public boolean exists(String key) {
        try {
            return Files.isRegularFile(resolve(key));
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    public long size(String key) {
        try {
            return Files.size(resolve(key));
        } catch (Exception e) {
            return -1;
        }
    }

    /** Deletes the original and any derivatives for a photo key. */
    public void deleteObject(String key) {
        deleteQuietly(key);
        deleteQuietly(derivativeKey(key, "previews"));
        deleteQuietly(derivativeKey(key, "thumbnails"));
    }

    public void deleteObjects(List<String> keys) {
        if (keys == null) return;
        keys.forEach(this::deleteObject);
    }

    private void deleteQuietly(String key) {
        try {
            Files.deleteIfExists(resolve(key));
        } catch (Exception e) {
            log.warn("Failed to delete {}: {}", key, e.getMessage());
        }
    }

    /** albums/{a}/{p}.jpg -> albums/{a}/{variantDir}/{p}.webp */
    public String derivativeKey(String originalKey, String variantDir) {
        int slash = originalKey.lastIndexOf('/');
        int dot = originalKey.lastIndexOf('.');
        return originalKey.substring(0, slash) + "/" + variantDir + "/"
                + originalKey.substring(slash + 1, dot) + ".webp";
    }

    /**
     * Signed, short-lived view URL for a key (original or derivative).
     * Served by GET /api/photos/view without authentication — possession of a
     * valid signature is the authorization, which preserves protected-photo rules.
     */
    public String generateViewUrl(String key) {
        long expires = Instant.now().plus(VIEW_URL_TTL).getEpochSecond();
        return "/api/photos/view?key=" + key + "&expires=" + expires + "&sig=" + sign(key, expires);
    }

    /** View URL for a derivative, falling back to the original if not generated yet. */
    public String generateDerivativeViewUrl(String originalKey, String variantDir) {
        String key = derivativeKey(originalKey, variantDir);
        return exists(key) ? generateViewUrl(key) : generateViewUrl(originalKey);
    }

    public boolean verifySignature(String key, long expires, String sig) {
        if (sig == null || expires < Instant.now().getEpochSecond()) return false;
        byte[] expected = sign(key, expires).getBytes(StandardCharsets.UTF_8);
        byte[] actual = sig.getBytes(StandardCharsets.UTF_8);
        return MessageDigest.isEqual(expected, actual);
    }

    private String sign(String key, long expires) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(viewUrlSecret, "HmacSHA256"));
            byte[] digest = mac.doFinal((key + "|" + expires).getBytes(StandardCharsets.UTF_8));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
        } catch (Exception e) {
            throw new IllegalStateException("HMAC signing failed", e);
        }
    }
}
