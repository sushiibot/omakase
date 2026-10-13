import { z } from "zod";
import type { MachineControl } from "../../orchestration/machines/control.ts";
import { agentFolder, agentSessionView, type CodingAgentRecord, type CodingAgents } from "../../orchestration/machines/agents.ts";
import { answerDecision } from "../../orchestration/machines/contracts.ts";
import { json, readJson } from "./http.ts";

/** Machines and the owner's controls for coding agents ("Agents" in the app). */
export class MachineRoutes {
  constructor(
    private control: MachineControl,
    private agents: CodingAgents,
  ) {}
  /** The record with the names the app shows: its machine and `<root>/<path>` folder. */
  private view(a: CodingAgentRecord) {
    const machine = this.control.list().find((m) => m.id === a.machineId);
    return {
      ...a,
      machineName: machine?.name ?? a.machineId,
      folder: agentFolder(a, machine?.roots.find((r) => r.id === a.rootId)?.name),
    };
  }
  async handle(req: Request, path: string): Promise<Response | null> {
    const machines = path === "/api/machines" || path.startsWith("/api/machines/");
    const agents = path === "/api/agents" || path.startsWith("/api/agents/");
    if (!machines && !agents) return null;
    try {
      if (path === "/api/machines" && req.method === "GET") return json({ machines: this.control.list() });
      if (path === "/api/machines/files" && req.method === "POST") {
        const raw = await readJson(req, 8000);
        if (raw instanceof Response) return raw;
        return json(await this.control.files(raw));
      }
      if (path === "/api/agents" && req.method === "GET") {
        const conversationId = new URL(req.url).searchParams.get("conversationId") ?? undefined;
        return json({ agents: this.agents.list(conversationId).map((a) => this.view(a)) });
      }
      const match = /^\/api\/agents\/([a-z0-9][a-z0-9-]{0,63})(?:\/(answer|message|stop))?$/.exec(path);
      if (!match) return json({ error: "Not found." }, 404);
      const agent = this.agents.require(match[1]!);
      if (!match[2] && req.method === "GET") {
        const detail = await this.agents.get(agent.id, { transcript: true });
        return json({ ...detail, agent: this.view(detail.agent) });
      }
      if (!match[2] || req.method !== "POST") return json({ error: "Method not allowed." }, 405);
      const raw = await readJson(req, 20000);
      if (raw instanceof Response) return raw;
      let session;
      if (match[2] === "answer") {
        const p = z.object({ requestId: z.union([z.string().max(200), z.number()]), decision: answerDecision }).strict().parse(raw);
        session = await this.control.answer(agent.machineId, agent.id, p.requestId, p.decision);
      } else if (match[2] === "message") {
        const p = z.object({ text: z.string().trim().min(1).max(16000) }).strict().parse(raw);
        session = await this.control.messageSession(agent.machineId, agent.id, p.text, "owner");
      } else {
        z.object({}).strict().parse(raw ?? {});
        this.control.observer?.noteAction(agent.conversationId, "owner");
        session = await this.control.stopSession(agent.machineId, agent.id);
      }
      return json({ agent: this.view(this.agents.require(agent.id)), session: agentSessionView(session, { transcript: true }) });
    } catch (err) {
      return json(
        { error: err instanceof Error ? err.message : "Machine request failed." },
        err instanceof z.ZodError ? 400 : err instanceof Error && err.message === "Agent not found." ? 404 : 409,
      );
    }
  }
}
