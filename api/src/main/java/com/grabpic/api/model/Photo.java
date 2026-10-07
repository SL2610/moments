package com.grabpic.api.model;

import jakarta.persistence.*;
import lombok.Data;
import java.util.UUID;
import java.util.List;
import com.fasterxml.jackson.annotation.JsonIgnore;

@Data
@Entity
@Table(name = "photos")
public class Photo {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private UUID id;

    @ManyToOne
    @JoinColumn(name = "album_id", nullable = false)
    private SharedAlbum album;

    @Column(nullable = false)
    private String storageUrl;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private AccessMode accessMode = AccessMode.PROTECTED;

    private boolean processed = false;

    // SHA-256 of the source file; set by folder import for duplicate detection.
    @Column(name = "content_hash")
    private String contentHash;

    // Guest who added this photo to the shared pool (null for host uploads/imports).
    @Column(name = "uploaded_by")
    private java.util.UUID uploadedBy;

    private java.time.LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        this.createdAt = java.time.LocalDateTime.now();
    }

    @JsonIgnore
    @OneToMany(mappedBy = "photo", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
    private List<PhotoEmbedding> faces;
}