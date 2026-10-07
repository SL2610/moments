package com.grabpic.api.controller;

import com.grabpic.api.model.SharedAlbum;
import com.grabpic.api.repository.SharedAlbumRepository;
import com.grabpic.api.service.LocalStorageService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.io.InputStream;
import java.io.PushbackInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Arrays;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Serves photo bytes to and from local storage. Replaces the browser's
 * direct-to-S3 presigned PUT/GET traffic.
 */
@RestController
public class PhotoContentController {

    private final LocalStorageService storage;
    private final SharedAlbumRepository albumRepository;

    public PhotoContentController(LocalStorageService storage, SharedAlbumRepository albumRepository) {
        this.storage = storage;
        this.albumRepository = albumRepository;
    }

    /**
     * Receives raw photo bytes from the album owner's browser for a key
     * previously issued by the upload-urls endpoint.
     */
    @PutMapping("/api/albums/{albumId}/photos/content")
    public ResponseEntity<?> uploadPhoto(@PathVariable UUID albumId,
                                         @RequestParam("key") String key,
                                         HttpServletRequest request,
                                         @AuthenticationPrincipal Jwt jwt) throws IOException {
        Optional<SharedAlbum> albumOpt = albumRepository.findById(albumId);
        if (albumOpt.isEmpty()) return ResponseEntity.notFound().build();
        if (!albumOpt.get().getHostId().equals(jwt.getSubject())) {
            return ResponseEntity.status(403).body("You do not have permission to upload to this album.");
        }
        if (!storage.isValidOriginalKey(key) || !key.startsWith("albums/" + albumId + "/")) {
            return ResponseEntity.badRequest().body("Invalid upload key.");
        }
        long declared = request.getContentLengthLong();
        if (declared > storage.maxPhotoBytes()) {
            return ResponseEntity.status(413).body("Photo exceeds the maximum allowed size.");
        }

        PushbackInputStream in = new PushbackInputStream(request.getInputStream(), 16);
        byte[] head = new byte[12];
        int read = readFully(in, head);
        if (read < 12 || !isSupportedImage(head)) {
            return ResponseEntity.badRequest().body("File is not a valid JPEG, PNG, or WebP image.");
        }
        in.unread(head, 0, read);

        try {
            storage.save(key, in);
        } catch (IOException e) {
            return ResponseEntity.status(413).body("Photo exceeds the maximum allowed size.");
        }
        return ResponseEntity.ok().body("Uploaded.");
    }

    /**
     * Serves a photo (original or derivative) for a signed, short-lived URL.
     * No JWT required: the HMAC signature is the authorization, which is how
     * protected photos stay non-enumerable.
     */
    @GetMapping("/api/photos/view")
    public ResponseEntity<?> viewPhoto(@RequestParam("key") String key,
                                       @RequestParam("expires") long expires,
                                       @RequestParam("sig") String sig) throws IOException {
        if (!storage.isValidKey(key) || !storage.verifySignature(key, expires, sig)) {
            return ResponseEntity.status(403).body(Map.of("error", "Invalid or expired photo link."));
        }
        Path path = storage.resolve(key);
        if (!Files.isRegularFile(path)) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok()
                .contentType(mediaTypeFor(path))
                .cacheControl(CacheControl.maxAge(Duration.ofHours(1)).cachePrivate())
                .contentLength(Files.size(path))
                .body(new FileSystemResource(path));
    }

    private static int readFully(InputStream in, byte[] buffer) throws IOException {
        int total = 0;
        while (total < buffer.length) {
            int n = in.read(buffer, total, buffer.length - total);
            if (n == -1) break;
            total += n;
        }
        return total;
    }

    private static boolean isSupportedImage(byte[] head) {
        if (head[0] == (byte) 0xFF && head[1] == (byte) 0xD8 && head[2] == (byte) 0xFF) return true; // JPEG
        byte[] png = {(byte) 0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n'};
        if (Arrays.equals(Arrays.copyOf(head, 8), png)) return true; // PNG
        return head[0] == 'R' && head[1] == 'I' && head[2] == 'F' && head[3] == 'F'
                && head[8] == 'W' && head[9] == 'E' && head[10] == 'B' && head[11] == 'P'; // WebP
    }

    /** Sniffs the stored bytes, since browser uploads may store PNG/WebP bytes under a .jpg key. */
    private static MediaType mediaTypeFor(Path path) throws IOException {
        try (InputStream in = Files.newInputStream(path)) {
            byte[] head = new byte[12];
            int n = readFully(in, head);
            if (n >= 8 && head[0] == (byte) 0x89 && head[1] == 'P') return MediaType.IMAGE_PNG;
            if (n >= 12 && head[0] == 'R' && head[8] == 'W') return MediaType.valueOf("image/webp");
        }
        return MediaType.IMAGE_JPEG;
    }
}
