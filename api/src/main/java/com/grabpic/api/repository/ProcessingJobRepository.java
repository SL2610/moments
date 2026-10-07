package com.grabpic.api.repository;

import com.grabpic.api.model.ProcessingJob;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

public interface ProcessingJobRepository extends JpaRepository<ProcessingJob, UUID> {

    @Modifying
    @Query("DELETE FROM ProcessingJob j WHERE j.photoId IN :photoIds AND j.status <> 'COMPLETED'")
    void deleteIncompleteByPhotoIds(@Param("photoIds") List<UUID> photoIds);
}
