package com.grabpic.api.service;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jose.crypto.MACVerifier;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;

@Service
public class JwtService {

    public static final Duration ACCESS_TOKEN_TTL = Duration.ofHours(1);
    public static final Duration REFRESH_TOKEN_TTL = Duration.ofDays(30);

    private final byte[] secret;
    private final String issuer;

    public JwtService(@Value("${auth.jwt.secret}") String secret,
                      @Value("${auth.jwt.issuer}") String issuer) {
        if (secret == null || secret.getBytes(StandardCharsets.UTF_8).length < 32) {
            throw new IllegalStateException("JWT_SECRET must be at least 32 bytes. Generate one with: openssl rand -base64 48");
        }
        this.secret = secret.getBytes(StandardCharsets.UTF_8);
        this.issuer = issuer;
    }

    public String issueAccessToken(String userId, String email) {
        return issue(userId, email, "access", ACCESS_TOKEN_TTL);
    }

    public String issueRefreshToken(String userId, String email) {
        return issue(userId, email, "refresh", REFRESH_TOKEN_TTL);
    }

    /** Wedding guest token: sub = guest id, "name" claim, 30-day validity. */
    public String issueGuestToken(String guestId, String name) {
        try {
            Instant now = Instant.now();
            JWTClaimsSet claims = new JWTClaimsSet.Builder()
                    .subject(guestId)
                    .issuer(issuer)
                    .claim("name", name)
                    .claim("typ", "guest")
                    .issueTime(Date.from(now))
                    .expirationTime(Date.from(now.plus(Duration.ofDays(30))))
                    .build();
            SignedJWT jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), claims);
            jwt.sign(new MACSigner(secret));
            return jwt.serialize();
        } catch (Exception e) {
            throw new IllegalStateException("Failed to sign JWT", e);
        }
    }

    private String issue(String userId, String email, String type, Duration ttl) {
        try {
            Instant now = Instant.now();
            JWTClaimsSet claims = new JWTClaimsSet.Builder()
                    .subject(userId)
                    .issuer(issuer)
                    .claim("email", email)
                    .claim("typ", type)
                    .issueTime(Date.from(now))
                    .expirationTime(Date.from(now.plus(ttl)))
                    .build();
            SignedJWT jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), claims);
            jwt.sign(new MACSigner(secret));
            return jwt.serialize();
        } catch (Exception e) {
            throw new IllegalStateException("Failed to sign JWT", e);
        }
    }

    /**
     * Validates a refresh token (signature, issuer, expiry, typ=refresh).
     * Returns its claims, or null if invalid.
     */
    public JWTClaimsSet verifyRefreshToken(String token) {
        try {
            SignedJWT jwt = SignedJWT.parse(token);
            if (!jwt.verify(new MACVerifier(secret))) return null;
            JWTClaimsSet claims = jwt.getJWTClaimsSet();
            if (!issuer.equals(claims.getIssuer())) return null;
            if (!"refresh".equals(claims.getStringClaim("typ"))) return null;
            Date exp = claims.getExpirationTime();
            if (exp == null || exp.before(new Date())) return null;
            return claims;
        } catch (Exception e) {
            return null;
        }
    }
}
