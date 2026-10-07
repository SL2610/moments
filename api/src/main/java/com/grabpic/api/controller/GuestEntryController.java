package com.grabpic.api.controller;

import com.grabpic.api.model.Guest;
import com.grabpic.api.model.SharedAlbum;
import com.grabpic.api.repository.GuestRepository;
import com.grabpic.api.repository.SharedAlbumRepository;
import com.grabpic.api.service.JwtService;
import com.grabpic.api.service.LocalStorageService;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.web.bind.annotation.*;

/**
 * Public entry to one wedding by its unguessable id (/w/{publicId}).
 * Knowing the id is the key; the couple may add a shared password on top.
 */
@RestController
@RequestMapping("/api/w/{publicId}")
public class GuestEntryController {

    private final SharedAlbumRepository albumRepository;
    private final GuestRepository guestRepository;
    private final JwtService jwtService;
    private final LocalStorageService storage;
    private final BCryptPasswordEncoder passwordEncoder = new BCryptPasswordEncoder();

    public GuestEntryController(SharedAlbumRepository albumRepository,
                                GuestRepository guestRepository,
                                JwtService jwtService,
                                LocalStorageService storage) {
        this.albumRepository = albumRepository;
        this.guestRepository = guestRepository;
        this.jwtService = jwtService;
        this.storage = storage;
    }

    @GetMapping
    public ResponseEntity<?> info(@PathVariable String publicId) {
        Optional<SharedAlbum> albumOpt = albumRepository.findByPublicId(publicId);
        if (albumOpt.isEmpty()) return ResponseEntity.notFound().build();
        SharedAlbum album = albumOpt.get();
        Map<String, Object> body = new HashMap<>();
        body.put("eventName", album.getTitle());
        body.put("eventDate", album.getEventDate() == null ? "" : album.getEventDate());
        body.put("passwordRequired", album.getGuestPasswordHash() != null);
        body.put("coverUrl", album.getCoverKey() == null ? null : storage.generateViewUrl(album.getCoverKey()));
        return ResponseEntity.ok(body);
    }

    public record JoinRequest(String password) {}

    /** Creates an anonymous guest of this wedding; a name is chosen later, if ever. */
    @PostMapping("/join")
    public ResponseEntity<?> join(@PathVariable String publicId,
                                  @RequestBody(required = false) JoinRequest request) {
        Optional<SharedAlbum> albumOpt = albumRepository.findByPublicId(publicId);
        if (albumOpt.isEmpty()) return ResponseEntity.notFound().build();
        SharedAlbum album = albumOpt.get();
        if (album.getGuestPasswordHash() != null) {
            String password = request == null || request.password() == null ? "" : request.password().trim();
            if (!passwordEncoder.matches(password, album.getGuestPasswordHash())) {
                return ResponseEntity.status(401).body(Map.of("error", "wrong-password"));
            }
        }
        Guest guest = new Guest();
        guest.setAlbumId(album.getId());
        guest = guestRepository.save(guest);
        String albumId = album.getId().toString();
        return ResponseEntity.ok(Map.of(
                "accessToken", jwtService.issueGuestToken(guest.getId().toString(), null, albumId),
                "guest", Map.of("id", guest.getId().toString()),
                "albumId", albumId));
    }
}
