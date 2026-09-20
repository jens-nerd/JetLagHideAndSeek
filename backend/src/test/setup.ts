/**
 * Global test setup — runs once per worker before any test file.
 *
 * Sets DB_PATH=:memory: (via vitest.config env) so the global `db` singleton
 * opens an in-memory database rather than writing to a file on disk.
 * WS handlers receive the test DB injected via attachWsServer/handleWsOpen, so
 * they never touch this global DB during integration tests.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// DB_PATH kommt aus env: { DB_PATH: ":memory:" } in vitest.config.ts.
//
// routes/upload.ts liest UPLOADS_DIR beim Laden des Moduls und legt das
// Verzeichnis sofort an. Ohne die Zeile unten schreiben die Upload-Tests nach
// backend/uploads, also mitten in den Arbeitsbaum.
process.env.UPLOADS_DIR ??= mkdtempSync(
    join(tmpdir(), "hideandseek-test-uploads-"),
);
