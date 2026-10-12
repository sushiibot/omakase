import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { OwnerRequests } from "./ownerRequests.ts";
import { ChatAsks, confirmToolCall, createHeadlessUIContext, parseSelect, type AskRequest } from "./uiContext.ts";

function channels() {
  const registry = new OwnerRequests();
  const delivered: AskRequest[] = [];
  let n = 0;
  const make = (conversationId: string, extra = {}) => new ChatAsks({ ownerRequests: registry, origin: () => ({ surface: "web", conversationId }), newId: () => `ask${++n}`, deliver: ask => delivered.push(ask), ...extra });
  return { registry, delivered, a: make("main"), b: make("travel"), make };
}
const decision = { itemKey: "task:t-one", decisionKey: "date", question: "Which day?", choices: ["Monday", "Tuesday"] };

describe("shared owner requests", () => {
  test("concurrent channels reuse an exact unresolved decision and preserve its original routing", async () => {
    const { registry, delivered, a, b } = channels();
    const first = a.requestDecision(decision);
    const duplicate = await b.requestDecision({ ...decision, question: "Another phrasing" });
    expect(duplicate).toMatchObject({ status: "already_pending", request: { requestId: "ask1", conversationId: "main", origin: { surface: "web", conversationId: "main" } } });
    expect(delivered).toHaveLength(1);
    expect(b.size).toBe(0);
    a.answer("wsask:ask1", "Monday");
    expect(await first).toMatchObject({ status: "answered", answer: "Monday" });
    expect(registry.list()).toEqual([]);
    expect(registry.list(true)[0]?.status).toBe("answered");
    const next = b.requestDecision(decision);
    expect(delivered).toHaveLength(2);
    b.cancelAll("test");
    await next;
  });

  test("changed choices conflict; distinct explicit decisions remain separate", async () => {
    const { delivered, a, b } = channels();
    const first = a.requestDecision(decision);
    expect(await b.requestDecision({ ...decision, choices: ["Wednesday", "Thursday"] })).toMatchObject({ status: "conflict", request: { choices: ["Monday", "Tuesday"] } });
    const second = b.requestDecision({ ...decision, decisionKey: "venue" });
    expect(delivered).toHaveLength(2);
    a.cancelAll("test"); b.cancelAll("test");
    await Promise.all([first, second]);
  });

  test("tool approvals are visible with exact actions and never deduplicated", async () => {
    const { registry, delivered, a, b } = channels();
    const action = { tool: "bash", input: "deploy production", toolCallId: "call-a" };
    const one = confirmToolCall(createHeadlessUIContext(a), action);
    const two = confirmToolCall(createHeadlessUIContext(b), { ...action, toolCallId: "call-b" });
    expect(delivered).toHaveLength(2);
    expect(registry.list().map(r => r.kind)).toEqual(["approval", "approval"]);
    expect(registry.list()[0]?.toolConfirmation).toEqual(action);
    a.answer("wsask:ask1", "Yes");
    expect(await one).toBe(true);
    expect(registry.list()).toHaveLength(1);
    b.cancelAll("test"); expect(await two).toBe(false);
  });

  test("timeout, abort, delivery failure and withdrawal remove live attention", async () => {
    const { registry, make } = channels();
    const timeout = make("timeout", { timeoutMs: 5 });
    const timed = timeout.requestDecision(decision);
    await new Promise(resolve => setTimeout(resolve, 15));
    expect(await timed).toMatchObject({ status: "closed_without_answer" });
    expect(registry.list(true)[0]?.status).toBe("expired");
    const abort = make("abort"); const controller = new AbortController();
    const aborted = abort.requestDecision(decision, controller.signal); controller.abort(); await aborted;
    expect(registry.list(true)[1]?.status).toBe("withdrawn");
    const failed = make("failed", { deliver: () => { throw new Error("down"); } });
    await failed.requestDecision(decision);
    expect(registry.list(true)[2]?.status).toBe("delivery_failed");
    const stopped = make("stopped"); const waiting = stopped.requestDecision(decision); stopped.hold("shutdown"); await waiting;
    expect(registry.list(true)[3]?.status).toBe("withdrawn");
    expect(registry.list()).toEqual([]);
  });

  test("generic asks are observed without fuzzy text dedupe; snapshots cannot mutate state", async () => {
    const { registry, a, b } = channels();
    const one = a.ask("Same?", ["A", "B"], parseSelect(["A", "B"]), undefined);
    const two = b.ask("Same?", ["A", "B"], parseSelect(["A", "B"]), undefined);
    expect(registry.list()).toHaveLength(2);
    registry.list()[0]!.choices.push("C");
    expect(registry.list()[0]!.choices).toEqual(["A", "B"]);
    a.cancelAll("test"); b.cancelAll("test"); await Promise.all([one, two]);
  });

  test("awareness refreshes per run and list tool exposes complete canonical pending records", async () => {
    const { registry, a } = channels();
    const hooks = new Map<string, (event: any) => any>();
    registry.awareness()({ on: (name: string, cb: any) => hooks.set(name, cb) } as unknown as ExtensionAPI);
    const ask = a.requestDecision(decision);
    hooks.get("before_agent_start")!({});
    const injected = hooks.get("context_with_system")!({ messages: [{ role: "system", sections: {} }] });
    expect(injected.messages[0].sections.ownerRequests).toContain('"requestId":"ask1"');
    const tool = registry.tools()[0]!;
    const listed = await tool.execute("list", {}, undefined, undefined, {} as any);
    expect(listed.content[0]).toMatchObject({ type: "text", text: expect.stringContaining('"itemKey":"task:t-one"') });
    a.cancelAll("test"); await ask;
    hooks.get("before_agent_start")!({});
    expect(hooks.get("context_with_system")!({ messages: [{ role: "system", sections: {} }] }).messages[0].sections.ownerRequests).toContain("Shared live owner requests (0");
  });

  test("invalid or repeated choice labels do not create a request", async () => {
    const { registry, a } = channels();
    await expect(a.requestDecision({ ...decision, choices: ["Yes", " yes "] })).rejects.toThrow("distinct");
    expect(registry.list()).toEqual([]);
  });
});
