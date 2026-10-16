import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "./artifacts.ts";
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function setup() { const dir = mkdtempSync(join(tmpdir(), "artifacts-")); dirs.push(dir); return { dir, store: new ArtifactStore(dir) }; }
test("documents survive restart, search content and retain stable links and source on update", () => {
  const { dir, store } = setup();
  const first = store.save({ title: "Report", content: "The budget is 42." }, "topic-one");
  const restarted = new ArtifactStore(dir);
  expect(restarted.get(first.id)).toEqual(first);
  expect(restarted.list("BUDGET").artifacts.map(a => a.id)).toEqual([first.id]);
  expect(restarted.list("missing").artifacts).toEqual([]);
  const updated = restarted.save({ id: first.id, title: "Revised report", content: "New budget" }, "main");
  expect(updated).toMatchObject({ id: first.id, version: 2, createdAt: first.createdAt, conversationId: "topic-one" });
  expect(restarted.list().artifacts).toHaveLength(1);
  expect(restarted.list().artifacts[0]).not.toHaveProperty("content");
});
test("artifact reads enforce principal and IDs; updates cannot silently recreate missing documents", async () => {
  const { store } = setup();
  expect(() => store.get("../../secrets")).toThrow();
  expect(() => store.save({ id: crypto.randomUUID(), title: "Missing", content: "x" }, "main")).toThrow("not found");
  await expect(store.handlers("owner")["artifacts/read"]({ principalId: "other" })).rejects.toThrow("wrong principal");
});
test("artifact storage refuses symlinked directories and files", () => {
  const { dir, store } = setup();
  const other = setup();
  symlinkSync(other.dir, join(dir, "artifacts"));
  expect(() => store.list()).toThrow("symlink");
  rmSync(join(dir, "artifacts"));
  const doc = store.save({ title: "Report", content: "x" }, "main");
  const file = join(dir, "artifacts", `${doc.id}.json`);
  rmSync(file);
  symlinkSync(join(other.dir, "secret"), file);
  expect(() => store.get(doc.id)).toThrow();
});
