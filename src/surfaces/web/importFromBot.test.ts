import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySchema } from "../../db/index.ts";
import { ChatIndex, searchChat } from "./chatSearch.ts";
import { IMPORT_MARKER_KEY, IMPORTED_TABLES, importFromBot } from "./importFromBot.ts";

const T0 = Date.parse("2026-10-01T10:00:00.000Z");

let dir: string;
let botPath: string;
let personalPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "import-from-bot-"));
  botPath = join(dir, "sushii-agent.db");
  personalPath = join(dir, "personal.db");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function open(path: string): Database {
  const db = new Database(path);
  db.exec("PRAGMA journal_mode = WAL");
  applySchema(db);
  return db;
}

/** A bot DB the way production has it: chat (live and imported seqs), workspace rows, an FTS index
 *  already built, community rows that must stay behind, and a sequence ahead of max(seq) after pruning. */
function seedBot(): Database {
  const db = open(botPath);
  const event = db.prepare("INSERT INTO web_events (seq, conversation_id, type, key, data, created_at, sort_seq) VALUES (?, 'main', ?, ?, ?, ?, NULL)");
  event.run(-2, "user", "pi:a", JSON.stringify({ key: "pi:a", text: "imported pelican question", uploadIds: [], at: "2025-01-01T00:00:00.000Z" }), T0 - 5000);
  event.run(-1, "reply", "pi:b", JSON.stringify({ key: "pi:b", text: "imported pelican answer", files: [] }), T0 - 4000);
  event.run(1, "user", "c1", JSON.stringify({ key: "c1", text: "live walrus question", uploadIds: [], at: "2026-10-01T10:00:00.000Z" }), T0);
  event.run(2, "reply", "o1", JSON.stringify({ key: "o1", text: "live walrus answer", files: [] }), T0 + 1000);
  event.run(3, "typing", null, "{}", T0 + 2000);
  db.run("UPDATE sqlite_sequence SET seq = 40 WHERE name = 'web_events'");
  db.run("INSERT INTO web_threads (id, title, brief, created_at) VALUES ('t1', 'Trip', 'plan it', ?)", [T0]);
  db.run("INSERT INTO workspace_inbox (id, principal_id, user_text, reply_text, created_at) VALUES (7, 'drk', 'hi', 'hello', ?)", [T0]);
  db.run("INSERT INTO workspace_outbox_seen (outbox_id, principal_id, seen_at) VALUES ('ob1', 'drk', ?), ('ob2', 'drk', ?)", [T0, T0]);
  const kv = db.prepare("INSERT INTO kv (key, value) VALUES (?, ?)");
  kv.run("workspace:progress:drk", '{"open":[],"ended":[]}');
  kv.run("web_events:pi_import_done", '{"imported":2}');
  kv.run("web_uploads:photo_quota_warned", "1");
  kv.run("web_chat_fts:indexed_through", "2");
  kv.run("buzz:cursor", "community state");
  const index = new ChatIndex(db);
  while (index.catchUp()) {}
  db.run("INSERT INTO conversations (thread_id, guild_id, messages, created_at, updated_at) VALUES ('discord-thread', 'g1', '[]', ?, ?)", [T0, T0]);
  return db;
}

const count = (db: Database, table: string) => (db.query(`SELECT count(*) AS n FROM "${table}"`).get() as { n: number }).n;
const seq = (db: Database, name: string) => (db.query("SELECT seq FROM sqlite_sequence WHERE name = ?").get(name) as { seq: number } | null)?.seq;

describe("importFromBot", () => {
  test("copies every personal table and kv prefix, carries sqlite_sequence, and writes the marker", () => {
    seedBot().close();
    const db = open(personalPath);
    const result = importFromBot(db, botPath, () => 123);
    expect(result).toEqual({
      status: "imported",
      counts: {
        web_alerts: 0,
        web_dismissed_runs: 0,
        web_events: 5,
        web_inbound: 0,
        web_inbox: 0,
        web_opened_runs: 0,
        web_push_subscriptions: 0,
        web_threads: 1,
        web_turn_anchors: 0,
        web_uploads: 0,
        workspace_inbox: 1,
        workspace_outbox_seen: 2,
        kv: 3,
      },
    });
    expect(seq(db, "web_events")).toBe(40);
    expect(seq(db, "workspace_inbox")).toBe(7);
    const keys = (db.query("SELECT key FROM kv ORDER BY key").all() as { key: string }[]).map((r) => r.key);
    expect(keys).toEqual([IMPORT_MARKER_KEY, "web_events:pi_import_done", "web_uploads:photo_quota_warned", "workspace:progress:drk"]);
    const marker = JSON.parse((db.query("SELECT value FROM kv WHERE key = ?").get(IMPORT_MARKER_KEY) as { value: string }).value);
    expect(marker).toEqual({ at: 123, counts: (result as { counts: unknown }).counts });
    expect(count(db, "conversations")).toBe(0);
    expect(db.query("SELECT data FROM web_events WHERE seq = -2").get()).toEqual({ data: expect.stringContaining("pelican") });
    // The next live event continues after the bot's sequence, not after max(seq).
    db.run("INSERT INTO web_events (conversation_id, type, data, created_at) VALUES ('main', 'typing', '{}', ?)", [T0]);
    expect(seq(db, "web_events")).toBe(41);
    expect(db.query("PRAGMA database_list").all()).toHaveLength(1);
    db.close();
  });

  test("a second boot is a no-op", () => {
    seedBot().close();
    const db = open(personalPath);
    expect(importFromBot(db, botPath).status).toBe("imported");
    const before = count(db, "web_events");
    expect(importFromBot(db, botPath)).toEqual({ status: "skipped", reason: "already_imported" });
    expect(count(db, "web_events")).toBe(before);
    db.close();
  });

  test("search finds imported and live chat once the index catches up", () => {
    seedBot().close();
    const db = open(personalPath);
    importFromBot(db, botPath);
    expect(searchChat(db, "walrus", 10).hits).toHaveLength(0);
    const index = new ChatIndex(db);
    while (index.catchUp()) {}
    expect(searchChat(db, "walrus", 10).hits.map((h) => h.role)).toEqual(["agent", "user"]);
    expect(searchChat(db, "pelican", 10).hits).toHaveLength(2);
    db.run("INSERT INTO web_chat_fts(web_chat_fts) VALUES ('integrity-check')");
    db.close();
  });

  test("a personal DB with rows and no marker is refused and left untouched", () => {
    seedBot().close();
    const db = open(personalPath);
    db.run("INSERT INTO web_threads (id, title, brief, created_at) VALUES ('mine', 'x', 'y', 1)");
    expect(() => importFromBot(db, botPath)).toThrow("refusing to merge");
    expect(count(db, "web_threads")).toBe(1);
    expect(db.query("SELECT 1 FROM kv WHERE key = ?").get(IMPORT_MARKER_KEY)).toBeNull();
    db.close();
  });

  test("a personal kv key without the marker also counts as data", () => {
    seedBot().close();
    const db = open(personalPath);
    db.run("INSERT INTO kv (key, value) VALUES ('workspace:progress:drk', '{}')");
    expect(() => importFromBot(db, botPath)).toThrow("kv");
    db.close();
  });

  test("an unset source skips without writing a marker", () => {
    const db = open(personalPath);
    expect(importFromBot(db, undefined)).toEqual({ status: "skipped", reason: "no_source" });
    expect(db.query("SELECT 1 FROM kv WHERE key = ?").get(IMPORT_MARKER_KEY)).toBeNull();
    db.close();
  });

  test("a set but missing source is fatal, so a wrong mount never starts empty", () => {
    const db = open(personalPath);
    expect(() => importFromBot(db, join(dir, "nope.db"))).toThrow("does not exist");
    expect(db.query("SELECT 1 FROM kv WHERE key = ?").get(IMPORT_MARKER_KEY)).toBeNull();
    expect(db.query("PRAGMA database_list").all()).toHaveLength(1);
    db.close();
  });

  test("a different migration head aborts before copying anything", () => {
    const bot = seedBot();
    bot.run("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('future', 9999999999999)");
    bot.close();
    const db = open(personalPath);
    expect(() => importFromBot(db, botPath)).toThrow("migration heads differ");
    expect(count(db, "web_events")).toBe(0);
    expect(db.query("PRAGMA database_list").all()).toHaveLength(1);
    db.close();
  });

  test("the bot keeps working on its database during and after the import", () => {
    const bot = seedBot();
    const db = open(personalPath);
    importFromBot(db, botPath);
    bot.run("INSERT INTO conversations (thread_id, guild_id, messages, created_at, updated_at) VALUES ('after', 'g1', '[]', ?, ?)", [T0, T0]);
    expect(count(bot, "conversations")).toBe(2);
    expect(count(bot, "web_events")).toBe(5);
    bot.close();
    db.close();
  });

  test("the import list names every personal table in the schema", () => {
    const db = open(personalPath);
    const tables = (
      db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND (name GLOB 'web_*' OR name GLOB 'workspace_*') AND name NOT GLOB 'web_chat_fts*' ORDER BY name").all() as { name: string }[]
    ).map((t) => t.name);
    expect(tables).toEqual([...IMPORTED_TABLES]);
    db.close();
  });
});
