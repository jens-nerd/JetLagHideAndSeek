/**
 * Shared Drizzle database type used by routers and tests.
 * Kept here to avoid importing the real DB singleton in test files.
 */
import type { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof drizzle<typeof schema>>;
