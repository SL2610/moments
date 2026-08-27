package com.grabpic.api.config;

import com.grabpic.api.model.User;
import com.grabpic.api.repository.UserRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Component;

/**
 * Sets the admin account's password from ADMIN_EMAIL/ADMIN_PASSWORD on every
 * startup, so the credential lives in .env instead of a hand-crafted DB hash.
 * No-op if either is unset.
 */
@Component
public class AdminSeeder implements CommandLineRunner {

    private final UserRepository userRepository;
    private final String adminEmail;
    private final String adminPassword;
    private final BCryptPasswordEncoder passwordEncoder = new BCryptPasswordEncoder();

    public AdminSeeder(UserRepository userRepository,
                        @Value("${auth.admin-email}") String adminEmail,
                        @Value("${auth.admin-password}") String adminPassword) {
        this.userRepository = userRepository;
        this.adminEmail = adminEmail;
        this.adminPassword = adminPassword;
    }

    @Override
    public void run(String... args) {
        if (adminEmail.isBlank() || adminPassword.isBlank()) return;

        String email = adminEmail.trim().toLowerCase();
        User user = userRepository.findByEmailIgnoreCase(email).orElseGet(() -> {
            User u = new User();
            u.setEmail(email);
            return u;
        });
        user.setPasswordHash(passwordEncoder.encode(adminPassword));
        userRepository.save(user);
    }
}
