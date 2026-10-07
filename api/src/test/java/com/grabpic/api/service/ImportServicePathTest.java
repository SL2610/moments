package com.grabpic.api.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ImportServicePathTest {

    @TempDir
    Path root;

    private ImportService service() {
        return new ImportService(null, null, null, null, root.toString(), 10);
    }

    @Test
    void bareFolderNameResolvesUnderImportRoot() throws Exception {
        Files.createDirectory(root.resolve("golden"));
        assertNull(service().startImport(UUID.randomUUID(), "host", "golden"));
    }

    @Test
    void absolutePathInsideRootStillWorks() throws Exception {
        Files.createDirectory(root.resolve("golden"));
        assertNull(service().startImport(UUID.randomUUID(), "host", root.resolve("golden").toString()));
    }

    @Test
    void traversalOutsideRootIsRejected() {
        assertEquals("Import path must be inside " + root + ".",
                service().startImport(UUID.randomUUID(), "host", ".."));
    }

    @Test
    void missingFolderIsRejected() {
        String error = service().startImport(UUID.randomUUID(), "host", "nope");
        assertEquals(true, error.startsWith("Import folder not found"));
    }
}
