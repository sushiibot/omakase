import { expect, test } from "bun:test";
import { MachineControl } from "./control.ts";
import { CodingAgentStore } from "./agents.ts";
import type { MachineHub } from "./hub.ts";

test("an agent starts only on a daemon that reports its status, so its result can reach the conversation", async () => {
  const map = new Map<string, unknown>();
  const store = new CodingAgentStore({
    get: <T>(k: string) => map.get(k) as T | undefined,
    set: (k, v) => void map.set(k, v),
    list: <T>(p: string) => [...map].filter(([k]) => k.startsWith(p)).map(([, v]) => v as T),
  });
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
