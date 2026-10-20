import { expect, test } from "bun:test";
import { recordTaskRuns } from "./taskRuns.ts";
import type { RunRecord, RunRecorder } from "./runLog.ts";
import type { TaskStore } from "./taskStore.ts";

test("task recorder associates roots only, records before task changes, and forwards queries", () => {
  const events: unknown[] = [];
  let active!: (id: string) => boolean;
  const record = { runId: "run", status: "running" } as RunRecord;
  const records: RunRecorder = {
    startRun: input => { events.push(["start", input]); return "run"; },
    endRun: (id, end) => { events.push(["end", id, end]); record.status = end.status; },
    getRun: id => id === "run" ? record : null,
    listRuns: query => { events.push(["query", query]); return [record]; },
  };
  const tasks: Parameters<typeof recordTaskRuns>[1] = {
    setRunActivity: fn => { active = fn; },
    list: () => [{ id: "task", workConversationId: "topic-a" }] as ReturnType<TaskStore["list"]>,
    attachRun: (id, run, actor) => { events.push(["attach", id, run, actor]); },
    settleRun: (id, status, summary) => { events.push(["settle", id, status, summary]); },
    detachRuns: () => {},
  };
  const runs = recordTaskRuns(records, tasks);
  const input = { agentName: "main", task: "work", sessionFile: "session", conversationId: "topic-a" };
  expect(runs.startRun(input)).toBe("run");
  expect(events).toEqual([["start", input], ["attach", "task", "run", "Sushii"]]);
  events.length = 0;
  runs.startRun({ ...input, parentRunId: "parent" });
  runs.startRun({ ...input, conversationId: "unknown" });
  expect(events).toHaveLength(2);
  expect(active("run")).toBe(true);
  expect(active("missing")).toBe(false);
  const end = { status: "failed" as const, resultSummary: "failure detail" };
  events.length = 0;
  runs.endRun("run", end);
  expect(events).toEqual([["end", "run", end], ["settle", "run", "failed", "failure detail"]]);
  expect(active("run")).toBe(false);
  expect(runs.getRun("run")).toBe(record);
  const query = { limit: 3 };
  expect(runs.listRuns(query)).toEqual([record]);
  expect(events.at(-1)).toEqual(["query", query]);
});

test("a failed run write cannot attach or settle a task", () => {
  const failure = new Error("storage unavailable");
  const records: RunRecorder = {
    startRun: () => { throw failure; }, endRun: () => { throw failure; },
    getRun: () => null, listRuns: () => [],
  };
  const unexpected = () => { throw new Error("task should not change"); };
  const runs = recordTaskRuns(records, { setRunActivity: () => {}, list: unexpected, attachRun: unexpected, settleRun: unexpected, detachRuns: () => {} });
  expect(() => runs.startRun({ agentName: "main", task: "work", sessionFile: "file" })).toThrow(failure);
  expect(() => runs.endRun("run", { status: "done" })).toThrow(failure);
});

test("a scheduled job run (no conversation) never attaches to a task without a conversation", () => {
  const attached: string[] = [];
  const records: RunRecorder = { startRun: () => "job-run", endRun: () => {}, getRun: () => null, listRuns: () => [] };
  const runs = recordTaskRuns(records, {
    setRunActivity: () => {},
    list: () => [{ id: "old-task" }] as ReturnType<TaskStore["list"]>,
    attachRun: id => { attached.push(id); },
    settleRun: () => {},
    detachRuns: () => {},
  });
  runs.startRun({ agentName: "job:consolidation", task: "consolidate", sessionFile: "" });
  expect(attached).toEqual([]);
});

test("startup detaches only root runs without a conversation", () => {
  const byId: Record<string, RunRecord> = {
    job: { runId: "job", agentName: "job:consolidation", status: "done" } as RunRecord,
    chat: { runId: "chat", agentName: "main", status: "done", conversationId: "topic" } as RunRecord,
    sub: { runId: "sub", agentName: "researcher", status: "done", parentRunId: "chat" } as RunRecord,
  };
  let stray!: (id: string) => boolean;
  recordTaskRuns({ startRun: () => "", endRun: () => {}, getRun: id => byId[id] ?? null, listRuns: () => [] }, {
    setRunActivity: () => {}, list: () => [], attachRun: () => {}, settleRun: () => {},
    detachRuns: s => { stray = s; },
  });
  expect(["job", "chat", "sub", "rotated-away"].filter(id => stray(id))).toEqual(["job"]);
});
