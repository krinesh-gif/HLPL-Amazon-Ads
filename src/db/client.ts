import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { dbPath } from "../config/paths.js";

mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

export function initSchema(): void {
  const schema = readFileSync(new URL("./schema.sql", import.meta.url), "utf-8");
  db.exec(schema);
}
