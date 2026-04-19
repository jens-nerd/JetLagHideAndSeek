/**
 * Global test setup — runs once per worker before any test file.
 *
 * Sets DB_PATH=:memory: (via vitest.config env) so the global `db` singleton
 * opens an in-memory database rather than writing to a file on disk.
 * WS handlers receive the test DB injected via attachWsServer/handleWsOpen, so
 * they never touch this global DB during integration tests.
 */

// Nothing to do — the env: { DB_PATH: ":memory:" } in vitest.config.ts handles
// the rest.  This file exists so future global setup steps have a home.
