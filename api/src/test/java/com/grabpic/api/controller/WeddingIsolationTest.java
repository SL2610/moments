package com.grabpic.api.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.grabpic.api.model.SharedAlbum;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;

/** One server, many weddings: a token only ever reaches its own album. */
class WeddingIsolationTest {

    private static final UUID ALBUM = UUID.randomUUID();
    private static final String HOST = "host-1";

    private static Jwt guest(UUID album) {
        return Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("typ", "guest").claim("album", album.toString()).build();
    }

    private static Jwt admin(String userId) {
        return Jwt.withTokenValue("t").header("alg", "none").subject(userId).claim("typ", "access").build();
    }

    private static SharedAlbum album() {
        SharedAlbum album = new SharedAlbum();
        album.setId(ALBUM);
        album.setHostId(HOST);
        return album;
    }

    @Test
    void guestReadsOnlyTheirOwnWedding() {
        assertTrue(AlbumController.canReadAsGuest(album(), guest(ALBUM)));
        assertFalse(AlbumController.canReadAsGuest(album(), guest(UUID.randomUUID())));
    }

    @Test
    void adminReadsOnlyAlbumsTheyHost() {
        assertTrue(AlbumController.canReadAsGuest(album(), admin(HOST)));
        assertFalse(AlbumController.canReadAsGuest(album(), admin("someone-else")));
    }

    @Test
    void weddingEndpointsTakeTheAlbumFromGuestTokensOnly() {
        assertEquals(ALBUM, WeddingController.albumOf(guest(ALBUM)));
        assertNull(WeddingController.albumOf(admin(HOST)));
    }
}
