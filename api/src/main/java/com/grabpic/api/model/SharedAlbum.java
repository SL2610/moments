package com.grabpic.api.model;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;
import java.util.UUID;
import java.util.List;
import com.fasterxml.jackson.annotation.JsonIgnore;

@Data
@Entity
@Table(name = "shared_albums")
public class SharedAlbum {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private UUID id;

    @Column(nullable = false)
    private String title;

    @Column(nullable = false)
    private String hostId;

    /** Unguessable id in the guest URL (/w/{publicId}); with no password, the link is the key. */
    @Column(nullable = false, unique = true, updatable = false)
    private String publicId;

    private String eventDate;

    /** BCrypt hash of the optional guest password; null means the link alone is enough. */
    @JsonIgnore
    private String guestPasswordHash;

    @JsonIgnore
    private String coverKey;

    @JsonIgnore
    @OneToMany(mappedBy = "album", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<Photo> photos;

    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        this.createdAt = LocalDateTime.now();
        if (this.publicId == null) this.publicId = newPublicId();
    }

    private static final java.security.SecureRandom RANDOM = new java.security.SecureRandom();
    private static final String ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

    /** 10 chars from a 32-letter alphabet without look-alikes: 50 bits, not guessable. */
    static String newPublicId() {
        StringBuilder id = new StringBuilder(10);
        for (int i = 0; i < 10; i++) id.append(ALPHABET.charAt(RANDOM.nextInt(ALPHABET.length())));
        return id.toString();
    }
}
