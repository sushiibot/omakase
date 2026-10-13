import { expect, test } from "bun:test";
import { MachineControl } from "./control.ts";
import { CodingAgentStore } from "./agents.ts";
import type { MachineHub } from "./hub.ts";
import { MemoryJsonState } from "../../db/jsonState.ts";

test("an agent starts only on a daemon that reports its status, so its result can reach the conversation", async () => {
  const store = new CodingAgentStore(new MemoryJsonState());
  const requests: unknown[] = [];
  let events = false;
  const hub = {
    list: () => [{ id: "pc", name: "Desktop", connected: true, providers: ["codex"], roots: [{ id: "code", name: "Code", coding: true }] }],
    supportsEvents: () => events,
    request: async (_m: string, _method: string, p: { sessionId: string }) => {
      requests.push(p);
      return { id: p.sessionId, taskId: "", rootId: "code", provider: "codex", status: "running", output: "", updatedAt: new Date().toISOString(), attempts: 1, requests: [], promptIds: [], stateVersion: 1 };
    },
  } as unknown as MachineHub;
  const control = new MachineControl(hub, store);
  const input = { machineId: "pc", rootId: "code", provider: "codex" as const, prompt: "Fix it", title: "Fix it", conversationId: "main" };
  await expect(control.startAgent(input, "agent")).rejects.toThrow("Update and restart the machine daemon");
  expect(requests).toEqual([]);
  expect(store.list()).toEqual([]);
  events = true;
  const agent = await control.startAgent(input, "agent");
  expect(agent).toMatchObject({ machineId: "pc", conversationId: "main", remoteStatus: "running", stateVersion: 1 });
  expect(requests).toEqual([expect.objectContaining({ action: "start", sessionId: agent.id, taskId: "" })]);
});

test("agents that finished over 30 days ago are forgotten with their bookkeeping; live ones stay", () => {
  const state = new MemoryJsonState();
  const store = new CodingAgentStore(state);
  const old = "2026-08-01T00:00:00.000Z";
  const base = { machineId: "pc", rootId: "code", provider: "codex" as const, title: "t", prompt: "p", conversationId: "main", createdAt: old, updatedAt: old };
  store.put({ ...base, id: "a-old", remoteStatus: "completed" });
  store.put({ ...base, id: "a-live", remoteStatus: "running" });
  state.set("agent-acted:a-old", { v: 3, pushed: [] });
  store.prune(Date.parse("2026-10-12T00:00:00Z"));
  expect(store.list().map((a) => a.id)).toEqual(["a-live"]);
  expect(state.get("agent-acted:a-old")).toBeUndefined();
  expect(new CodingAgentStore(state).list().map((a) => a.id)).toEqual(["a-live"]);
});

test("a paused conversation refuses its agent's start and message, never the owner's", async () => {
  const store = new CodingAgentStore(new MemoryJsonState());
  const requests: unknown[] = [];
  const hub = {
    list: () => [{ id: "pc", name: "Desktop", connected: true, providers: ["codex"], roots: [{ id: "code", name: "Code", coding: true }] }],
    supportsEvents: () => true,
    request: async (_m: string, _method: string, p: { sessionId: string }) => {
      requests.push(p);
      return { id: p.sessionId, taskId: "", rootId: "code", provider: "codex", status: "running", output: "", updatedAt: new Date().toISOString(), attempts: 1, requests: [], promptIds: [], stateVersion: 1 };
    },
  } as unknown as MachineHub;
  const control = new MachineControl(hub, store);
  const noted: string[] = [];
  control.observer = {
    observe: () => {},
    noteAction: (c, o) => void noted.push(`${c}:${o}`),
    guard: () => {
      throw new Error("paused");
    },
  };
  const input = { machineId: "pc", rootId: "code", provider: "codex" as const, prompt: "Fix it", title: "Fix it", conversationId: "main" };
  await expect(control.startAgent(input, "agent")).rejects.toThrow("paused");
  expect(requests).toEqual([]);
  const agent = await control.startAgent(input, "owner");
  await expect(control.messageSession("pc", agent.id, "hi", "agent")).rejects.toThrow("paused");
  await control.messageSession("pc", agent.id, "hi", "owner");
  expect(noted).toEqual(["main:owner", "main:owner"]);
});
