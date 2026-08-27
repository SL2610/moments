package com.grabpic.api.controller;

import com.grabpic.api.model.User;
import com.grabpic.api.repository.UserRepository;
import com.grabpic.api.service.JwtService;
import com.nimbusds.jwt.JWTClaimsSet;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.Optional;
import java.util.regex.Pattern;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private static final Pattern EMAIL_PATTERN =
            Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");
    private static final int MIN_PASSWORD_LENGTH = 8;

    private final UserRepository userRepository;
    private final JwtService jwtService;
    private final boolean allowRegistration;
    private final BCryptPasswordEncoder passwordEncoder = new BCryptPasswordEncoder();

    public AuthController(UserRepository userRepository,
                          JwtService jwtService,
                          @Value("${auth.allow-registration}") boolean allowRegistration) {
        this.userRepository = userRepository;
        this.jwtService = jwtService;
        this.allowRegistration = allowRegistration;
    }

    public record Credentials(String email, String password) {}
    public record RefreshRequest(String refreshToken) {}

    @PostMapping("/register")
    public ResponseEntity<?> register(@RequestBody Credentials request) {
        if (!allowRegistration) {
            return ResponseEntity.status(403)
                    .body(Map.of("error", "Registration is disabled on this server."));
        }
        String email = request.email() == null ? "" : request.email().trim().toLowerCase();
        String password = request.password() == null ? "" : request.password();

        if (!EMAIL_PATTERN.matcher(email).matches()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Please enter a valid email address."));
        }
        if (password.length() < MIN_PASSWORD_LENGTH) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Password must be at least " + MIN_PASSWORD_LENGTH + " characters."));
        }
        if (userRepository.existsByEmailIgnoreCase(email)) {
            return ResponseEntity.status(409).body(Map.of("error", "An account with this email already exists."));
        }

        User user = new User();
        user.setEmail(email);
        user.setPasswordHash(passwordEncoder.encode(password));
        User saved = userRepository.save(user);

        return ResponseEntity.ok(tokenResponse(saved));
    }

    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody Credentials request) {
        String email = request.email() == null ? "" : request.email().trim().toLowerCase();
        String password = request.password() == null ? "" : request.password();

        Optional<User> userOpt = userRepository.findByEmailIgnoreCase(email);
        if (userOpt.isEmpty() || !passwordEncoder.matches(password, userOpt.get().getPasswordHash())) {
            return ResponseEntity.status(401).body(Map.of("error", "Invalid email or password."));
        }
        return ResponseEntity.ok(tokenResponse(userOpt.get()));
    }

    @PostMapping("/refresh")
    public ResponseEntity<?> refresh(@RequestBody RefreshRequest request) {
        JWTClaimsSet claims = request.refreshToken() == null
                ? null
                : jwtService.verifyRefreshToken(request.refreshToken());
        if (claims == null) {
            return ResponseEntity.status(401).body(Map.of("error", "Invalid or expired session. Please sign in again."));
        }
        Optional<User> userOpt = userRepository.findById(java.util.UUID.fromString(claims.getSubject()));
        if (userOpt.isEmpty()) {
            return ResponseEntity.status(401).body(Map.of("error", "Account no longer exists."));
        }
        return ResponseEntity.ok(tokenResponse(userOpt.get()));
    }

    private Map<String, Object> tokenResponse(User user) {
        String userId = user.getId().toString();
        return Map.of(
                "accessToken", jwtService.issueAccessToken(userId, user.getEmail()),
                "refreshToken", jwtService.issueRefreshToken(userId, user.getEmail()),
                "expiresIn", JwtService.ACCESS_TOKEN_TTL.toSeconds(),
                "user", Map.of("id", userId, "email", user.getEmail())
        );
    }
}
