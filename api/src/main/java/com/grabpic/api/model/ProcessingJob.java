package com.grabpic.api.model;

import jakarta.persistence.*;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * Face-processing job queue row (replaces AWS SQS).
 * Status: PENDING | PROCESSING | COMPLETED | FAILED.
 * The Python worker claims PENDING rows with FOR UPDATE SKIP LOCKED.
 */
@Data
@Entity
@Table(name = "processing_jobs")
public class ProcessingJob {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private UUID id;

    @Column(name = "photo_id", nullable = false)
    private UUID photoId;

    @Column(name = "storage_key", nullable = false)
    private String storageKey;

    @Column(nullable = false)
    private String status = "PENDING";

    @Column(nullable = false)
    private int attempts = 0;

    private String lastError;

    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        this.createdAt = LocalDateTime.now();
        this.updatedAt = this.createdAt;
    }
}
