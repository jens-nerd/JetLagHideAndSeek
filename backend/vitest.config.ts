import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        // Run tests sequentially so that in-memory SQLite databases
        // created in beforeEach don't interfere with each other.
        pool: "forks",
        poolOptions: { forks: { singleFork: true } },
        // Suppress Hono's request logger output during tests
        silent: false,
        // Point the global DB singleton at :memory: so the WS handler
        // (which imports db/index.ts directly) doesn't use a stale file.
        env: { DB_PATH: ":memory:" },
        setupFiles: ["./src/test/setup.ts"],
    },
});
