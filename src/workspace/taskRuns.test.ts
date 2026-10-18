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
  const runs = recordTaskRuns(records, { setRunActivity: () => {}, list: unexpected, attachRun: unexpected, settleRun: unexpected });
  expect(() => runs.startRun({ agentName: "main", task: "work", sessionFile: "file" })).toThrow(failure);
  expect(() => runs.endRun("run", { status: "done" })).toThrow(failure);
});
