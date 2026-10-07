package com.grabpic.api.model;

import jakarta.persistence.*;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.UUID;

@Data
@Entity
@Table(name = "guests")
public class Guest {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private UUID id;

    /** Null until the guest chooses a name (to upload or tag). */
    private String name;

    @Column(nullable = false)
    private UUID albumId;

    // Unique identity key; null for guests created by name-tagging only.
    /** Legacy: phone-based joins are gone; kept so old rows still load. */
    private String phone;

    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        this.createdAt = LocalDateTime.now();
    }
}
