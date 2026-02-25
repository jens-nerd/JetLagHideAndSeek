import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        // Exclude the backend package (it has its own vitest.config.ts)
        exclude: ["**/node_modules/**", "backend/**"],
        alias: {
            "@/": new URL("./src/", import.meta.url).pathname,
        },
    },
});
