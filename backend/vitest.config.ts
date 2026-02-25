import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        // Run tests sequentially so that in-memory SQLite databases
        // created in beforeEach don't interfere with each other.
        pool: "forks",
        poolOptions: { forks: { singleFork: true } },
        // Suppress Hono's request logger output during tests
        silent: false,
    },
});
