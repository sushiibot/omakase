import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SharedFiles } from "./files.ts";
import { capTranscript, MachineSessions, wireRecord } from "./sessions.ts";
import { FAKE_PROVIDER } from "./fakeProvider.ts";
import { transcriptItem, type SessionRecord, type SessionSummary, type TranscriptItem } from "../../orchestration/machines/contracts.ts";

const dirs: string[] = [];
const live: MachineSessions[] = [];
afterEach(async () => {
  await Promise.all(live.splice(0).map((s) => s.stop()));
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup(opts: { stallMs?: number; dir?: string; keepFinished?: number; persistDelayMs?: number } = {}) {
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
    {
      persistDelayMs: opts.persistDelayMs ?? 20,
      stopGraceMs: 2000,
      ...(opts.stallMs ? { stallMs: opts.stallMs } : {}),
      ...(opts.keepFinished !== undefined ? { keepFinished: opts.keepFinished } : {}),
    },
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
  await first.sessions.stop();
  const second = setup({ dir: first.dir });
  const after = (await second.sessions.request({ action: "get", sessionId: "s1" })) as SessionRecord;
  expect(after.status).toBe("interrupted");
  expect(after.stateVersion).toBe(running.stateVersion! + 1);
  expect(second.sessions.summaries()).toEqual([{ sessionId: "s1", taskId: "", stateVersion: after.stateVersion!, status: "interrupted" }]);
  const legacy = wireRecord(after, false);
  expect(Object.keys(legacy)).not.toContain("stateVersion");
  expect(Object.keys(legacy)).not.toContain("turn");
});

test("shutdown drains final provider output and persists it before returning", async () => {
  const { dir, root, sessions } = setup({ persistDelayMs: 60_000 });
  writeFileSync(join(dir, "fake.ts"), FAKE_PROVIDER.replace(
    "process.on('SIGTERM', () => process.exit(0));",
    `process.on('SIGTERM', () => {
      // Deliberately omit the newline: readline must drain its final partial line.
      process.stdout.write(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Final shutdown output' }] } }), () => process.exit(0));
    });`,
  ));
  await start(sessions, "c1", "claude", "wait");
  await until(get(sessions, "c1"), (r) => r.threadId === "claude-one");

  await sessions.stop();

  expect(existsSync(join(root, "claude-live"))).toBe(false);
  const saved = JSON.parse(readFileSync(join(dir, "state", "sessions.json"), "utf8"))[0] as SessionRecord;
  expect(saved.output).toContain("Final shutdown output");
  expect(saved.transcript).toContainEqual(expect.objectContaining({ kind: "message", text: "Final shutdown output" }));
  // Shutdown leaves working sessions available for restart recovery.
  expect(saved.status).toBe("running");
  await sessions.stop();
});

test("an approval shows the approved thing whole and first; a model-written reason cannot hide it", async () => {
  const { sessions } = setup();
  await start(sessions, "s1", "codex", "longreason");
  const long = (await until(get(sessions, "s1"), (r) => r.status === "needs-you")).requests[0]!;
  expect(long.description.startsWith("Run: rm -rf build")).toBe(true);
  expect(long.detail).toMatchObject({ kind: "command", command: "rm -rf build", cwd: "/p" });
  expect(long.detail!.reason!.length).toBeLessThanOrEqual(300);
  expect(long.decisions).toContain("accept");

  await start(sessions, "s2", "codex", "nocommand");
  const blind = (await until(get(sessions, "s2"), (r) => r.status === "needs-you")).requests[0]!;
  // Nothing to inspect, so nothing to approve.
  expect(blind.decisions).toEqual(["decline"]);
  expect(blind.description).toContain("Agent's explanation: Trust me");

  await start(sessions, "s3", "codex", "network");
  const net = (await until(get(sessions, "s3"), (r) => r.status === "needs-you")).requests[0]!;
  expect(net.detail).toMatchObject({ kind: "command", host: "example.com", protocol: "https" });
  expect(net.description.startsWith("Network access: example.com (https)")).toBe(true);
  expect(net.decisions).toContain("accept");

  await start(sessions, "s4", "codex", "stdin");
  const stdin = (await until(get(sessions, "s4"), (r) => r.status === "needs-you")).requests[0]!;
  expect(stdin.detail).toMatchObject({ kind: "writeStdin", command: "y" });
  expect(stdin.description.startsWith("Write to a running terminal: y")).toBe(true);
});

test("a file change approval lists every file, with a move's destination; anything it cannot show declines", async () => {
  const { sessions } = setup();
  await start(sessions, "s1", "codex", "filechange");
  const change = (await until(get(sessions, "s1"), (r) => r.status === "needs-you")).requests[0]!;
  expect(change.detail).toMatchObject({
    kind: "fileChange",
    files: [
      { path: "src/a.ts", change: "update" },
      { path: "src/old.ts", change: "update", movePath: "src/new.ts" },
      { path: "src/n.ts", change: "add" },
    ],
    diff: "-a\n+b\n\n+n",
  });
  expect(change.description).toContain("update src/old.ts → src/new.ts");
  expect(change.decisions).toContain("accept");

  await start(sessions, "s2", "codex", "filechange odd");
  const odd = (await until(get(sessions, "s2"), (r) => r.status === "needs-you")).requests[0]!;
  // An unknown change shape is not shown as approvable, even with a write root named.
  expect(odd.decisions).toEqual(["decline"]);
  expect(odd.detail?.files).toBeUndefined();

  await start(sessions, "s3", "codex", "grantonly");
  const grant = (await until(get(sessions, "s3"), (r) => r.status === "needs-you")).requests[0]!;
  expect(grant.decisions).toEqual(["decline"]);
  expect(grant.description).toContain("Write access to: /etc");
});

test("a slow approval is not a stall, and cancelling an approval reads as the owner's stop", async () => {
  const { sessions } = setup({ stallMs: 150 });
  await start(sessions, "s1", "codex", "approval");
  const asked = await until(get(sessions, "s1"), (r) => r.status === "needs-you");
  await Bun.sleep(400);
  await sessions.request({ action: "answer", sessionId: "s1", requestId: asked.requests[0]!.id, decision: "accept" });
  const done = await until(get(sessions, "s1"), (r) => r.status === "completed");
  expect(done.stalled).toBeUndefined();

  await start(sessions, "s2", "codex", "wait approval");
  const pending = await until(get(sessions, "s2"), (r) => r.status === "needs-you");
  await sessions.request({ action: "answer", sessionId: "s2", requestId: pending.requests[0]!.id, decision: "cancel" });
  expect((await until(get(sessions, "s2"), (r) => r.status !== "running" && r.status !== "needs-you")).status).toBe("stopped");
  // The cancelled turn released the session: it takes a message again.
  await sessions.request({ action: "message", sessionId: "s2", requestId: "m1", text: "go on", origin: "owner" });
  expect((await until(get(sessions, "s2"), (r) => r.attempts === 2 && r.status === "completed")).final).toBe("Final: go on");
});

test("a steer that loses the race with the turn's end resumes the transcript instead", async () => {
  const { sessions } = setup();
  await start(sessions, "s1", "codex", "wait");
  await until(get(sessions, "s1"), (r) => r.turn?.id === "turn-1");
  await sessions.request({ action: "message", sessionId: "s1", requestId: "m1", text: "too late", origin: "agent" });
  const resumed = await until(get(sessions, "s1"), (r) => r.status === "completed" && r.attempts === 2);
  expect(resumed.final).toBe("Final: too late");
});

test("a Claude follow-up waits for the previous process to exit, so two never share a transcript", async () => {
  const { root, sessions } = setup();
  await start(sessions, "c1", "claude", "linger");
  await until(get(sessions, "c1"), (r) => r.status === "completed");
  await sessions.request({ action: "message", sessionId: "c1", requestId: "m1", text: "again", origin: "owner" });
  await until(get(sessions, "c1"), (r) => r.status === "completed" && r.attempts === 2);
  expect(existsSync(join(root, "overlap.txt"))).toBe(false);
});

test("finished sessions beyond the newest few are pruned; live ones never are", async () => {
  const { sessions } = setup({ keepFinished: 1 });
  await start(sessions, "s1", "codex", "one");
  await until(get(sessions, "s1"), (r) => r.status === "completed");
  await start(sessions, "s2", "codex", "wait");
  await Bun.sleep(20);
  await start(sessions, "s3", "codex", "three");
  await until(get(sessions, "s3"), (r) => r.status === "completed");
  await start(sessions, "s4", "codex", "four");
  expect(sessions.summaries().map((s) => s.sessionId).sort()).toEqual(["s2", "s3", "s4"]);
});

test("waiting for one agent's provider to exit never holds up another agent", async () => {
  const { sessions } = setup();
  await start(sessions, "c1", "claude", "linger");
  await until(get(sessions, "c1"), (r) => r.status === "completed");
  const followUp = sessions.request({ action: "message", sessionId: "c1", requestId: "m1", text: "again", origin: "owner" });
  const began = Date.now();
  await start(sessions, "s1", "codex", "quick");
  expect(Date.now() - began).toBeLessThan(1500);
  await followUp;
});

test("a session works in its folder below the root, and every follow-up stays there", async () => {
  const { root, sessions } = setup();
  const repo = join(root, "repo");
  mkdirSync(join(repo, "web"), { recursive: true });
  const cwd = realpathSync(join(repo, "web"));
  const log = () =>
    readFileSync(join(cwd, "cwd.log"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
  const begin = (id: string, provider: "codex" | "claude", text: string, path?: string) =>
    sessions.request({ action: "start", sessionId: id, taskId: "", rootId: "code", provider, text, ...(path ? { path } : {}) });

  const codex = (await begin("s1", "codex", "hello", "./repo/web")) as SessionRecord;
  expect(codex.path).toBe("repo/web");
  await until(get(sessions, "s1"), (r) => r.status === "completed");
  await sessions.request({ action: "message", sessionId: "s1", requestId: "m1", text: "more", origin: "owner" });
  await until(get(sessions, "s1"), (r) => r.status === "completed" && r.attempts === 2);
  expect(log()).toEqual([
    { proc: cwd, method: "thread/start", cwd },
    { proc: cwd, method: "turn/start", cwd, roots: [cwd] },
    { proc: cwd, method: "thread/resume", cwd },
    { proc: cwd, method: "turn/start", cwd, roots: [cwd] },
  ]);
  expect(existsSync(join(root, "cwd.log"))).toBe(false);
  // A repeated start is idempotent only for the same folder.
  expect(((await begin("s1", "codex", "hello", "repo/web")) as SessionRecord).attempts).toBe(2);
  await expect(begin("s1", "codex", "hello", "repo")).rejects.toThrow("another assignment");

  rmSync(join(cwd, "cwd.log"));
  await begin("c1", "claude", "hello", "repo/web");
  await until(get(sessions, "c1"), (r) => r.status === "completed");
  await sessions.request({ action: "prompt", sessionId: "c1", requestId: "p1", text: "again" });
  await until(get(sessions, "c1"), (r) => r.status === "completed" && r.attempts === 2);
  expect(log()).toEqual([
    { proc: cwd, method: "start" },
    { proc: cwd, method: "resume" },
  ]);

  // A refused folder leaves no session behind.
  writeFileSync(join(repo, "notes.txt"), "x");
  for (const [path, message] of [
    ["../outside", "'..'"],
    ["/tmp", "relative"],
    ["repo/notes.txt", "not a folder"],
    ["missing", "does not exist"],
  ] as const)
    await expect(begin(`x-${message.length}`, "codex", "hello", path)).rejects.toThrow(message);
  expect(sessions.summaries().map((s) => s.sessionId).sort()).toEqual(["c1", "s1"]);
});

test("a gateway that did not ask about session paths never sees one", () => {
  const record = { id: "s1", taskId: "", rootId: "code", path: "repo", provider: "codex", status: "completed", output: "", updatedAt: "", attempts: 1, requests: [], promptIds: [] } satisfies SessionRecord;
  expect(Object.keys(wireRecord(record, true))).not.toContain("path");
  expect(wireRecord(record, true, true).path).toBe("repo");
});

const kinds = (r: SessionRecord) => (r.transcript ?? []).map((i) => i.kind);

test("Codex: the transcript holds prompts by origin, messages, finished commands, file changes and tools", async () => {
  const { sessions } = setup();
  await sessions.request({ action: "start", sessionId: "s1", taskId: "", rootId: "code", provider: "codex", text: "commands", origin: "agent" });
  const done = await until(get(sessions, "s1"), (r) => r.status === "completed");
  expect(kinds(done)).toEqual(["prompt", "command", "fileChange", "tool", "message", "turnEnd"]);
  const [prompt, command, files, tool, message, end] = done.transcript!;
  expect(prompt).toMatchObject({ kind: "prompt", origin: "agent", text: "commands" });
  // The finished command updates the item its start created, with only the end of its output.
  expect(command).toMatchObject({ kind: "command", id: "c1", command: "bun test", exitCode: 1 });
  expect(command!.kind === "command" && command.outputTail!.length).toBe(2000);
  expect(command!.kind === "command" && command.outputTail!.endsWith("1 fail")).toBe(true);
  expect(files).toMatchObject({ files: [{ path: "src/a.ts", change: "update" }, { path: "src/n.ts", change: "add" }] });
  expect(tool).toMatchObject({ kind: "tool", name: "docs · search", detail: '{"q":"redirect"}' });
  expect(message).toMatchObject({ kind: "message", text: "Fixed it.", final: true });
  expect(end).toMatchObject({ kind: "turnEnd", status: "completed" });

  await sessions.request({ action: "message", sessionId: "s1", text: "and the docs", requestId: "p-1", origin: "owner" });
  const again = await until(get(sessions, "s1"), (r) => r.status === "completed" && r.attempts === 2);
  expect(again.transcript!.filter((i) => i.kind === "prompt").map((i) => i.kind === "prompt" && i.origin)).toEqual(["agent", "owner"]);
});

test("the answer is marked final: Codex's final_answer over later commentary, otherwise the turn's last message", async () => {
  const { sessions } = setup();
  await start(sessions, "s1", "codex", "hello");
  const done = await until(get(sessions, "s1"), (r) => r.status === "completed");
  const messages = done.transcript!.filter((i) => i.kind === "message");
  expect(messages.map((m) => m.kind === "message" && [m.text, !!m.final])).toEqual([
    ["Thinking", false],
    ["Final: hello", true],
    ["Afterthought", false],
  ]);
  await start(sessions, "c1", "claude", "tools");
  const claude = await until(get(sessions, "c1"), (r) => r.status === "completed");
  const answers = claude.transcript!.filter((i) => i.kind === "message");
  expect(answers[0]).not.toHaveProperty("final");
  expect(answers[1]).toMatchObject({ text: "Fixed the login test.", final: true });
});

test("Codex: an approval is recorded pending, then with the owner's decision; one left open is withdrawn", async () => {
  const { sessions } = setup();
  await start(sessions, "s1", "codex", "approval");
  const asked = await until(get(sessions, "s1"), (r) => r.status === "needs-you");
  expect(asked.transcript!.at(-1)).toMatchObject({ kind: "approval", requestId: asked.requests[0]!.id, status: "pending", title: "Run: bun test" });
  // A gateway that did not negotiate a start origin leaves the prompt unattributed.
  expect(asked.transcript![0]).not.toHaveProperty("origin");
  await sessions.request({ action: "answer", sessionId: "s1", requestId: asked.requests[0]!.id, decision: "acceptForSession" });
  const done = await until(get(sessions, "s1"), (r) => r.status === "completed");
  expect(done.transcript!.find((i) => i.kind === "approval")).toMatchObject({ status: "accepted" });

  await start(sessions, "s2", "codex", "approval");
  await until(get(sessions, "s2"), (r) => r.status === "needs-you");
  const stopped = (await sessions.request({ action: "stop", sessionId: "s2" })) as SessionRecord;
  expect(stopped.transcript!.find((i) => i.kind === "approval")).toMatchObject({ status: "withdrawn" });
  expect(stopped.transcript!.at(-1)).toMatchObject({ kind: "turnEnd", status: "stopped" });
});

test("Claude: text, Bash, edits and other tools become transcript items, with each result on its call", async () => {
  const { sessions } = setup();
  await start(sessions, "c1", "claude", "tools");
  const done = await until(get(sessions, "c1"), (r) => r.status === "completed");
  expect(kinds(done)).toEqual(["prompt", "message", "command", "fileChange", "tool", "message", "turnEnd"]);
  const t = done.transcript!;
  expect(t[2]).toMatchObject({ kind: "command", command: "bun test", outputTail: "3 pass\n1 fail", failed: true });
  expect(t[3]).toMatchObject({ kind: "fileChange", files: [{ path: "src/a.ts", change: "update" }] });
  expect(t[4]).toMatchObject({ kind: "tool", name: "Grep", detail: "login", outputTail: "src/login.ts" });

  // A result that no message carried still shows, as the turn's answer.
  await start(sessions, "c2", "claude", "deny");
  const partly = await until(get(sessions, "c2"), (r) => r.status === "completed");
  expect(partly.transcript!.filter((i) => i.kind === "message").at(-1)).toMatchObject({ text: "Partly done", final: true });
});

test("the transcript stays within its item and size caps, dropping the oldest items", async () => {
  const { sessions } = setup();
  await start(sessions, "s1", "codex", "hello");
  await until(get(sessions, "s1"), (r) => r.status === "completed");
  for (let i = 0; i < 40; i++) {
    await sessions.request({ action: "message", sessionId: "s1", text: `${i} ${"y".repeat(5000)}`, requestId: `p-${i}`, origin: "owner" });
    await until(get(sessions, "s1"), (r) => r.status === "completed" && r.attempts === i + 2);
  }
  const record = (await get(sessions, "s1")()) as SessionRecord;
  expect(record.transcript!.length).toBeLessThanOrEqual(300);
  expect(JSON.stringify(record.transcript).length).toBeLessThanOrEqual(64000);
  const prompts = record.transcript!.filter((i) => i.kind === "prompt");
  expect(prompts.at(-1)!.kind === "prompt" && prompts.at(-1)!.text.startsWith("39 ")).toBe(true);
  expect(prompts.every((p) => p.kind === "prompt" && p.text.length <= 4000)).toBe(true);
  expect(prompts.some((p) => p.kind === "prompt" && p.text.startsWith("0 "))).toBe(false);
});

test("only a gateway that negotiated transcripts gets one, and never without session events", () => {
  const record = { id: "s1", taskId: "", rootId: "code", provider: "codex", status: "completed", output: "", updatedAt: "", attempts: 1, requests: [], promptIds: [], transcript: [{ kind: "message", text: "hi", at: "" }] } satisfies SessionRecord;
  expect(Object.keys(wireRecord(record, true, true))).not.toContain("transcript");
  expect(Object.keys(wireRecord(record, false, true, true))).not.toContain("transcript");
  expect(wireRecord(record, true, false, true).transcript).toEqual(record.transcript);
});

test("the transcript cap holds after in-place changes, and one item cannot outgrow it", () => {
  const big = (i: number): TranscriptItem => ({ kind: "command", id: `c${i}`, command: "x".repeat(1900), outputTail: "y".repeat(1900), at: "" });
  const items = Array.from({ length: 40 }, (_, i) => big(i));
  const capped = capTranscript(items, 300, 64000);
  expect(JSON.stringify(capped).length).toBeLessThanOrEqual(64000);
  expect(capped.at(-1)).toMatchObject({ id: "c39" });
  expect(capTranscript(items, 5, 64000)).toHaveLength(5);
  // A file change at its caps still fits the transcript on its own.
  const files: TranscriptItem = {
    kind: "fileChange",
    files: Array.from({ length: 50 }, () => ({ path: "p".repeat(500), change: "update" as const, movePath: "m".repeat(500) })),
    at: "",
  };
  expect(JSON.stringify(files).length).toBeLessThan(64000);
  expect(transcriptItem.safeParse({ ...files, files: [{ path: "p".repeat(501), change: "update" }] }).success).toBe(false);
});

test("finished sessions beyond the newest few keep only the end of their transcript on disk", async () => {
  const { dir, sessions } = setup();
  for (let i = 0; i < 22; i++) {
    await start(sessions, `s${i}`, "codex", "commands");
    await until(get(sessions, `s${i}`), (r) => r.status === "completed");
    await Bun.sleep(5);
  }
  await start(sessions, "last", "codex", "hello");
  await until(get(sessions, "last"), (r) => r.status === "completed");
  await Bun.sleep(80);
  const saved = JSON.parse(readFileSync(join(dir, "state", "sessions.json"), "utf8")) as SessionRecord[];
  const byId = new Map(saved.map((r) => [r.id, r]));
  // 23 finished: the newest 20 are whole, the oldest keep their end.
  expect(byId.get("last")!.transcript![0]).toMatchObject({ kind: "prompt" });
  expect(byId.get("s21")!.transcript![0]).toMatchObject({ kind: "prompt" });
  expect(JSON.stringify(byId.get("s0")!.transcript).length).toBeLessThanOrEqual(8000);
  expect(byId.get("s0")!.transcript!.at(-1)).toMatchObject({ kind: "turnEnd" });
}, 60000);

test("a Claude result that repeats the turn's text marks it final instead of adding it again", async () => {
  const { sessions } = setup();
  await start(sessions, "c1", "claude", "hello");
  const done = await until(get(sessions, "c1"), (r) => r.status === "completed");
  // The fake's reply and its result differ, so both show; when they match only one does.
  const messages = done.transcript!.filter((i) => i.kind === "message");
  expect(messages.filter((m) => m.kind === "message" && m.final)).toHaveLength(1);
  await start(sessions, "c2", "claude", "same");
  const same = await until(get(sessions, "c2"), (r) => r.status === "completed");
  expect(same.transcript!.filter((i) => i.kind === "message")).toEqual([
    expect.objectContaining({ text: "Same answer", final: true }),
  ]);
});

test("an unrecognised Codex change shape shows as unknown, not as an update", async () => {
  const { sessions } = setup();
  await start(sessions, "s1", "codex", "oddcommit");
  const done = await until(get(sessions, "s1"), (r) => r.status === "completed");
  expect(done.transcript!.find((i) => i.kind === "fileChange")).toMatchObject({ files: [{ path: "src/a.ts", change: "unknown" }] });
});
