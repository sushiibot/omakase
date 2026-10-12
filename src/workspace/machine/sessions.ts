import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  sessionRecord,
  sessionRequest,
  SESSION_EVENT_FIELDS,
  type AnswerDecision,
  type SessionRecord,
  type SessionSummary,
} from "../../orchestration/machines/contracts.ts";
import { SharedFiles } from "./files.ts";
import { JsonProcess } from "./process.ts";
export interface ProviderCommands {
  codex?: string[];
  claude?: string[];
}
interface Active {
  process: JsonProcess;
  turnId?: string;
  stopped: boolean;
  /** Provider request params by request id, for answers whose shape depends on the request. */
  pending: Map<string, { method: string; params: any }>;
  finalPhase?: string;
  turnDone?: () => void;
  lastEventAt: number;
}
const APPROVAL_DECISIONS: AnswerDecision[] = [
  "accept",
  "acceptForSession",
  "decline",
  "cancel",
];
const FINAL_MAX = 4000;
/** Codex server requests that wait on the owner; anything else is refused. */
function codexRequest(
  method: string,
  params: any,
): { description: string; decisions: AnswerDecision[] } | undefined {
  const text = (parts: unknown[], fallback: string) =>
    parts
      .filter((p) => typeof p === "string" && p)
      .join("\n")
      .slice(0, 2000) || fallback;
  if (
    method === "item/commandExecution/requestApproval" ||
    method === "item/fileChange/requestApproval"
  )
    return {
      description: text(
        [
          params?.reason,
          params?.command,
          params?.cwd ? `Working folder: ${params.cwd}` : undefined,
          params?.grantRoot
            ? `Requested write access: ${params.grantRoot}`
            : undefined,
        ],
        "Codex requests permission for this operation.",
      ),
      decisions: APPROVAL_DECISIONS,
    };
  if (method === "item/permissions/requestApproval")
    return {
      description: text(
        [
          params?.reason,
          params?.permissions
            ? `Requested permissions: ${JSON.stringify(params.permissions)}`
            : undefined,
        ],
        "Codex requests additional permissions.",
      ),
      decisions: ["accept", "acceptForSession", "decline"],
    };
  if (method === "item/tool/requestUserInput")
    return {
      // Answers need free text the app cannot collect yet, so declining is the only reply.
      description: text(
        (Array.isArray(params?.questions) ? params.questions : []).map(
          (q: any) =>
            [
              q?.header,
              q?.question,
              Array.isArray(q?.options)
                ? `Options: ${q.options.map((o: any) => o?.label ?? o).join(", ")}`
                : undefined,
            ]
              .filter(Boolean)
              .join("\n"),
        ),
        "Codex asks a question.",
      ),
      decisions: ["decline"],
    };
  if (method === "mcpServer/elicitation/request")
    return {
      description: text(
        [
          params?.serverName ? `${params.serverName} asks:` : undefined,
          params?.message,
          params?.url ? `Link: ${params.url}` : undefined,
        ],
        "An MCP server asks for input.",
      ),
      decisions: ["decline", "cancel"],
    };
  return undefined;
}
/** The JSON-RPC reply a Codex server request expects for this decision. */
function codexAnswer(
  method: string,
  params: any,
  decision: AnswerDecision,
): { result: unknown } | { error: { code: number; message: string } } {
  if (method === "item/permissions/requestApproval") {
    if (decision === "accept" || decision === "acceptForSession") {
      const granted: Record<string, unknown> = {};
      if (params?.permissions?.network)
        granted.network = params.permissions.network;
      if (params?.permissions?.fileSystem)
        granted.fileSystem = params.permissions.fileSystem;
      return {
        result: {
          permissions: granted,
          scope: decision === "acceptForSession" ? "session" : "turn",
        },
      };
    }
    return { result: { permissions: {}, scope: "turn" } };
  }
  if (method === "mcpServer/elicitation/request")
    return { result: { action: decision, content: null, _meta: null } };
  if (method === "item/tool/requestUserInput")
    return {
      error: {
        code: -32000,
        message:
          "The owner declined to answer from the app. Continue without it or report the blocker.",
      },
    };
  return { result: { decision } };
}
export function sessionSummaryOf(record: SessionRecord): SessionSummary {
  return {
    sessionId: record.id,
    taskId: record.taskId,
    stateVersion: record.stateVersion ?? 0,
    status: record.status,
  };
}
/** A record as a gateway parses it: an older gateway rejects the event fields. */
export function wireRecord(record: SessionRecord, events: boolean) {
  const copy = structuredClone(record);
  if (events) return copy;
  for (const key of SESSION_EVENT_FIELDS) delete copy[key];
  for (const r of copy.requests) delete r.decisions;
  return copy;
}
export class MachineSessions {
  private records: SessionRecord[];
  private active = new Map<string, Active>();
  private mutation: Promise<unknown> = Promise.resolve();
  private readonly path: string;
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  /** Called after every state bump with the session's new summary. */
  onChange: (summary: SessionSummary) => void = () => {};
  constructor(
    private files: SharedFiles,
    stateDir: string,
    private commands: ProviderCommands,
    private opts: {
      persistDelayMs?: number;
      stopGraceMs?: number;
      /** No provider output for this long marks a running session stalled. */
      stallMs?: number;
    } = {},
  ) {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    this.path = join(stateDir, "sessions.json");
    this.records = existsSync(this.path)
      ? z
          .array(sessionRecord)
          .max(1000)
          .parse(JSON.parse(readFileSync(this.path, "utf8")))
      : [];
    for (const record of this.records) {
      record.stateVersion ??= 0;
      if (record.status === "running" || record.status === "needs-you") {
        record.status = "interrupted";
        record.requests = [];
        record.error =
          "Daemon restarted; send a follow-up to resume this session.";
        if (record.turn && !record.turn.endedAt)
          record.turn.endedAt = new Date().toISOString();
        record.stalled = undefined;
        record.stalledAt = undefined;
        record.stateVersion++;
        record.updatedAt = new Date().toISOString();
      }
    }
    this.persist();
    const stallMs = opts.stallMs ?? 10 * 60_000;
    this.stallTimer = setInterval(
      () => this.checkStalls(stallMs),
      Math.min(60_000, Math.max(50, stallMs / 4)),
    );
    this.stallTimer.unref?.();
  }
  private stallTimer: ReturnType<typeof setInterval>;
  private checkStalls(stallMs: number) {
    const now = Date.now();
    for (const [id, active] of this.active) {
      const record = this.records.find((r) => r.id === id);
      if (!record || record.status !== "running" || record.stalled) continue;
      if (now - active.lastEventAt < stallMs) continue;
      record.stalled = true;
      record.stalledAt = new Date(now).toISOString();
      this.bump(record);
    }
  }
  /** Any provider output ends a stall episode. */
  private alive(record: SessionRecord, active: Active | undefined) {
    if (active) active.lastEventAt = Date.now();
    if (!record.stalled) return;
    record.stalled = undefined;
    record.stalledAt = undefined;
    this.bump(record);
  }
  private note(
    record: SessionRecord,
    origin: "owner" | "agent",
    mode: "resume" | "steer" | "restart",
    text: string,
  ) {
    record.messages = [
      ...(record.messages ?? []),
      { at: new Date().toISOString(), origin, mode, text: text.slice(0, 500) },
    ].slice(-20);
  }
  private persist() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = undefined;
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.records), { mode: 0o600 });
    renameSync(tmp, this.path);
  }
  private get(id: string) {
    const record = this.records.find((r) => r.id === id);
    if (!record) throw new Error("Remote session not found.");
    return record;
  }
  summaries(): SessionSummary[] {
    return this.records.map(sessionSummaryOf);
  }
  /** A state change the gateway acts on: persisted before anyone hears of it. */
  private bump(record: SessionRecord) {
    record.stateVersion = (record.stateVersion ?? 0) + 1;
    record.updatedAt = new Date().toISOString();
    this.persist();
    try {
      this.onChange(sessionSummaryOf(record));
    } catch {
      /* The gateway reconciles from the next snapshot. */
    }
  }
  /** Output-only changes: every streamed delta would otherwise rewrite the whole file. */
  private dirty(record: SessionRecord) {
    record.updatedAt = new Date().toISOString();
    this.persistTimer ??= setTimeout(
      () => this.persist(),
      this.opts.persistDelayMs ?? 1000,
    );
  }
  private append(record: SessionRecord, text: string) {
    record.output = (record.output + text).slice(-64000);
    this.dirty(record);
  }
  private endTurn(record: SessionRecord) {
    if (record.turn && !record.turn.endedAt)
      record.turn.endedAt = new Date().toISOString();
    record.requests = [];
    record.stalled = undefined;
    record.stalledAt = undefined;
  }
  async request(raw: unknown) {
    const p = sessionRequest.parse(raw);
    if (p.action === "get") return structuredClone(this.get(p.sessionId));
    if (p.action === "stop") {
      const record = this.get(p.sessionId);
      const active = this.active.get(record.id);
      if (active) {
        active.stopped = true;
        if (record.provider === "codex") {
          if (active.turnId) {
            const done = new Promise<void>((resolve) => {
              active.turnDone = resolve;
            });
            await active.process
              .request("turn/interrupt", {
                threadId: record.threadId,
                turnId: active.turnId,
              })
              .catch(() => {});
            // turn/completed records the interruption in Codex's transcript before the process goes.
            await Promise.race([
              done,
              new Promise((r) => setTimeout(r, this.opts.stopGraceMs ?? 3000)),
            ]);
          }
          active.process.kill();
        } else active.process.interrupt(this.opts.stopGraceMs ?? 5000);
        if (this.active.get(record.id) === active)
          this.active.delete(record.id);
      }
      if (record.status !== "stopped" || record.requests.length) {
        record.status = "stopped";
        this.endTurn(record);
        this.bump(record);
      }
      return structuredClone(record);
    }
    if (p.action === "answer") {
      const record = this.get(p.sessionId);
      const active = this.active.get(record.id);
      const request = record.requests.find(
        (r) => String(r.id) === String(p.requestId),
      );
      if (!active || !request)
        throw new Error("This approval is no longer pending.");
      if (!(request.decisions ?? ["accept", "decline"]).includes(p.decision))
        throw new Error("This request does not accept that answer.");
      const pending = active.pending.get(String(request.id));
      active.process.send({
        id: request.id,
        ...codexAnswer(
          pending?.method ?? request.method,
          pending?.params,
          p.decision,
        ),
      });
      active.pending.delete(String(request.id));
      record.requests = record.requests.filter((r) => r !== request);
      record.status = record.requests.length ? "needs-you" : "running";
      this.bump(record);
      return structuredClone(record);
    }
    if (p.action === "message") {
      const record = this.get(p.sessionId);
      if (record.promptIds.includes(p.requestId)) return structuredClone(record);
      if (record.status === "needs-you" || record.requests.length)
        throw new Error(
          "This session is waiting for the owner to answer a pending approval in the task. It cannot take a message until then.",
        );
      const active = this.active.get(record.id);
      if (active && record.provider === "codex") {
        if (!active.turnId)
          throw new Error("This session is still starting. Try again shortly.");
        await active.process.request("turn/steer", {
          threadId: record.threadId,
          input: [{ type: "text", text: p.text, text_elements: [] }],
          expectedTurnId: active.turnId,
        });
        record.promptIds = [...record.promptIds, p.requestId].slice(-100);
        record.output = (record.output + `\nYou: ${p.text}\n\n`).slice(-64000);
        this.note(record, p.origin, "steer", p.text);
        this.alive(record, active);
        this.dirty(record);
        return structuredClone(record);
      }
      if (active) {
        // Claude Code -p takes no input mid-turn: SIGINT ends the turn cleanly, then the transcript resumes.
        active.stopped = true;
        this.active.delete(record.id);
        const closed = new Promise<void>((resolve) => {
          if (active.process.exited) resolve();
          else active.process.child.once("close", () => resolve());
        });
        active.process.interrupt(this.opts.stopGraceMs ?? 5000);
        await closed;
      }
    }
    const run = async () => {
      let record: SessionRecord;
      if (p.action === "start") {
        const existing = this.records.find((r) => r.id === p.sessionId);
        if (existing) {
          if (
            existing.taskId !== p.taskId ||
            existing.rootId !== p.rootId ||
            existing.provider !== p.provider
          )
            throw new Error(
              "Session ID is already used by another assignment.",
            );
          return structuredClone(existing); // Idempotent start: a timeout never creates duplicate work.
        }
        if (this.records.length >= 1000)
          throw new Error("Remote session storage is full.");
        record = {
          id: p.sessionId,
          taskId: p.taskId,
          rootId: p.rootId,
          provider: p.provider,
          status: "running",
          output: "",
          updatedAt: new Date().toISOString(),
          attempts: 1,
          requests: [],
          promptIds: [],
          stateVersion: 0,
        };
      } else {
        record = this.get(p.sessionId);
        if (record.promptIds.includes(p.requestId))
          return structuredClone(record);
        if (p.action === "message" && record.status === "needs-you")
          throw new Error(
            "This session is waiting for the owner to answer a pending approval in the task. It cannot take a message until then.",
          );
        if (this.active.has(record.id))
          throw new Error(
            "This session is working. Stop it or wait before sending a follow-up.",
          );
      }
      const cwd = await this.files.path(record.rootId, ".", true);
      const command = this.commands[record.provider];
      if (!command?.length)
        throw new Error("This provider is not enabled on the machine.");
      if (this.active.size >= 4)
        throw new Error("Four agents are already working on this machine.");
      if (p.action === "start") this.records.push(record);
      else {
        record.attempts++;
        record.promptIds = [...record.promptIds, p.requestId].slice(-100);
      }
      if (p.action === "message")
        this.note(
          record,
          p.origin,
          record.status === "running" ? "restart" : "resume",
          p.text,
        );
      record.status = "running";
      record.error = undefined;
      record.final = undefined;
      record.blocked = undefined;
      record.stalled = undefined;
      record.stalledAt = undefined;
      record.requests = [];
      record.turn = { startedAt: new Date().toISOString() };
      record.output = (record.output + `\nYou: ${p.text}\n\n`).slice(-64000);
      this.bump(record);
      void this.launch(record, command, cwd, p.text).catch((err) => {
        const active = this.active.get(record.id);
        if (record.status === "stopped" || active?.stopped) return;
        record.status = "failed";
        record.error = (
          err instanceof Error ? err.message : "Could not start session."
        ).slice(0, 1000);
        this.endTurn(record);
        this.bump(record);
        active?.process.kill();
        this.active.delete(record.id);
      });
      return structuredClone(record);
    };
    const next = this.mutation.then(run, run);
    this.mutation = next.catch(() => {});
    return next;
  }
  private codexEvent(record: SessionRecord, process: JsonProcess, msg: any) {
    const active = this.active.get(record.id);
    if (active?.process === process) this.alive(record, active);
    if (msg.id !== undefined && msg.method) {
      const request = codexRequest(msg.method, msg.params);
      if (!request || !active || record.requests.length >= 20) {
        process.send({
          id: msg.id,
          error: {
            code: -32601,
            message:
              "This daemon does not support this interactive request. Report the blocker in your reply.",
          },
        });
        return;
      }
      active.pending.set(String(msg.id), {
        method: msg.method,
        params: msg.params,
      });
      record.requests.push({ id: msg.id, method: msg.method, ...request });
      record.status = "needs-you";
      this.bump(record);
      return;
    }
    switch (msg.method) {
      case "item/agentMessage/delta":
        this.append(record, String(msg.params?.delta ?? ""));
        return;
      case "item/started":
        if (msg.params?.item?.type === "commandExecution")
          this.append(
            record,
            `\n$ ${String(msg.params.item.command).slice(0, 2000)}\n`,
          );
        return;
      case "item/completed": {
        const item = msg.params?.item;
        if (item?.type !== "agentMessage" || typeof item.text !== "string")
          return;
        // A final_answer outranks later commentary; without phases the last message is the answer.
        if (
          active?.finalPhase === "final_answer" &&
          item.phase !== "final_answer"
        )
          return;
        if (active) active.finalPhase = item.phase ?? undefined;
        record.final = item.text.slice(-FINAL_MAX);
        this.dirty(record);
        return;
      }
      case "serverRequest/resolved": {
        const id = String(msg.params?.requestId);
        const before = record.requests.length;
        record.requests = record.requests.filter((r) => String(r.id) !== id);
        active?.pending.delete(id);
        if (record.requests.length === before) return;
        if (record.status === "needs-you" && !record.requests.length)
          record.status = "running";
        this.bump(record);
        return;
      }
      case "error":
        if (msg.params?.willRetry !== false) return;
        record.error = String(
          msg.params?.error?.message ?? "Codex reported an error.",
        ).slice(0, 1000);
        this.bump(record);
        return;
      case "turn/started":
        if (active) active.turnId = msg.params?.turn?.id;
        if (record.turn && msg.params?.turn?.id)
          record.turn.id = String(msg.params.turn.id).slice(0, 200);
        this.dirty(record);
        return;
      case "turn/completed": {
        const status = msg.params?.turn?.status;
        const stopped = active?.stopped === true;
        record.status =
          status === "completed"
            ? "completed"
            : status === "interrupted"
              ? stopped
                ? "stopped"
                : "interrupted"
              : "failed";
        if (record.status === "failed" || record.status === "interrupted")
          record.error = String(
            msg.params?.turn?.error?.message ??
              record.error ??
              (record.status === "failed"
                ? "Codex turn failed."
                : "Codex turn was interrupted."),
          ).slice(0, 1000);
        this.endTurn(record);
        if (active) {
          active.turnDone?.();
          if (!stopped) this.active.delete(record.id);
        }
        this.bump(record);
        if (!stopped) process.kill();
        return;
      }
    }
  }
  private claudeEvent(
    record: SessionRecord,
    process: JsonProcess,
    msg: any,
    resultSeen: { index?: number; done: boolean },
  ) {
    const active = this.active.get(record.id);
    if (active?.process === process) this.alive(record, active);
    if (
      typeof msg.session_id === "string" &&
      record.threadId !== msg.session_id
    ) {
      record.threadId = msg.session_id.slice(0, 200);
      // Resume depends on this ID, so it is persisted right away.
      record.updatedAt = new Date().toISOString();
      this.persist();
    }
    if (msg.type === "system" && msg.subtype === "permission_denied") {
      this.deny(record, [msg.tool_name]);
      this.dirty(record);
      return;
    }
    if (msg.type === "assistant") {
      for (const item of msg.message?.content ?? []) {
        if (item.type === "text") this.append(record, item.text);
        else if (item.type === "tool_use")
          this.append(record, `\n${item.name}\n`);
      }
      return;
    }
    if (msg.type !== "result") return;
    // One turn per -p run: a later result (e.g. after background work) never reopens the turn.
    if (
      resultSeen.done ||
      (typeof msg.result_index === "number" &&
        resultSeen.index !== undefined &&
        msg.result_index <= resultSeen.index)
    )
      return;
    resultSeen.done = true;
    if (typeof msg.result_index === "number")
      resultSeen.index = msg.result_index;
    // A result after Stop belongs to the interrupted turn, which is already recorded as stopped.
    if (this.active.get(record.id)?.process !== process) return;
    if (Array.isArray(msg.permission_denials))
      this.deny(
        record,
        msg.permission_denials.map((d: any) => d?.tool_name),
      );
    const failed =
      msg.is_error === true ||
      (typeof msg.subtype === "string" && msg.subtype !== "success");
    record.status = failed ? "failed" : "completed";
    if (failed)
      record.error = String(
        (typeof msg.result === "string" && msg.result) ||
          (Array.isArray(msg.errors) && msg.errors.join("\n")) ||
          [msg.subtype, msg.terminal_reason].filter(Boolean).join(": ") ||
          "Claude turn failed.",
      ).slice(0, 1000);
    if (typeof msg.result === "string" && msg.result) {
      if (!failed) record.final = msg.result.slice(-FINAL_MAX);
      if (!record.output.trim()) record.output = msg.result.slice(-64000);
    }
    this.endTurn(record);
    // The turn is over: a follow-up may start while this process finishes exiting.
    this.active.delete(record.id);
    this.bump(record);
    const exitTimer = setTimeout(() => process.kill(), 10000);
    exitTimer.unref();
    process.child.once("close", () => clearTimeout(exitTimer));
  }
  private deny(record: SessionRecord, tools: unknown[]) {
    const names = tools
      .filter((t): t is string => typeof t === "string" && !!t)
      .map((t) => t.slice(0, 200));
    if (!names.length) return;
    const denied = new Set(record.blocked?.deniedTools ?? []);
    for (const name of names) denied.add(name);
    record.blocked = { deniedTools: [...denied].slice(0, 50) };
  }
  private async launch(
    record: SessionRecord,
    command: string[],
    cwd: string,
    text: string,
  ) {
    // Resume uses the provider's stored transcript, rather than rebuilding its harness here.
    const args =
      record.provider === "codex"
        ? [...command, "app-server", "--listen", "stdio://"]
        : [
            ...command,
            "-p",
            "--verbose",
            "--output-format",
            "stream-json",
            "--permission-mode",
            "default",
            ...(record.threadId ? ["--resume", record.threadId] : []),
          ];
    let gotResult = false;
    const resultSeen: { index?: number; done: boolean } = { done: false };
    const process = new JsonProcess(
      args,
      cwd,
      (msg) => {
        if (record.provider === "codex") {
          if (msg.method === "turn/completed") gotResult = true;
          this.codexEvent(record, process, msg);
        } else {
          if (msg.type === "result") gotResult = true;
          this.claudeEvent(record, process, msg, resultSeen);
        }
      },
      (error) => {
        const active = this.active.get(record.id);
        // A daemon shutdown leaves the session running on disk; the next start marks it interrupted.
        if (active?.process !== process || this.stopping) return;
        this.active.delete(record.id);
        if (active.stopped) record.status = "stopped";
        else if (!gotResult) {
          record.status = "failed";
          record.error = error ?? "Provider closed without a completed turn.";
        } else return;
        this.endTurn(record);
        this.bump(record);
      },
    );
    this.active.set(record.id, {
      process,
      stopped: false,
      pending: new Map(),
      lastEventAt: Date.now(),
    });
    if (record.provider === "codex") {
      await process.request("initialize", {
        clientInfo: { name: "sushii", title: "Sushii", version: "1.0.0" },
      });
      process.send({ method: "initialized", params: {} });
      const thread = await process.request(
        record.threadId ? "thread/resume" : "thread/start",
        {
          ...(record.threadId ? { threadId: record.threadId } : {}),
          cwd,
          approvalPolicy: "on-request",
          sandbox: "workspace-write",
        },
      );
      record.threadId = thread.thread.id;
      this.persist();
      const result = await process.request("turn/start", {
        threadId: record.threadId,
        input: [{ type: "text", text, text_elements: [] }],
        cwd,
        approvalPolicy: "on-request",
        sandboxPolicy: {
          type: "workspaceWrite",
          writableRoots: [cwd],
          networkAccess: false,
          excludeTmpdirEnvVar: true,
          excludeSlashTmp: true,
        },
      });
      const active = this.active.get(record.id);
      if (active) active.turnId ??= result.turn.id;
      if (record.turn && !record.turn.endedAt && result?.turn?.id)
        record.turn.id ??= String(result.turn.id).slice(0, 200);
    } else {
      process.child.stdin.end(text);
    }
  }
  private stopping = false;
  stop() {
    this.stopping = true;
    clearInterval(this.stallTimer);
    for (const active of this.active.values()) active.process.kill();
    if (this.persistTimer) this.persist();
  }
}
