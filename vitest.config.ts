import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        // Exclude the backend package (it has its own vitest.config.ts) and
        // local-only git worktrees (Claude Code keeps copies under .claude/).
        exclude: ["**/node_modules/**", "backend/**", ".claude/**", ".worktrees/**"],
        alias: {
            "@/": new URL("./src/", import.meta.url).pathname,
        },
    },
});
