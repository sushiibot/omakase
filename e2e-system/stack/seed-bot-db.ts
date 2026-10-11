// Seeds a community-bot database the way production holds it before the personal gateway moved out, so the
// gateway's one-shot import runs at boot (flows/bot-import). Run with the repo as cwd: the drizzle migrations
// resolve from it. Usage: bun e2e-system/stack/seed-bot-db.ts <path>
import { Database } from "bun:sqlite";
import { BOT_SEED } from "./bot-seed.ts";

const path = process.argv[2];
if (!path) throw new Error("usage: seed-bot-db.ts <path>");
// A computed path, so the harness typecheck does not pull in the gateway's whole type graph.
const { applySchema } = (await import(new URL("../../src/db/index.ts", import.meta.url).href)) as { applySchema(db: Database): unknown };
const db = new Database(path);
db.exec("PRAGMA journal_mode = WAL");
applySchema(db);
const at = Date.UTC(2026, 0, 1, 12, 0, 0);
const event = db.prepare("INSERT INTO web_events (seq, conversation_id, type, key, data, created_at) VALUES (?, 'main', ?, ?, ?, ?)");
event.run(1, "user", "e2e-botdb-q", JSON.stringify({ key: "e2e-botdb-q", text: BOT_SEED.question, uploadIds: [], at: new Date(at).toISOString() }), at);
event.run(2, "reply", "e2e-botdb-a", JSON.stringify({ key: "e2e-botdb-a", text: BOT_SEED.answer, files: [] }), at + 1000);
db.run("UPDATE sqlite_sequence SET seq = ? WHERE name = 'web_events'", [BOT_SEED.webEventsSeq]);
db.run("INSERT INTO workspace_outbox_seen (outbox_id, principal_id, seen_at) VALUES ('e2e-botdb-outbox', 'owner', ?)", [at]);
db.run("INSERT INTO kv (key, value) VALUES ('web_chat_fts:indexed_through', '2'), ('buzz:e2e', 'community')");
db.run("INSERT INTO conversations (thread_id, guild_id, messages, created_at, updated_at) VALUES ('e2e-discord-thread', 'g1', '[]', ?, ?)", [at, at]);
db.close();
