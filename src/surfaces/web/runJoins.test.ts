import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { applySchema } from "../../db/index.ts";
import { SqliteChatLog } from "./chatLog.ts";
import type { RunSummary } from "./events.ts";
import { runLinks, withRunLinks } from "./runJoins.ts";

const CLIENT_A = "01JGK3WEM0E2E000000000000A";
const CLIENT_B = "01JGK3WEM0E2E000000000000B";
const TURN_1 = "01JGK3WEM0E2E0000000000T01";
const TURN_2 = "01JGK3WEM0E2E0000000000T02";

const run = (over: Partial<RunSummary> = {}): RunSummary => ({
  runId: "01JGK3WEM0E2E0000000000R01",
  kind: "chat",
  agentName: "main",
  title: "hello",
  status: "done",
  startedAt: "2026-10-01T10:00:00.000Z",
  ...over,
});

function setup(conversationId = "main") {
  const db = new Database(":memory:");
  applySchema(db);
  const log = new SqliteChatLog(db, { conversationId });
  const user = (key: string, text = "hi") => log.append("user", { key, text, uploadIds: [], at: "2026-10-01T10:00:00.000Z" }, key);
  /** A turn as the adapter records it: anchored at the head, replies sorted there, then its final. */
  const turn = (turnId: string, replies: string[], final = true) => {
    log.anchorTurn(turnId);
    const anchor = log.turnAnchor(turnId)!;
    for (const key of replies) log.appendResult("reply", { key, turnId, text: "done", files: [] }, key, anchor);
    if (final) log.append("turn_final", { turnId, outcome: "done", summary: null }, `${turnId}:done`);
  };
  return { db, log, user, turn };
}

describe("run links", () => {
  test("a chat run's result is its turn's last reply, and its trigger the owner message that started it", () => {
    const { db, user, turn } = setup();
    user(CLIENT_A);
    turn(TURN_1, ["outbox-first", "outbox-last"]);
    expect(runLinks(db, run({ turnId: TURN_1, conversationId: "main" }))).toEqual({
      result: { conversationId: "main", message: "outbox-last" },
      trigger: { type: "message", conversationId: "main", message: CLIENT_A },
    });
  });

  test("a run with no reply has no result; a run without a turn has neither", () => {
    const { db, user, turn } = setup();
    user(CLIENT_A);
    turn(TURN_1, []);
    expect(runLinks(db, run({ turnId: TURN_1 }))).toEqual({ trigger: { type: "message", conversationId: "main", message: CLIENT_A } });
    expect(runLinks(db, run())).toEqual({});
    expect(runLinks(db, run({ kind: "agent", agentName: "coder" }))).toEqual({});
  });

  test("a turn the agent started on its own has no trigger; a message queued during the previous turn does", () => {
    const { db, user, turn } = setup();
    user(CLIENT_A);
    turn(TURN_1, ["outbox-1"]);
    turn(TURN_2, ["outbox-2"]);
    expect(runLinks(db, run({ turnId: TURN_2 })).trigger).toBeUndefined();

    const queued = setup();
    queued.user(CLIENT_A);
    queued.log.anchorTurn(TURN_1);
    queued.user(CLIENT_B);
    queued.log.append("turn_final", { turnId: TURN_1, outcome: "done", summary: null }, `${TURN_1}:done`);
    queued.turn(TURN_2, ["outbox-2"]);
    expect(runLinks(queued.db, run({ turnId: TURN_1 })).trigger).toEqual({ type: "message", conversationId: "main", message: CLIENT_A });
    expect(runLinks(queued.db, run({ turnId: TURN_2 })).trigger).toEqual({ type: "message", conversationId: "main", message: CLIENT_B });
  });

  test("a turn's start survives the anchors table's retention through its reply's sort position", () => {
    const { db, user, turn } = setup();
    user(CLIENT_A);
    turn(TURN_1, ["outbox-1"]);
    db.run("DELETE FROM web_turn_anchors");
    expect(runLinks(db, run({ turnId: TURN_1 })).trigger).toEqual({ type: "message", conversationId: "main", message: CLIENT_A });
  });

  test("an imported owner message links by s<seq>; a topic run links into its topic", () => {
    const { db, user, turn } = setup("trip");
    const seq = user("pi:1");
    turn(TURN_1, ["outbox-topic"]);
    expect(runLinks(db, run({ turnId: TURN_1, conversationId: "trip", agentName: "topic:trip" }))).toEqual({
      result: { conversationId: "trip", message: "outbox-topic" },
      trigger: { type: "message", conversationId: "trip", message: `s${seq}` },
    });
  });

  test("a scheduled run is triggered by its schedule, a delegated one by its parent run", () => {
    const { db } = setup();
    expect(runLinks(db, run({ kind: "job", agentName: "job:nightly", jobName: "nightly" }))).toEqual({ trigger: { type: "schedule", jobName: "nightly" } });
    expect(runLinks(db, run({ kind: "subagent", agentName: "scout", parentRunId: "01JGK3WEM0E2E0000000000R00" }))).toEqual({
      trigger: { type: "parent", runId: "01JGK3WEM0E2E0000000000R00" },
    });
  });

  test("a failed join leaves the run as the workspace sent it", () => {
    const { db } = setup();
    db.run("DROP TABLE web_turn_anchors");
    db.run("DROP TABLE web_events");
    const r = run({ turnId: TURN_1 });
    expect(withRunLinks(db, [r])).toEqual([r]);
  });
});
