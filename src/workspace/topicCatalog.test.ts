import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readTopicCatalog, topicConversationExists, writeTopicCatalog } from "./topicCatalog.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const setup = () => { const dir = mkdtempSync(join(tmpdir(), "topic-catalog-")); dirs.push(dir); return dir; };

test("queries work before sessions exist and observe catalog changes, including archived topics", () => {
  const dir = setup();
  expect(topicConversationExists(dir, "main")).toBe(true);
  expect(topicConversationExists(dir, "topic-a")).toBe(false);
  const records = { "topic-a": { id: "topic-a", title: "A", brief: "context", archived: true } };
  writeTopicCatalog(dir, records);
  expect(readTopicCatalog(dir)).toEqual(records);
  expect(topicConversationExists(dir, "topic-a")).toBe(true);
  expect(topicConversationExists(dir, "unknown")).toBe(false);
  writeTopicCatalog(dir, {});
  expect(topicConversationExists(dir, "topic-a")).toBe(false);
});

test("presence queries preserve their lightweight semantics while session loading validates records", () => {
  const dir = setup();
  writeFileSync(join(dir, "topics.json"), JSON.stringify({ "topic-a": { id: "topic-a", title: "", brief: "", archived: true } }));
  expect(() => readTopicCatalog(dir)).toThrow("invalid persisted topic catalog");
  expect(topicConversationExists(dir, "topic-a")).toBe(true);
  expect(topicConversationExists(dir, "unknown")).toBe(false);
  expect(topicConversationExists(dir, "main")).toBe(true);
});
