package com.grabpic.api.repository;

import com.grabpic.api.model.PhotoTag;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface PhotoTagRepository extends JpaRepository<PhotoTag, UUID> {
    List<PhotoTag> findByPhotoIdIn(List<UUID> photoIds);
    List<PhotoTag> findByGuestId(UUID guestId);
    Optional<PhotoTag> findByPhotoIdAndGuestId(UUID photoId, UUID guestId);
    boolean existsByPhotoIdAndGuestId(UUID photoId, UUID guestId);

    @Query("SELECT t.guestId, COUNT(t) FROM PhotoTag t GROUP BY t.guestId")
    List<Object[]> countByGuest();
}
