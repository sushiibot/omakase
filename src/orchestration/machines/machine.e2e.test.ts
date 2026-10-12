import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MachineHub } from "./hub.ts";
import { OrchestrationServer } from "../transport/server.ts";
import { MachineControl } from "./control.ts";
import { AgentEvents } from "./events.ts";
import { CodingAgents, CodingAgentStore } from "./agents.ts";
import { MachineRoutes } from "../../surfaces/web/machineRoutes.ts";
import { FAKE_PROVIDER } from "../../workspace/machine/fakeProvider.ts";
import type { JsonState } from "../../db/jsonState.ts";
import type { PushEvent } from "../../surfaces/web/pushRules.ts";
import type { AgentResultParams } from "./contracts.ts";

class MemoryState implements JsonState {
  map = new Map<string, string>();
  get<T>(key: string) {
    const v = this.map.get(key);
    return v === undefined ? undefined : (JSON.parse(v) as T);
  }
  set(key: string, value: unknown) {
    this.map.set(key, JSON.stringify(value));
  }
  list<T>(prefix: string) {
    return [...this.map].filter(([k]) => k.startsWith(prefix)).map(([, v]) => JSON.parse(v) as T);
  }
}

async function eventually<T>(get: () => Promise<T> | T, predicate: (v: T) => boolean) {
  for (let i = 0; i < 200; i++) {
    const v = await get();
    if (predicate(v)) return v;
    await Bun.sleep(50);
  }
  throw new Error("Machine did not reach the expected state.");
}

test("a machine daemon reports agents' changes: results wake their conversation once, approvals push the owner", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sushii-machine-e2e-"));
  const root = join(dir, "project");
  await mkdir(root);
  await writeFile(join(root, "README.md"), "Hello from the file server");
  const fake = join(dir, "fake.ts");
  await writeFile(fake, FAKE_PROVIDER);
  const token = "a".repeat(40);
  const hub = new MachineHub([{ id: "pc", name: "Desktop", token }]);
  const server = new OrchestrationServer({ secretGrants: { workspace: { principalId: "owner" } } });
  server.setMachineHub(hub);
  server.listen();
  const state = new MemoryState();
  const control = new MachineControl(hub, new CodingAgentStore(state));
  const agents = new CodingAgents(control);
  const routes = new MachineRoutes(control, agents);
  const wakes: Omit<AgentResultParams, "principalId">[] = [];
  const pushes: PushEvent[] = [];
  const events = new AgentEvents({
    control,
    link: { isConnected: () => true, agentResult: async (q) => (wakes.push(q), "delivered") },
    state,
    push: async (e) => void pushes.push(e),
    lastOwnerMessageAt: () => undefined,
  });
  control.observer = events;
  hub.setSessionListener(events.onSession);
  const cfg = join(dir, "machine.json");
  await writeFile(
    cfg,
    JSON.stringify({
      id: "pc",
      name: "Desktop",
      url: server.url,
      token,
      stateDir: join(dir, "state"),
      roots: [{ id: "code", name: "Code", path: root, coding: true }],
      providers: { codex: [process.execPath, fake], claude: [process.execPath, fake] },
    }),
  );
  const spawnDaemon = () => Bun.spawn([process.execPath, "src/workspace/machine/index.ts", cfg], { stdout: "ignore", stderr: "ignore" });
  let daemon = spawnDaemon();
  try {
    await eventually(() => hub.list(), (list) => list[0]!.connected);
    await eventually(() => hub.supportsEvents("pc"), (v) => v);
    expect(await fetch(server.url.replace("ws:", "http:") + "/machines").then((r) => r.status)).toBe(401);
    expect(((await control.files({ action: "read", machineId: "pc", rootId: "code", path: "README.md" })) as { text: string }).text).toBe(
      "Hello from the file server",
    );

    // Finished: one wake into the conversation that started it, from the live event alone.
    const started = (await agents.action({ action: "start", machineId: "pc", rootId: "code", provider: "codex", prompt: "hello" }, "topic-1")) as {
      agent: { id: string };
    };
    const id = started.agent.id;
    await eventually(() => wakes.length, (n) => n === 1);
    expect(wakes[0]).toMatchObject({ conversationId: "topic-1", agentId: id, status: "completed", final: "Final: hello", machineName: "Desktop" });
    expect(control.agents.get(id)).toMatchObject({ remoteStatus: "completed", conversationId: "topic-1" });
    // A duplicate notification and a read of the agent act on nothing new.
    const summary = { sessionId: id, taskId: "", stateVersion: control.agents.get(id)!.stateVersion!, status: "completed" as const };
    events.onSession("pc", summary);
    await agents.action({ action: "get", id });
    await Bun.sleep(200);
    expect(wakes).toHaveLength(1);

    // Needs-you: the owner is pushed, the agent is not woken; answering resolves the push and the result wakes.
    const approval = ((await agents.action({ action: "start", machineId: "pc", rootId: "code", provider: "codex", prompt: "approval" }, "main")) as {
      agent: { id: string };
    }).agent.id;
    await eventually(() => pushes.length, (n) => n === 1);
    expect(pushes[0]).toMatchObject({ kind: "agentNeedsYou", agentId: approval, label: "Codex agent on Desktop" });
    expect(wakes).toHaveLength(1);
    const view = (await (await routes.handle(new Request(`http://local/api/agents/${approval}`), `/api/agents/${approval}`))!.json()) as {
      session: { requests: { id: string; decisions: string[] }[] };
    };
    expect(view.session.requests[0]!.decisions).toContain("acceptForSession");
    const answered = await routes.handle(
      new Request(`http://local/api/agents/${approval}/answer`, {
        method: "POST",
        body: JSON.stringify({ requestId: view.session.requests[0]!.id, decision: "accept" }),
      }),
      `/api/agents/${approval}/answer`,
    );
    expect(answered!.status).toBe(200);
    await eventually(() => wakes.length, (n) => n === 2);
    expect(wakes[1]).toMatchObject({ agentId: approval, status: "completed", conversationId: "main" });
    expect(pushes.some((p) => p.kind === "agentResolved")).toBe(true);
    expect(((await (await routes.handle(new Request("http://local/api/agents?conversationId=main"), "/api/agents"))!.json()) as { agents: unknown[] }).agents).toHaveLength(1);

    // Missed events: the daemon restarts mid-turn, so the gateway hears nothing until the reconnect snapshot.
    const waiting = ((await agents.action({ action: "start", machineId: "pc", rootId: "code", provider: "claude", prompt: "wait" }, "main")) as {
      agent: { id: string };
    }).agent.id;
    await eventually(async () => (await control.sessionById("pc", waiting)).threadId, (t) => t === "claude-one");
    daemon.kill();
    await daemon.exited;
    daemon = spawnDaemon();
    await eventually(() => wakes.length, (n) => n === 3);
    expect(wakes[2]).toMatchObject({ agentId: waiting, status: "interrupted" });
    // The reconnect snapshot also listed the earlier agents, which were already acted on.
    await Bun.sleep(300);
    expect(wakes).toHaveLength(3);

    // A message resumes the interrupted agent, and its result wakes again.
    await agents.action({ action: "message", id: waiting, text: "carry on" }, "main");
    await eventually(() => wakes.length, (n) => n === 4);
    expect(wakes[3]).toMatchObject({ agentId: waiting, status: "completed", final: "Done: carry on" });
  } finally {
    daemon.kill();
    await daemon.exited;
    server.stop();
    await rm(dir, { recursive: true, force: true });
  }
}, 30000);
