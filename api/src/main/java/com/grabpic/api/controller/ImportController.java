package com.grabpic.api.controller;

import com.grabpic.api.model.SharedAlbum;
import com.grabpic.api.repository.SharedAlbumRepository;
import com.grabpic.api.service.ImportService;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@RestController
@RequestMapping("/api/albums/{albumId}/import")
public class ImportController {

    private final ImportService importService;
    private final SharedAlbumRepository albumRepository;

    public ImportController(ImportService importService, SharedAlbumRepository albumRepository) {
        this.importService = importService;
        this.albumRepository = albumRepository;
    }

    public record ImportRequest(String path) {}

    @PostMapping
    public ResponseEntity<?> startImport(@PathVariable UUID albumId,
                                         @RequestBody(required = false) ImportRequest request,
                                         @AuthenticationPrincipal Jwt jwt) {
        Optional<SharedAlbum> albumOpt = albumRepository.findById(albumId);
        if (albumOpt.isEmpty()) return ResponseEntity.notFound().build();
        if (!albumOpt.get().getHostId().equals(jwt.getSubject())) {
            return ResponseEntity.status(403).body(Map.of("error", "You do not own this album."));
        }

        String error = importService.startImport(albumId, jwt.getSubject(),
                request == null ? null : request.path());
        if (error != null) {
            return ResponseEntity.badRequest().body(Map.of("error", error));
        }
        return ResponseEntity.ok(Map.of("status", "started"));
    }

    @GetMapping("/status")
    public ResponseEntity<?> importStatus(@PathVariable UUID albumId,
                                          @AuthenticationPrincipal Jwt jwt) {
        Optional<SharedAlbum> albumOpt = albumRepository.findById(albumId);
        if (albumOpt.isEmpty()) return ResponseEntity.notFound().build();
        if (!albumOpt.get().getHostId().equals(jwt.getSubject())) {
            return ResponseEntity.status(403).body(Map.of("error", "You do not own this album."));
        }

        ImportService.ImportStatus status = importService.getStatus(albumId);
        if (status == null) {
            return ResponseEntity.ok(Map.of("state", "NONE"));
        }
        Map<String, Object> body = new java.util.HashMap<>();
        body.put("state", status.state);
        body.put("total", status.total.get());
        body.put("imported", status.imported.get());
        body.put("duplicates", status.duplicates.get());
        body.put("failed", status.failed.get());
        body.put("failures", status.failures);
        if (status.error != null) body.put("error", status.error);
        return ResponseEntity.ok(body);
    }
}
