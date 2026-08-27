package com.grabpic.api.repository;

import com.grabpic.api.model.Photo;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

public interface PhotoRepository extends JpaRepository<Photo, UUID> {
    List<Photo> findByAlbumId(UUID albumId);
    long countByAlbumId(UUID albumId);
    boolean existsByAlbumIdAndContentHash(UUID albumId, String contentHash);

    org.springframework.data.domain.Page<Photo> findByAlbumIdAndAccessMode(
            UUID albumId,
            com.grabpic.api.model.AccessMode accessMode,
            org.springframework.data.domain.Pageable pageable);

    org.springframework.data.domain.Page<Photo> findByAlbumIdAndAccessModeAndUploadedByIsNull(
            UUID albumId,
            com.grabpic.api.model.AccessMode accessMode,
            org.springframework.data.domain.Pageable pageable);

    org.springframework.data.domain.Page<Photo> findByAlbumIdAndAccessModeAndUploadedByIsNotNull(
            UUID albumId,
            com.grabpic.api.model.AccessMode accessMode,
            org.springframework.data.domain.Pageable pageable);

    long countByAlbumIdAndAccessModeAndUploadedByIsNull(UUID albumId, com.grabpic.api.model.AccessMode accessMode);
    long countByAlbumIdAndAccessModeAndUploadedByIsNotNull(UUID albumId, com.grabpic.api.model.AccessMode accessMode);

    @Query("SELECT COUNT(p) FROM Photo p WHERE p.album.hostId = :hostId")
    long countByAlbumHostId(@Param("hostId") String hostId);
}