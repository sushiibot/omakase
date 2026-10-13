import { expect, test } from "bun:test";
import { MachineControl } from "./control.ts";
import { Check } from "typebox/schema";
import { agentFolder, codingAgentManifest, CodingAgents, CodingAgentStore, type CodingAgentRecord } from "./agents.ts";
import { MachineRefusedError, type MachineHub } from "./hub.ts";
import { MemoryJsonState } from "../../db/jsonState.ts";

test("an agent starts only on a daemon that reports its status, so its result can reach the conversation", async () => {
  const store = new CodingAgentStore(new MemoryJsonState());
  const requests: unknown[] = [];
  let events = false;
  const hub = {
    list: () => [{ id: "pc", name: "Desktop", connected: true, providers: ["codex"], roots: [{ id: "code", name: "Code", coding: true }] }],
    supportsEvents: () => events,
    supportsTranscript: () => events,
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
  // A daemon that keeps a transcript learns who wrote the start prompt.
  expect(requests).toEqual([expect.objectContaining({ action: "start", sessionId: agent.id, taskId: "", origin: "agent" })]);
});

test("the app's view of a session carries its transcript; the agent's view never does", async () => {
  const store = new CodingAgentStore(new MemoryJsonState());
  const transcript = [{ kind: "message", text: "Done", at: "2026-10-12T00:00:00Z" }];
  const hub = {
    list: () => [{ id: "pc", name: "Desktop", connected: true, providers: ["codex"], roots: [{ id: "code", name: "Code", coding: true }] }],
    supportsEvents: () => true,
    supportsTranscript: () => true,
    request: async (_m: string, _method: string, p: { sessionId: string }) => ({ id: p.sessionId, taskId: "", rootId: "code", provider: "codex", status: "completed", output: "x", final: "Done", updatedAt: new Date().toISOString(), attempts: 1, requests: [], promptIds: [], stateVersion: 1, transcript }),
  } as unknown as MachineHub;
  const agents = new CodingAgents(new MachineControl(hub, store));
  const { agent } = (await agents.action({ action: "start", machineId: "pc", rootId: "code", provider: "codex", prompt: "Fix it" })) as { agent: CodingAgentRecord };
  expect(((await agents.action({ action: "get", id: agent.id })) as { session: object }).session).not.toHaveProperty("transcript");
  expect(((await agents.get(agent.id, { transcript: true })) as { session?: object }).session).toMatchObject({ transcript, final: "Done" });
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
    supportsTranscript: () => false,
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

test("an agent in a subfolder needs a daemon that supports it; a refused start leaves no agent behind", async () => {
  const store = new CodingAgentStore(new MemoryJsonState());
  const requests: Record<string, unknown>[] = [];
  let paths = false;
  let refuse: Error | undefined;
  let garbled = false;
  /** undefined echoes the requested path; null answers with the root. */
  let resolved: string | null | undefined;
  const hub = {
    list: () => [{ id: "pc", name: "Desktop", connected: true, providers: ["codex"], roots: [{ id: "code", name: "Code", coding: true }] }],
    supportsEvents: () => true,
    supportsSessionPath: () => paths,
    supportsTranscript: () => false,
    request: async (_m: string, _method: string, p: { sessionId: string; path?: string }) => {
      requests.push(p);
      if (refuse) throw refuse;
      if (garbled) return { id: p.sessionId, status: "launched" };
      const path = resolved === null ? undefined : p.path;
      return { id: p.sessionId, taskId: "", rootId: "code", ...(path ? { path } : {}), provider: "codex", status: "running", output: "", updatedAt: new Date().toISOString(), attempts: 1, requests: [], promptIds: [], stateVersion: 1 };
    },
  } as unknown as MachineHub;
  const agents = new CodingAgents(new MachineControl(hub, store));
  const start = (path?: string) => agents.action({ action: "start", machineId: "pc", rootId: "code", provider: "codex", prompt: "Fix it", ...(path ? { path } : {}) });

  await expect(start("repo/web")).rejects.toThrow("Update and restart the machine daemon");
  expect(requests).toEqual([]);
  expect(store.list()).toEqual([]);
  // The root itself needs nothing new from the daemon, and sends no path.
  await start(".");
  expect(requests[0]).not.toHaveProperty("path");
  expect(store.list()[0]).toMatchObject({ rootName: "Code" });
  expect(store.list()[0]).not.toHaveProperty("path");

  paths = true;
  const { agent } = (await start("./repo/web/")) as { agent: CodingAgentRecord };
  expect(requests[1]).toMatchObject({ action: "start", path: "repo/web" });
  expect(agent).toMatchObject({ path: "repo/web", rootName: "Code" });
  expect(agentFolder(agent)).toBe("Code/repo/web");
  const listed = (await agents.action({ action: "list" })) as { agents: CodingAgentRecord[] };
  expect(listed.agents.map((a) => a.path ?? null).sort()).toEqual([null, "repo/web"]);

  refuse = new MachineRefusedError("Folder missing does not exist in this coding folder.");
  await expect(start("missing")).rejects.toThrow("does not exist");
  expect(store.list()).toHaveLength(2);
  // A timeout may have started work, so that agent is kept.
  refuse = new Error("Machine request timed out; check its session before retrying.");
  await expect(start("slow")).rejects.toThrow("timed out");
  expect(store.list().map((a) => a.path)).toContain("slow");
  // So may a start the daemon accepted whose reply the gateway cannot read.
  refuse = undefined;
  garbled = true;
  await expect(start("garbled")).rejects.toThrow();
  expect(store.list().map((a) => a.path)).toContain("garbled");
  garbled = false;
  // A path that resolves to the root itself (a symlink) shows as the root.
  resolved = null;
  const { agent: atRoot } = (await start("link")) as { agent: CodingAgentRecord };
  expect(atRoot).not.toHaveProperty("path");
  expect(agentFolder(atRoot)).toBe("Code");
  resolved = undefined;

  for (const path of ["../x", "a/../../b", "/etc", "C:\\x"])
    await expect(start(path)).rejects.toThrow();
});

test("the coding_agent schema takes a folder path", () => {
  expect(Check(codingAgentManifest.inputSchema, { action: "start", machineId: "pc", rootId: "code", path: "omakase", provider: "codex", prompt: "x" })).toBe(true);
  expect(codingAgentManifest.description).toContain("path");
});
