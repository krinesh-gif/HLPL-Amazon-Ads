import { db, initSchema } from "../db/client.js";

export type SyncJob = "profiles" | "campaigns" | "reports" | "keywords" | "targeting" | "search-terms" | "sb" | "sd";

/**
 * Wraps a sync job so every run is logged to `sync_runs` (success or failure).
 * The dashboard's Sync status screen reads this table; the job itself stays unaware of it.
 */
export async function recordSyncRun(
  job: SyncJob,
  detail: string | null,
  run: () => Promise<number>
): Promise<number> {
  initSchema();
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO sync_runs (job, started_at, status, detail) VALUES (?, ?, 'running', ?)`)
    .run(job, new Date().toISOString(), detail);

  const finish = db.prepare(
    `UPDATE sync_runs SET finished_at = ?, status = ?, rows_synced = ?, detail = ? WHERE id = ?`
  );
  try {
    const rows = await run();
    finish.run(new Date().toISOString(), "success", rows, detail, lastInsertRowid);
    return rows;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    finish.run(new Date().toISOString(), "failed", null, message.slice(0, 1000), lastInsertRowid);
    throw err;
  }
}
