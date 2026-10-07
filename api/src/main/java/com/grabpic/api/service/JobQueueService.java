package com.grabpic.api.service;

import com.grabpic.api.model.ProcessingJob;
import com.grabpic.api.repository.ProcessingJobRepository;
import jakarta.transaction.Transactional;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.UUID;

/**
 * PostgreSQL-backed job queue replacing AWS SQS. Enqueued rows are consumed
 * by the Python AI worker.
 */
@Service
@Transactional
public class JobQueueService {

    public record PhotoMessage(String photoId, String storageUrl) {}

    private final ProcessingJobRepository jobRepository;

    public JobQueueService(ProcessingJobRepository jobRepository) {
        this.jobRepository = jobRepository;
    }

    public void sendPhotoForProcessing(String photoId, String storageUrl) {
        sendPhotosForProcessingBatch(List.of(new PhotoMessage(photoId, storageUrl)));
    }

    /** Re-enqueues photos, clearing any stuck or failed job for them first. */
    public void sendPhotosForProcessingBatch(List<PhotoMessage> messages) {
        if (messages == null || messages.isEmpty()) return;

        List<UUID> photoIds = messages.stream().map(m -> UUID.fromString(m.photoId())).toList();
        jobRepository.deleteIncompleteByPhotoIds(photoIds);

        List<ProcessingJob> jobs = messages.stream().map(m -> {
            ProcessingJob job = new ProcessingJob();
            job.setPhotoId(UUID.fromString(m.photoId()));
            job.setStorageKey(m.storageUrl());
            return job;
        }).toList();
        jobRepository.saveAll(jobs);
    }
}
