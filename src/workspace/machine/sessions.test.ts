import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SharedFiles } from "./files.ts";
import { MachineSessions, wireRecord } from "./sessions.ts";
import { FAKE_PROVIDER } from "./fakeProvider.ts";
import type { SessionRecord, SessionSummary } from "../../orchestration/machines/contracts.ts";

const dirs: string[] = [];
const live: MachineSessions[] = [];
afterEach(async () => {
  for (const s of live.splice(0)) s.stop();
  // Killed providers report their exit after this; let it land before the state dir goes.
  await Bun.sleep(400);
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup(opts: { stallMs?: number; dir?: string } = {}) {
  const dir = opts.dir ?? mkdtempSync(join(tmpdir(), "machine-sessions-"));
  if (!opts.dir) dirs.push(dir);
  const root = join(dir, "project");
  mkdirSync(root, { recursive: true });
  const fake = join(dir, "fake.ts");
  writeFileSync(fake, FAKE_PROVIDER);
  const files = new SharedFiles([{ id: "code", name: "Code", path: root, coding: true }]);
  const sessions = new MachineSessions(
    files,
    join(dir, "state"),
    { codex: [process.execPath, fake], claude: [process.execPath, fake] },
    { persistDelayMs: 20, stopGraceMs: 2000, ...(opts.stallMs ? { stallMs: opts.stallMs } : {}) },
  );
  live.push(sessions);
  const changes: SessionSummary[] = [];
  sessions.onChange = (s) => changes.push(s);
  return { dir, root, sessions, changes };
}

async function until(get: () => Promise<SessionRecord>, ok: (r: SessionRecord) => boolean) {
  for (let i = 0; i < 200; i++) {
    const r = await get();
    if (ok(r)) return r;
    await Bun.sleep(25);
  }
  throw new Error("session never reached the expected state");
}

const start = (sessions: MachineSessions, id: string, provider: "codex" | "claude", text: string) =>
  sessions.request({ action: "start", sessionId: id, taskId: "", rootId: "code", provider, text });
const get = (sessions: MachineSessions, id: string) => () =>
  sessions.request({ action: "get", sessionId: id }) as Promise<SessionRecord>;

test("state changes bump the version and notify; streamed output is persisted in batches", async () => {
  const { dir, sessions, changes } = setup();
  await start(sessions, "s1", "codex", "hello");
  const done = await until(get(sessions, "s1"), (r) => r.status === "completed");
  // A final_answer outranks the commentary that followed it.
  expect(done.final).toBe("Final: hello");
  expect(done.turn?.endedAt).toBeDefined();
  expect(changes.map((c) => c.status)).toEqual(["running", "completed"]);
  expect(changes.at(-1)!.stateVersion).toBe(done.stateVersion!);
  await Bun.sleep(60);
  const saved = JSON.parse(readFileSync(join(dir, "state", "sessions.json"), "utf8"));
  expect(saved[0].output).toContain("Reply: hello");
});

test("Codex requests become owner requests, with answers shaped per request", async () => {
  const { sessions } = setup();
  await start(sessions, "s1", "codex", "permission");
  const asked = await until(get(sessions, "s1"), (r) => r.status === "needs-you");
  expect(asked.requests[0]!.decisions).toEqual(["accept", "acceptForSession", "decline"]);
  await expect(
    sessions.request({ action: "answer", sessionId: "s1", requestId: asked.requests[0]!.id, decision: "cancel" }),
  ).rejects.toThrow("does not accept");
  await sessions.request({ action: "answer", sessionId: "s1", requestId: asked.requests[0]!.id, decision: "acceptForSession" });
  const done = await until(get(sessions, "s1"), (r) => r.status === "completed");
  expect(done.output).toContain('"scope":"session"');
  expect(done.output).toContain('"network":{"enabled":true}');

  await start(sessions, "s2", "codex", "question");
  const question = await until(get(sessions, "s2"), (r) => r.status === "needs-you");
  expect(question.requests[0]!.description).toContain("Which DB?");
  expect(question.requests[0]!.decisions).toEqual(["decline"]);
  await sessions.request({ action: "answer", sessionId: "s2", requestId: question.requests[0]!.id, decision: "decline" });
  expect((await until(get(sessions, "s2"), (r) => r.status === "completed")).output).toContain("owner declined");

  await start(sessions, "s3", "codex", "approval");
  const approval = await until(get(sessions, "s3"), (r) => r.status === "needs-you");
  expect(approval.requests[0]!.decisions).toEqual(["accept", "acceptForSession", "decline", "cancel"]);
  await sessions.request({ action: "answer", sessionId: "s3", requestId: approval.requests[0]!.id, decision: "accept" });
  expect((await until(get(sessions, "s3"), (r) => r.status === "completed")).output).toContain('"decision":"accept"');
});

test("a request resolved by Codex itself clears it; a final error and an outside interruption are distinct", async () => {
  const { sessions } = setup();
  await start(sessions, "s1", "codex", "resolved");
  await until(get(sessions, "s1"), (r) => r.status === "needs-you");
  const resolved = await until(get(sessions, "s1"), (r) => r.status === "completed");
  expect(resolved.requests).toEqual([]);

  await start(sessions, "s2", "codex", "fail");
  const failed = await until(get(sessions, "s2"), (r) => r.status === "failed");
  expect(failed.error).toBe("model overloaded");

  await start(sessions, "s3", "codex", "crash");
  expect((await until(get(sessions, "s3"), (r) => r.status !== "running")).status).toBe("interrupted");
});

test("stopping Codex interrupts its turn first and is recorded as stopped", async () => {
  const { sessions, changes } = setup();
  await start(sessions, "s1", "codex", "wait");
  await until(get(sessions, "s1"), (r) => r.turn?.id === "turn-1");
  const stopped = (await sessions.request({ action: "stop", sessionId: "s1" })) as SessionRecord;
  expect(stopped.status).toBe("stopped");
  expect(changes.filter((c) => c.status === "stopped")).toHaveLength(1);
});

test("a message steers a running Codex turn and resumes an idle one; a pending approval refuses it", async () => {
  const { sessions } = setup();
  await start(sessions, "s1", "codex", "wait");
  await until(get(sessions, "s1"), (r) => r.turn?.id === "turn-1");
  await sessions.request({ action: "message", sessionId: "s1", requestId: "m1", text: "focus on auth", origin: "agent" });
  const steered = await until(get(sessions, "s1"), (r) => r.status === "completed");
  expect(steered.final).toBe("Steered: focus on auth");
  expect(steered.messages).toEqual([expect.objectContaining({ origin: "agent", mode: "steer", text: "focus on auth" })]);
  await sessions.request({ action: "message", sessionId: "s1", requestId: "m2", text: "more", origin: "owner" });
  const resumed = await until(get(sessions, "s1"), (r) => r.status === "completed" && r.attempts === 2);
  expect(resumed.messages!.at(-1)).toMatchObject({ origin: "owner", mode: "resume" });
  // A repeated request id never sends twice.
  await sessions.request({ action: "message", sessionId: "s1", requestId: "m2", text: "more", origin: "owner" });
  expect(((await get(sessions, "s1")()) as SessionRecord).attempts).toBe(2);

  await start(sessions, "s2", "codex", "approval");
  await until(get(sessions, "s2"), (r) => r.status === "needs-you");
  await expect(
    sessions.request({ action: "message", sessionId: "s2", requestId: "m3", text: "hi", origin: "agent" }),
  ).rejects.toThrow("pending approval");
});

test("Claude: denials are recorded, a result ends the turn at once, later results are ignored", async () => {
  const { sessions } = setup();
  await start(sessions, "c1", "claude", "deny linger");
  const done = await until(get(sessions, "c1"), (r) => r.status === "completed");
  expect(done.blocked?.deniedTools.sort()).toEqual(["Bash", "Edit"]);
  expect(done.final).toBe("Partly done");
  expect(done.threadId).toBe("claude-one");
  // The process is still exiting, yet the session takes a follow-up.
  await sessions.request({ action: "prompt", sessionId: "c1", requestId: "p1", text: "again" });
  const again = await until(get(sessions, "c1"), (r) => r.status === "completed" && r.attempts === 2);
  expect(again.output).toContain("Resumed: again");
  expect(again.blocked).toBeUndefined();
});

test("Claude: a message to a running turn interrupts it with SIGINT, then resumes; stop also uses SIGINT", async () => {
  const { root, sessions } = setup();
  await start(sessions, "c1", "claude", "wait");
  await until(get(sessions, "c1"), (r) => r.threadId === "claude-one");
  await sessions.request({ action: "message", sessionId: "c1", requestId: "m1", text: "report now", origin: "agent" });
  expect(existsSync(join(root, "sigint.txt"))).toBe(true);
  const resumed = await until(get(sessions, "c1"), (r) => r.status === "completed");
  expect(resumed.output).toContain("Resumed: report now");
  expect(resumed.messages).toEqual([expect.objectContaining({ mode: "restart" })]);

  rmSync(join(root, "sigint.txt"));
  await start(sessions, "c2", "claude", "wait");
  await until(get(sessions, "c2"), (r) => r.threadId === "claude-one");
  expect(((await sessions.request({ action: "stop", sessionId: "c2" })) as SessionRecord).status).toBe("stopped");
  for (let i = 0; i < 40 && !existsSync(join(root, "sigint.txt")); i++) await Bun.sleep(25);
  expect(existsSync(join(root, "sigint.txt"))).toBe(true);
  await Bun.sleep(100);
  expect(((await get(sessions, "c2")()) as SessionRecord).status).toBe("stopped");
});

test("a silent running session is flagged stalled once, and output ends the episode", async () => {
  const { sessions, changes } = setup({ stallMs: 150 });
  await start(sessions, "s1", "codex", "silent");
  const stalled = await until(get(sessions, "s1"), (r) => r.stalled === true);
  expect(stalled.status).toBe("running");
  expect(stalled.stalledAt).toBeDefined();
  await Bun.sleep(300);
  expect(changes.filter((c) => c.status === "running").length).toBe(2);
  await sessions.request({ action: "message", sessionId: "s1", requestId: "m1", text: "status?", origin: "agent" });
  const after = await until(get(sessions, "s1"), (r) => r.status === "completed");
  expect(after.stalled).toBeUndefined();
});

test("a restart marks working sessions interrupted with a new version; old gateways get records without event fields", async () => {
  const first = setup();
  await start(first.sessions, "s1", "codex", "wait");
  const running = await until(get(first.sessions, "s1"), (r) => r.turn?.id === "turn-1");
  first.sessions.stop();
  const second = setup({ dir: first.dir });
  const after = (await second.sessions.request({ action: "get", sessionId: "s1" })) as SessionRecord;
  expect(after.status).toBe("interrupted");
  expect(after.stateVersion).toBe(running.stateVersion! + 1);
  expect(second.sessions.summaries()).toEqual([{ sessionId: "s1", taskId: "", stateVersion: after.stateVersion!, status: "interrupted" }]);
  const legacy = wireRecord(after, false);
  expect(Object.keys(legacy)).not.toContain("stateVersion");
  expect(Object.keys(legacy)).not.toContain("turn");
});
