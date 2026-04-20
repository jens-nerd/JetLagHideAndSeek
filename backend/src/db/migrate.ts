/**
 * CLI migration entry point. Opens the real DB and delegates to runMigrations.
 * Run on first deploy and after every schema change: pnpm db:migrate
 */
import Database from "better-sqlite3";

import { runMigrations } from "./migrator.js";

const DB_PATH = process.env.DB_PATH ?? "./hideandseek.db";
const sqlite = new Database(DB_PATH);

sqlite.pragma("journal_mode = WAL");
runMigrations(sqlite);

console.log(`Migrated ${DB_PATH} to current schema.`);
