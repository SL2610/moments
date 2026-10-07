package com.grabpic.api.repository;

import com.grabpic.api.model.Guest;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface GuestRepository extends JpaRepository<Guest, UUID> {
    List<Guest> findByAlbumId(UUID albumId);
}
