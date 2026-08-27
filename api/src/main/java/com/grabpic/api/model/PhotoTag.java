package com.grabpic.api.model;

import jakarta.persistence.*;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.UUID;

@Data
@Entity
@Table(name = "photo_tags")
public class PhotoTag {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private UUID id;

    @Column(name = "photo_id", nullable = false)
    private UUID photoId;

    @Column(name = "guest_id", nullable = false)
    private UUID guestId;

    @Column(name = "tagged_by")
    private UUID taggedBy;

    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        this.createdAt = LocalDateTime.now();
    }
}
