package com.grabpic.api.repository;

import com.grabpic.api.model.Guest;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface GuestRepository extends JpaRepository<Guest, UUID> {
    Optional<Guest> findByPhone(String phone);
    Optional<Guest> findFirstByNameIgnoreCaseOrderByCreatedAtAsc(String name);
    Optional<Guest> findFirstByNameIgnoreCaseAndPhoneIsNullOrderByCreatedAtAsc(String name);
}
