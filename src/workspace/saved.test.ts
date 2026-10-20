import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SAVED_CHANGED, SAVED_MANAGE } from "../orchestration/savedContracts.ts";
import { artifactDocument } from "../orchestration/artifactContracts.ts";
import type { LiveBlockRecord } from "../orchestration/blockContracts.ts";
import { ArtifactStore } from "./artifacts.ts";
import { BlockStore } from "./blocks.ts";
import { blockStatus, documentStatus, SavedStore } from "./saved.ts";

const KEY = "01JABCDEFGHJKMNPQRSTVWXYZ0";
const OTHER = "01JABCDEFGHJKMNPQRSTVWXYZ1";
const REPLY = "01JABCDEFGHJKMNPQRSTVWXYZ2";
const fence = (type: string, body: string) => "```" + type + "\n" + body + "\n```";
const reply = [
  fence("checklist", "title: Groceries\nitems: [milk, eggs]"),
  fence("timer", "label: Tea\nduration: 4m"),
  fence("choice", "question: Which?\noptions: [a, b]"),
].join("\n\n");
const recipe = fence("recipe", "title: Pancakes\nserves: 2\ningredients:\n  - {item: flour, qty: 100, unit: g}\n  - {item: milk, qty: 200, unit: ml}\nsteps: [Mix, Fry]");

const H = 3600_000;
let dir: string;
let now: Date;
let notified: { method: string; params: unknown }[];
const clock = () => now;
const setup = () => {
  const blocks = new BlockStore(dir, { principalId: "p1", now: clock });
  const saved = new SavedStore(dir, { principalId: "p1", notify: (method, params) => notified.push({ method, params }), now: clock, blocks });
  return { blocks, saved, artifacts: saved.artifacts };
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "saved-"));
  now = new Date("2026-10-20T12:00:00.000Z");
  notified = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const block = (over: Partial<LiveBlockRecord>): LiveBlockRecord => ({
  id: `${KEY}.0`, messageKey: KEY, index: 0, conversationId: "main", type: "checklist", title: "List", fingerprint: "00000000",
  data: { items: [] }, state: {}, revision: 1, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-20T12:00:00.000Z",
  updatedBy: "agent", changes: [], ...over,
});
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

describe("status rules", () => {
  test("a checklist is done when every item is ticked and it hasn't changed for 24h", () => {
    const all = { items: [{ id: 0, text: "a", done: true }, { id: 1, text: "b", done: true }] };
    expect(blockStatus(block({ state: all, updatedAt: ago(23 * H) }), {}, now)).toBe("active");
    expect(blockStatus(block({ state: all, updatedAt: ago(24 * H) }), {}, now)).toBe("done");
    expect(blockStatus(block({ state: { items: [{ id: 0, text: "a", done: false }] }, updatedAt: ago(900 * H) }), {}, now)).toBe("active");
    expect(blockStatus(block({ state: { items: [] }, updatedAt: ago(900 * H) }), {}, now)).toBe("active");
    // Opening it counts as use.
    expect(blockStatus(block({ state: all, updatedAt: ago(48 * H) }), { openedAt: ago(H) }, now)).toBe("active");
  });

  test("a timer is done once finished, or after 7 days unstarted; running is active", () => {
    const timer = (state: LiveBlockRecord["state"], updatedAt = ago(H)) => block({ type: "timer", data: { label: "Tea", duration: 240 }, state, updatedAt });
    expect(blockStatus(timer({ endsAt: new Date(now.getTime() + 60_000).toISOString(), left: 240 }), {}, now)).toBe("active");
    expect(blockStatus(timer({ endsAt: ago(1000), left: 240 }), {}, now)).toBe("done");
    expect(blockStatus(timer({ endsAt: null, left: 240 }, ago(6 * 24 * H)), {}, now)).toBe("active");
    expect(blockStatus(timer({ endsAt: null, left: 240 }, ago(7 * 24 * H)), {}, now)).toBe("done");
    // A restore after it finished brings it back.
    expect(blockStatus(timer({ endsAt: ago(10 * H), left: 240 }, ago(10 * H)), { touchedAt: ago(H) }, now)).toBe("active");
  });

  test("a recipe or document is done after 30 days without an update or opening", () => {
    const r = (updatedAt: string) => block({ type: "recipe", data: { title: "P", ingredients: [], steps: [] }, updatedAt });
    expect(blockStatus(r(ago(29 * 24 * H)), {}, now)).toBe("active");
    expect(blockStatus(r(ago(30 * 24 * H)), {}, now)).toBe("done");
    expect(documentStatus({ updatedAt: ago(31 * 24 * H) }, {}, now)).toBe("done");
    expect(documentStatus({ updatedAt: ago(31 * 24 * H) }, { openedAt: ago(24 * H) }, now)).toBe("active");
  });

  test("pinned is always active; archived is done until restored", () => {
    const stale = block({ type: "recipe", data: { title: "P", ingredients: [], steps: [] }, updatedAt: ago(90 * 24 * H) });
    expect(blockStatus(stale, { pinned: true }, now)).toBe("active");
    expect(blockStatus(block({}), { archivedAt: ago(1) }, now)).toBe("done");
    expect(documentStatus({ updatedAt: ago(1) }, { archivedAt: ago(1) }, now)).toBe("done");
    expect(documentStatus({ updatedAt: ago(90 * 24 * H) }, { pinned: true, archivedAt: ago(1) }, now)).toBe("active");
  });
});

describe("saved store", () => {
  test("lists documents and saved blocks, not reply blocks, with provenance and summaries", () => {
    const { blocks, saved, artifacts } = setup();
    const doc = artifacts.save({ title: "Trip plan", content: "# Plan\n\nFly on **Friday**, back Sunday." }, "trip");
    blocks.register("main", KEY, reply);
    const { items } = saved.list({ status: "all" });
    expect(items.map((i) => [i.kind, i.title]).sort()).toEqual([["checklist", "Groceries"], ["document", "Trip plan"], ["timer", "Tea"]]);
    expect(items.find((i) => i.kind === "checklist")).toMatchObject({ id: `${KEY}.0`, conversationId: "main", sourceMessageId: KEY, status: "active", pinned: false, summary: "0 of 2 done" });
    expect(items.find((i) => i.kind === "timer")?.summary).toBe("Not started · 4:00");
    expect(items.find((i) => i.kind === "document")).toMatchObject({ id: doc.id, conversationId: "trip", sourceMessageId: null, summary: "Version 1 · Plan Fly on Friday, back Sunday." });
  });

  test("filters by conversation, kind, status, pin and search", () => {
    const { blocks, saved, artifacts } = setup();
    artifacts.save({ title: "Report", content: "The budget is 42." }, "work");
    blocks.register("main", KEY, reply);
    blocks.register("trip", OTHER, recipe);
    const ids = (filter: Parameters<SavedStore["list"]>[0]) => saved.list(filter).items.map((i) => i.title).sort();
    expect(ids({ conversationId: "trip" })).toEqual(["Pancakes"]);
    expect(ids({ kind: "timer" })).toEqual(["Tea"]);
    expect(ids({ query: "budget" })).toEqual(["Report"]);
    expect(ids({ query: "flour" })).toEqual(["Pancakes"]);
    expect(ids({ query: "eggs" })).toEqual(["Groceries"]);
    saved.act(`${KEY}.1`, "pin");
    expect(ids({ pinned: true })).toEqual(["Tea"]);
    expect(saved.list({}).items[0]?.title).toBe("Tea");
    saved.act(`${OTHER}.0`, "archive");
    expect(ids({ status: "done" })).toEqual(["Pancakes"]);
    expect(ids({})).toEqual(["Groceries", "Report", "Tea"]);
  });

  test("pin, archive and restore are stored beside the items, announced, and survive a restart", () => {
    const { blocks, saved } = setup();
    blocks.register("main", KEY, reply);
    expect(saved.act(`${KEY}.0`, "pin")).toMatchObject({ pinned: true, status: "active" });
    expect(notified).toEqual([{ method: SAVED_CHANGED, params: { principalId: "p1", kind: "checklist", id: `${KEY}.0` } }]);
    expect(saved.act(`${KEY}.0`, "archive")).toMatchObject({ pinned: false, archived: true, status: "done" });
    const restarted = setup().saved;
    expect(restarted.get(`${KEY}.0`)).toMatchObject({ archived: true, status: "done" });
    expect(restarted.act(`${KEY}.0`, "restore")).toMatchObject({ archived: false, status: "active" });
    expect(JSON.parse(readFileSync(join(dir, "saved-meta.json"), "utf8")).version).toBe(1);
    // Reply blocks and unknown ids are not saved items.
    expect(() => saved.act(`${KEY}.2`, "pin")).toThrow(expect.objectContaining({ code: -32040 }));
    expect(() => saved.act("00000000-0000-4000-8000-000000000009", "pin")).toThrow(expect.objectContaining({ code: -32040 }));
  });

  test("opening is recorded quietly unless it changes the status", () => {
    const { saved, artifacts } = setup();
    const realNow = now;
    const doc = artifacts.save({ title: "Old", content: "x" }, "main");
    now = new Date(Date.now() + 31 * 24 * H);
    expect(saved.get(doc.id)?.status).toBe("done");
    expect(saved.act(doc.id, "opened").status).toBe("active");
    expect(notified).toHaveLength(1);
    saved.act(doc.id, "opened");
    expect(notified).toHaveLength(1);
    now = realNow;
  });

  test("a delivered reply's first artifact link becomes the document's source message", () => {
    const { saved, artifacts } = setup();
    const doc = artifacts.save({ title: "Report", content: "x" }, "main");
    saved.recordReply(KEY, "No links here.");
    expect(saved.get(doc.id)?.sourceMessageId).toBeNull();
    saved.recordReply(KEY, `Saved it: [Report](/artifacts/${doc.id}) and again [r](/artifacts/${doc.id}).`);
    expect(saved.get(doc.id)?.sourceMessageId).toBe(KEY);
    expect(notified).toEqual([{ method: SAVED_CHANGED, params: { principalId: "p1", kind: "document", id: doc.id } }]);
    // A later reply linking it again doesn't move the source.
    saved.recordReply(OTHER, `Updated [Report](/artifacts/${doc.id}).`);
    expect(saved.get(doc.id)?.sourceMessageId).toBe(KEY);
    // A link to a document that doesn't exist records nothing.
    saved.recordReply(REPLY, "[gone](/artifacts/00000000-0000-4000-8000-000000000009)");
    expect(notified).toHaveLength(1);
  });

  test("new saved blocks in a reply are announced; reply blocks are not", () => {
    const { blocks, saved } = setup();
    saved.recordReply(KEY, reply, blocks.register("main", KEY, reply));
    expect(notified.map((n) => (n.params as { id: string }).id)).toEqual([`${KEY}.0`, `${KEY}.1`]);
  });

  test("document files keep their format, and old files still read", () => {
    const { saved, artifacts } = setup();
    const doc = artifacts.save({ title: "Report", content: "x" }, "main");
    saved.act(doc.id, "pin");
    saved.recordReply(KEY, `[Report](/artifacts/${doc.id})`);
    const raw = JSON.parse(readFileSync(join(dir, "artifacts", `${doc.id}.json`), "utf8"));
    expect(Object.keys(raw).sort()).toEqual(["content", "conversationId", "createdAt", "id", "title", "updatedAt", "version"]);
    expect(artifactDocument.parse(raw)).toEqual(doc);
    expect(new ArtifactStore(dir).get(doc.id)).toEqual(doc);
  });

  test("the RPC checks the principal and the request", async () => {
    const { blocks, saved } = setup();
    blocks.register("main", KEY, reply);
    const handle = saved.handlers("p1")[SAVED_MANAGE];
    expect(await handle({ principalId: "p1", request: { action: "list", status: "all", kind: "checklist" } })).toMatchObject({ items: [{ id: `${KEY}.0` }] });
    expect(await handle({ principalId: "p1", request: { action: "pin", id: `${KEY}.1` } })).toMatchObject({ items: [{ pinned: true }] });
    expect(await handle({ principalId: "p1", request: { action: "get", id: `${KEY}.1` } })).toMatchObject({ items: [{ kind: "timer" }] });
    await expect(handle({ principalId: "p2", request: { action: "list" } })).rejects.toThrow("principal mismatch");
    await expect(handle({ principalId: "p1", request: { action: "pin", id: "../../etc" } })).rejects.toThrow();
    await expect(handle({ principalId: "p1", request: { action: "explode", id: `${KEY}.1` } })).rejects.toThrow();
    await expect(handle({ principalId: "p1", request: { action: "get", id: `${KEY}.9` } })).rejects.toThrow(expect.objectContaining({ code: -32040 }));
  });

  test("refuses a symlinked or corrupt metadata file", () => {
    const { saved } = setup();
    writeFileSync(join(dir, "elsewhere.json"), JSON.stringify({ version: 1, items: {} }));
    symlinkSync(join(dir, "elsewhere.json"), join(dir, "saved-meta.json"));
    expect(() => saved.list()).toThrow();
    rmSync(join(dir, "saved-meta.json"));
    writeFileSync(join(dir, "saved-meta.json"), "{nope");
    expect(() => saved.list()).toThrow();
  });

  test("the agent lists items across conversations and pins one", async () => {
    const { blocks, saved } = setup();
    blocks.register("trip", KEY, reply);
    const tools = new Map<string, { execute: (...args: unknown[]) => Promise<{ content: { text: string }[] }> }>();
    const pi = { registerTool: (t: { name: string }) => tools.set(t.name, t as never), on: () => {} } as unknown as ExtensionAPI;
    saved.extension("main")(pi);
    expect([...tools.keys()]).toEqual(["list_saved_items", "update_saved_item"]);
    const listed = JSON.parse((await tools.get("list_saved_items")!.execute("t", { query: "groceries" })).content[0]!.text);
    expect(listed.items).toMatchObject([{ id: `${KEY}.0`, kind: "checklist", conversationId: "trip", pinned: false }]);
    const here = JSON.parse((await tools.get("list_saved_items")!.execute("t", { scope: "conversation" })).content[0]!.text);
    expect(here.items).toEqual([]);
    const pinned = JSON.parse((await tools.get("update_saved_item")!.execute("t", { id: `${KEY}.0`, action: "pin" })).content[0]!.text);
    expect(pinned).toMatchObject({ id: `${KEY}.0`, pinned: true, status: "active" });
    await expect(tools.get("update_saved_item")!.execute("t", { id: `${KEY}.7`, action: "pin" })).rejects.toThrow("list_saved_items");
  });
});
