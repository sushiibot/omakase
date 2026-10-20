import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AttentionPrefs, attentionHandlers } from "./attention.ts";
import { RPC_METHODS } from "../orchestration/contracts.ts";

const AT = new Date("2026-10-19T09:00:00Z");
const ci = { key: "omakase:ci:main", title: "Omakase CI broken", topic: "CI failures" };
let dir: string;
let prefs: AttentionPrefs;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "attention-"));
  prefs = new AttentionPrefs(dir);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const rate = (item: { key: string; title: string; topic?: string }, rating: "up" | "down" | null, scope?: "item" | "topic") =>
  prefs.apply({ action: "rate", job: "heartbeat", item, rating, ...(scope ? { scope } : {}) }, AT);

describe("AttentionPrefs", () => {
  test("a 👎 mutes the item's topic for every key and job; clearing it lifts the mute", () => {
    expect(rate(ci, "down").mutes).toEqual([{ id: "topic:ci failures", scope: "topic", label: "CI failures", job: "heartbeat", at: AT.toISOString() }]);
    expect(prefs.allows({ key: "lucid:ci:pr-4", topic: "CI Failures" })).toBe(false);
    expect(prefs.allows({ key: "dentist", topic: "Appointments" })).toBe(true);
    expect(rate(ci, null).mutes).toEqual([]);
    expect(prefs.allows({ key: "lucid:ci:pr-4", topic: "CI failures" })).toBe(true);
  });

  test("an item-scoped 👎, or one on an item without a topic, mutes only that key", () => {
    rate(ci, "down", "item");
    expect(prefs.allows({ key: ci.key, topic: "Other" })).toBe(false);
    expect(prefs.allows({ key: "lucid:ci:main", topic: "CI failures" })).toBe(true);
    // Switching scope replaces the first mute.
    expect(rate(ci, "down", "topic").mutes.map((m) => m.id)).toEqual(["topic:ci failures"]);
    expect(rate({ key: "x", title: "X" }, "down", "topic").mutes.map((m) => m.id)).toEqual(["topic:ci failures", "item:x"]);
  });

  test("a topic two items muted stays until both are cleared, or it is lifted from Settings", () => {
    rate(ci, "down");
    rate({ ...ci, key: "lucid:ci:main" }, "down");
    expect(rate(ci, null).mutes).toHaveLength(1);
    expect(prefs.apply({ action: "unmute", id: "topic:ci failures" }, AT).mutes).toEqual([]);
  });

  test("the prompt names mutes, 👍s and the topics to reuse", () => {
    expect(prefs.promptSection()).toBe("");
    rate(ci, "down");
    rate({ key: "pkg:ups", title: "UPS package arriving", topic: "Package deliveries" }, "up");
    const prompt = prefs.promptSection();
    expect(prompt).toContain('Muted topics. Never flag anything of these kinds, from any source: "CI failures"');
    expect(prompt).toContain('Useful (👍), lean toward things like these: "UPS package arriving [Package deliveries]"');
    expect(prompt).toContain('use that exact topic label: "CI failures", "Package deliveries"');
  });

  test("the handler checks the principal", async () => {
    const handle = attentionHandlers(prefs, "owner", () => AT)[RPC_METHODS.attentionManage]!;
    await expect(handle({ principalId: "someone", request: { action: "list" } })).rejects.toThrow("principal mismatch");
    expect(await handle({ principalId: "owner", request: { action: "list" } })).toEqual({ mutes: [] });
  });
});
