import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { BLOCKS_CHANGED, BLOCKS_MANAGE } from "../orchestration/blockContracts.ts";
import { BlockStore } from "./blocks.ts";

const KEY = "01JABCDEFGHJKMNPQRSTVWXYZ0";
const OTHER = "01JABCDEFGHJKMNPQRSTVWXYZ1";
const fence = (type: string, body: string) => "```" + type + "\n" + body + "\n```";
const reply = ["Here you go:", fence("checklist", "title: Groceries\nitems: [milk, eggs]"), fence("bars", "items: [{label: a, value: 1}]"), fence("timer", "label: Tea\nduration: 4m")].join("\n\n");

let dir: string;
let now: Date;
let notified: { method: string; params: unknown }[];
const store = () => new BlockStore(dir, { principalId: "p1", notify: (method, params) => notified.push({ method, params }), now: () => now });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "blocks-"));
  now = new Date("2026-10-20T12:00:00.000Z");
  notified = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("block store", () => {
  test("a reply's live blocks are stored once, in order; a resend keeps their state", () => {
    const s = store();
    expect(s.register("main", KEY, reply).map((b) => [b.id, b.type, b.title])).toEqual([[`${KEY}.0`, "checklist", "Groceries"], [`${KEY}.1`, "timer", "Tea"]]);
    s.apply(`${KEY}.0`, [{ op: "check", item: 0, done: true }], "owner");
    expect(s.register("main", KEY, reply)).toEqual([]);
    expect(s.get(`${KEY}.0`)?.state.items?.[0]?.done).toBe(true);
    expect(s.register("main", OTHER, "no blocks here")).toEqual([]);
    expect(s.listByMessages([OTHER, KEY]).map((b) => b.id)).toEqual([`${KEY}.0`, `${KEY}.1`]);
  });

  test("a change is saved, announced, and survives a new store", () => {
    store().register("main", KEY, reply);
    const block = store().apply(`${KEY}.1`, [{ op: "start" }], "owner");
    expect(block.revision).toBe(2);
    expect(notified).toEqual([{ method: BLOCKS_CHANGED, params: { principalId: "p1", block } }]);
    expect(store().get(`${KEY}.1`)?.state.endsAt).toBe("2026-10-20T12:04:00.000Z");
  });

  test("a refused change answers with a code the gateway maps, and saves nothing", () => {
    const s = store();
    s.register("main", KEY, reply);
    expect(() => s.apply(`${KEY}.0`, [{ op: "remove", item: 7 }], "owner")).toThrow(expect.objectContaining({ code: -32042 }));
    expect(() => s.apply(`${KEY}.5`, [{ op: "start" }], "owner")).toThrow(expect.objectContaining({ code: -32040 }));
    expect(notified).toEqual([]);
  });

  test("the RPC checks the principal and the request", async () => {
    const s = store();
    s.register("main", KEY, reply);
    const handle = s.handlers("p1")[BLOCKS_MANAGE];
    expect(await handle({ principalId: "p1", request: { action: "list", messageKeys: [KEY] } })).toMatchObject({ blocks: [{ id: `${KEY}.0` }, { id: `${KEY}.1` }] });
    expect(await handle({ principalId: "p1", request: { action: "apply", id: `${KEY}.0`, ops: [{ op: "add", text: "rice" }] } })).toMatchObject({ blocks: [{ revision: 2, updatedBy: "owner" }] });
    await expect(handle({ principalId: "p2", request: { action: "list", messageKeys: [KEY] } })).rejects.toThrow("principal mismatch");
    await expect(handle({ principalId: "p1", request: { action: "list", messageKeys: ["../../etc"] } })).rejects.toThrow();
  });

  test("tampered files are refused", () => {
    const s = store();
    s.register("main", KEY, reply);
    writeFileSync(join(dir, "blocks", `${OTHER}.json`), JSON.stringify([{ ...s.get(`${KEY}.0`) }]));
    expect(() => s.listByMessages([OTHER])).toThrow("Block identity mismatch");
    symlinkSync(join(dir, "blocks", `${KEY}.json`), join(dir, "blocks", "01JLINKLINKLINKLINKLINKLIN.json"));
    expect(() => s.listByMessages(["01JLINKLINKLINKLINKLINKLIN"])).toThrow();
  });
});

type Handler = (event: unknown) => unknown;
type Tool = { name: string; execute: (id: string, input: unknown) => Promise<{ content: { text: string }[] }> };

function agent(s: BlockStore, conversationId = "main") {
  const handlers = new Map<string, Handler>();
  const tools = new Map<string, Tool>();
  const pi = { on: (name: string, h: Handler) => handlers.set(name, h), registerTool: (t: Tool) => tools.set(t.name, t) } as unknown as ExtensionAPI;
  void s.extension(conversationId)(pi);
  const call = async (name: string, input: unknown) => JSON.parse((await tools.get(name)!.execute("call", input)).content[0]!.text);
  const section = () => {
    handlers.get("before_agent_start")!({ type: "before_agent_start", prompt: "hi" });
    const out = handlers.get("context_with_system")!({ messages: [{ role: "system", sections: {} }] }) as { messages: [{ sections: { liveBlocks?: string } }] } | undefined;
    return out?.messages[0].sections.liveBlocks;
  };
  return { call, section, tools };
}

describe("agent access", () => {
  test("the agent reads and changes blocks, and the owner sees it", async () => {
    const s = store();
    s.register("main", KEY, reply);
    const a = agent(s);
    expect([...a.tools.keys()]).toEqual(["list_blocks", "read_block", "update_block"]);
    expect(await a.call("list_blocks", {})).toMatchObject([{ id: `${KEY}.0`, state: "0/2 done. Open: 0:“milk”, 1:“eggs”. Done: none" }, { id: `${KEY}.1` }]);
    expect(await a.call("update_block", { id: `${KEY}.0`, ops: [{ op: "add", text: "rice" }, { op: "check", item: 1, done: true }] })).toMatchObject({ revision: 2 });
    expect(notified.at(-1)).toMatchObject({ method: BLOCKS_CHANGED, params: { block: { updatedBy: "agent" } } });
    expect(await a.call("read_block", { id: `${KEY}.0` })).toMatchObject({ summary: "1/3 done. Open: 0:“milk”, 2:“rice”. Done: 1:“eggs”" });
    await expect(a.call("update_block", { id: `${KEY}.0`, ops: [{ op: "sent", text: "hi" }] })).rejects.toThrow("Only the owner answers a reply block.");
    await expect(a.call("update_block", { id: `${KEY}.0`, ops: [{ op: "explode" }] })).rejects.toThrow("ops[0] is not a valid change");
    await expect(a.call("read_block", { id: "nope" })).rejects.toThrow("No live block nope");
  });

  test("the context lists this conversation's blocks and flags the owner's changes once", () => {
    const s = store();
    s.register("main", KEY, reply);
    s.register("topic-1", OTHER, fence("checklist", "items: [other]"));
    const a = agent(s);
    const first = a.section()!;
    expect(first).toContain(`- ${KEY}.0 checklist "Groceries": 0/2 done`);
    expect(first).not.toContain(OTHER);
    expect(first).not.toContain("owner changed it");
    now = new Date("2026-10-20T12:05:00.000Z");
    s.apply(`${KEY}.0`, [{ op: "check", item: 0, done: true }], "owner");
    expect(a.section()).toContain("[owner changed it since you last looked: ticked “milk”]");
    expect(a.section()).not.toContain("owner changed it");
  });

  test("old blocks drop out of the context unless a timer runs", () => {
    const s = store();
    s.register("main", KEY, reply);
    s.apply(`${KEY}.1`, [{ op: "start" }], "owner");
    now = new Date("2026-11-20T12:00:00.000Z");
    const section = agent(s).section()!;
    expect(section).toContain(`${KEY}.1 timer`);
    expect(section).not.toContain(`${KEY}.0`);
  });
});
