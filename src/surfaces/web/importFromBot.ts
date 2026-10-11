import type { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { getLogger } from "../../logger.ts";

const log = getLogger("web/importFromBot");

export const IMPORT_MARKER_KEY = "personal:imported_from_bot";

/** Every table the personal gateway owns. web_chat_fts is left out: the chat index rebuilds it. */
export const IMPORTED_TABLES = [
  "web_alerts",
  "web_dismissed_runs",
  "web_events",
  "web_inbound",
  "web_inbox",
  "web_opened_runs",
  "web_push_subscriptions",
  "web_threads",
  "web_turn_anchors",
  "web_uploads",
  "workspace_inbox",
  "workspace_outbox_seen",
] as const;

/** kv keys the personal gateway writes. `web_chat_fts:*` stays behind so the index rebuilds from zero. */
const KV_GLOBS = ["workspace:*", "web_events:*", "web_uploads:*"];
const SEQUENCES = ["web_events", "workspace_inbox"];
const SOURCE = "bot";

export type ImportCounts = Record<string, number>;

export type ImportResult =
  | { status: "imported"; counts: ImportCounts }
  | { status: "skipped"; reason: "already_imported" | "no_source" };

/**
 * Copies the personal gateway's tables out of the bot's database into this (personal) one, once.
 * Runs after migrations and before anything listens. Never merges: a personal DB that already holds
 * personal rows without the marker is refused, so a wrong mount can't double the history.
 */
export function importFromBot(db: Database, sourcePath: string | undefined, now: () => number = Date.now): ImportResult {
  const marker = db.query("SELECT value FROM kv WHERE key = ?").get(IMPORT_MARKER_KEY);
  if (marker) return { status: "skipped", reason: "already_imported" };
  if (!sourcePath) return { status: "skipped", reason: "no_source" };
  // A wrong mount would otherwise start empty, then refuse to merge once the mount is fixed.
  if (!existsSync(sourcePath)) throw new Error(`bot database import: IMPORT_FROM_DATABASE_PATH ${sourcePath} does not exist`);

  assertTableListCovers(db);
  assertEmpty(db);

  db.run(`ATTACH DATABASE ? AS ${SOURCE}`, [sourcePath]);
  try {
    assertSameMigrationHead(db);
    const counts = db.transaction(() => {
      const counts: ImportCounts = {};
      for (const table of IMPORTED_TABLES) {
        const cols = columnList(db, table);
        counts[table] = db.run(`INSERT INTO main."${table}" (${cols}) SELECT ${cols} FROM ${SOURCE}."${table}"`).changes;
      }
      const kvCols = columnList(db, "kv");
      const kvWhere = KV_GLOBS.map(() => "key GLOB ?").join(" OR ");
      counts["kv"] = db.run(`INSERT INTO main.kv (${kvCols}) SELECT ${kvCols} FROM ${SOURCE}.kv WHERE ${kvWhere}`, KV_GLOBS).changes;
      for (const name of SEQUENCES) {
        const src = all<{ seq: number }>(db, `SELECT seq FROM ${SOURCE}.sqlite_sequence WHERE name = ?`, [name])[0];
        if (!src) continue;
        // Copying explicit ids already bumped main's counter; keep whichever is higher.
        const updated = db.run("UPDATE main.sqlite_sequence SET seq = max(seq, ?) WHERE name = ?", [src.seq, name]).changes;
        if (updated === 0) db.run("INSERT INTO main.sqlite_sequence (name, seq) VALUES (?, ?)", [name, src.seq]);
      }
      db.run("INSERT INTO main.kv (key, value) VALUES (?, ?)", [IMPORT_MARKER_KEY, JSON.stringify({ at: now(), counts })]);
      return counts;
    })();
    return { status: "imported", counts };
  } finally {
    db.run(`DETACH DATABASE ${SOURCE}`);
  }
}

/** Runs the import and logs what it did. Throws on a refusal, so startup exits before listening. */
export function runImportFromBot(db: Database, sourcePath: string | undefined): ImportResult {
  const result = importFromBot(db, sourcePath);
  if (result.status === "imported") log.info({ counts: result.counts, source: sourcePath }, "imported personal tables from the bot database");
  else log.info({ reason: result.reason }, "bot database import skipped");
  return result;
}

/** Statements on the attached DB must be finalized, or DETACH fails with "database is locked". */
function all<T>(db: Database, sql: string, params: (string | number)[] = []): T[] {
  const stmt = db.prepare(sql);
  try {
    return stmt.all(...params) as T[];
  } finally {
    stmt.finalize();
  }
}

function columns(db: Database, schema: string, table: string): string[] {
  return all<{ name: string }>(db, `PRAGMA ${schema}.table_info("${table}")`).map((c) => c.name);
}

function columnList(db: Database, table: string): string {
  const mine = columns(db, "main", table);
  const theirs = columns(db, SOURCE, table);
  if (mine.length === 0 || mine.join(",") !== theirs.join(",")) {
    throw new Error(`bot database import: ${table} columns differ (personal: ${mine.join(",")}; bot: ${theirs.join(",")})`);
  }
  return mine.map((c) => `"${c}"`).join(", ");
}

/** A new personal table that isn't on the import list would silently stay behind in the bot DB. */
function assertTableListCovers(db: Database): void {
  const tables = all<{ name: string }>(
    db,
    "SELECT name FROM main.sqlite_master WHERE type = 'table' AND (name GLOB 'web_*' OR name GLOB 'workspace_*') AND name NOT GLOB 'web_chat_fts*'",
  ).map((t) => t.name);
  const known = new Set<string>(IMPORTED_TABLES);
  const unknown = tables.filter((t) => !known.has(t));
  if (unknown.length) throw new Error(`bot database import: tables not on the import list: ${unknown.join(", ")}`);
}

function assertEmpty(db: Database): void {
  const nonEmpty: string[] = IMPORTED_TABLES.filter((t) => all(db, `SELECT 1 FROM main."${t}" LIMIT 1`).length > 0);
  const kvWhere = KV_GLOBS.map(() => "key GLOB ?").join(" OR ");
  if (all(db, `SELECT 1 FROM main.kv WHERE ${kvWhere} LIMIT 1`, KV_GLOBS).length > 0) nonEmpty.push("kv");
  if (nonEmpty.length) {
    throw new Error(
      `bot database import: the personal database already has rows in ${nonEmpty.join(", ")} but no ${IMPORT_MARKER_KEY} marker; refusing to merge`,
    );
  }
}

function assertSameMigrationHead(db: Database): void {
  // __drizzle_migrations.id is not a rowid alias in SQLite (always NULL), so order by created_at.
  const head = (schema: string) =>
    all<{ hash: string }>(db, `SELECT hash FROM ${schema}.__drizzle_migrations ORDER BY created_at DESC LIMIT 1`)[0]?.hash ?? null;
  const mine = head("main");
  const theirs = head(SOURCE);
  if (!mine || mine !== theirs) {
    throw new Error(`bot database import: migration heads differ (personal: ${mine}; bot: ${theirs}); deploy the same version to both first`);
  }
}
