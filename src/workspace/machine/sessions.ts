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
  type RequestDetail,
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
  /** The turn the owner cancelled through an approval; its interruption is the owner's stop. */
  cancelledTurn?: string;
  lastEventAt: number;
  /** File changes Codex announced, by item id, so their approval can show what it changes. */
  files: Map<string, FileChanges>;
}
const APPROVAL_DECISIONS: AnswerDecision[] = [
  "accept",
  "acceptForSession",
  "decline",
  "cancel",
];
const FINAL_MAX = 4000;
const KEEP_FINISHED = 200;
const COMMAND_MAX = 8000;
const REASON_MAX = 300;
/** One announced file change; `change` is null when Codex used a shape this daemon does not know. */
type FileChanges = { path: string; change: "add" | "delete" | "update" | null; movePath?: string; diff: string }[];
const fileLine = (c: FileChanges[number]) =>
  `${c.change ?? "unknown change to"} ${c.path}${c.movePath ? ` → ${c.movePath}` : ""}`;
/** Codex 0.162 PatchChangeKind: {type:"add"} | {type:"delete"} | {type:"update", move_path: string|null}. */
function parseChange(raw: any): FileChanges[number] {
  const path = typeof raw?.path === "string" ? raw.path : "";
  const kind = raw?.kind;
  const diff = typeof raw?.diff === "string" ? raw.diff : "";
  if (kind?.type === "add" || kind?.type === "delete") return { path, change: kind.type, diff };
  if (kind?.type === "update" && (kind.move_path === null || kind.move_path === undefined))
    return { path, change: "update", diff };
  if (kind?.type === "update" && typeof kind.move_path === "string" && kind.move_path)
    return { path, change: "update", movePath: kind.move_path, diff };
  return { path, change: null, diff };
}
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const cut = (v: string | undefined, n: number) =>
  v && v.length > n ? `${v.slice(0, n - 1)}…` : v;
/**
 * Codex server requests that wait on the owner; anything else is refused. The approved thing (command,
 * host, files) leads and is kept whole; the model's own reason is cut short and labelled. When the
 * approved thing is missing or too long to show, the only answer offered is to decline.
 */
function codexRequest(
  method: string,
  params: any,
  files: Map<string, FileChanges>,
):
  | { description: string; decisions: AnswerDecision[]; detail: RequestDetail }
  | undefined {
  const reason = cut(str(params?.reason), REASON_MAX);
  const describe = (lines: (string | undefined)[], fallback: string) =>
    [...lines, reason ? `Agent's explanation: ${reason}` : undefined]
      .filter(Boolean)
      .join("\n")
      .slice(0, 2000) || fallback;
  if (method === "item/commandExecution/requestApproval") {
    const kind = params?.kind === "writeStdin" ? "writeStdin" : "command";
    const command = str(params?.command);
    const host = str(params?.networkApprovalContext?.host);
    const protocol = str(params?.networkApprovalContext?.protocol);
    const cwd = str(params?.cwd);
    const shown = (!!command && command.length <= COMMAND_MAX) || (!command && !!host);
    return {
      description: describe(
        [
          host ? `Network access: ${host}${protocol ? ` (${protocol})` : ""}` : undefined,
          command
            ? `${kind === "writeStdin" ? "Write to a running terminal" : "Run"}: ${command}`
            : undefined,
          cwd ? `Working folder: ${cwd}` : undefined,
        ],
        "Codex requests permission for an action it did not describe.",
      ),
      decisions: shown ? APPROVAL_DECISIONS : ["decline"],
      detail: {
        kind,
        ...(command && command.length <= COMMAND_MAX ? { command } : {}),
        ...(cwd ? { cwd: cwd.slice(0, 2000) } : {}),
        ...(host ? { host: host.slice(0, 500) } : {}),
        ...(protocol ? { protocol: protocol.slice(0, 50) } : {}),
        ...(reason ? { reason } : {}),
      },
    };
  }
  if (method === "item/fileChange/requestApproval") {
    const changes = files.get(String(params?.itemId)) ?? [];
    const grantRoot = str(params?.grantRoot);
    const diff = changes.map((c) => c.diff).join("\n");
    // Approving means seeing every change: an unknown change shape, an unnamed file or an oversize list declines.
    const shown =
      changes.length > 0 &&
      changes.length <= 100 &&
      diff.length <= 8000 &&
      changes.every((c) => c.change !== null && c.path && c.path.length <= 2000 && (c.movePath ?? "").length <= 2000);
    return {
      description: describe(
        [
          grantRoot ? `Write access to: ${grantRoot}` : undefined,
          changes.length ? `Change files: ${changes.map(fileLine).join(", ")}` : undefined,
        ],
        "Codex requests permission for a file change it did not describe.",
      ),
      decisions: shown ? APPROVAL_DECISIONS : ["decline"],
      detail: {
        kind: "fileChange",
        ...(grantRoot ? { grantRoot: grantRoot.slice(0, 2000) } : {}),
        ...(shown
          ? {
              files: changes.map((c) => ({
                path: c.path,
                change: c.change!,
                ...(c.movePath ? { movePath: c.movePath } : {}),
              })),
              ...(diff ? { diff } : {}),
            }
          : {}),
        ...(reason ? { reason } : {}),
      },
    };
  }
  if (method === "item/permissions/requestApproval") {
    const permissions = params?.permissions ? JSON.stringify(params.permissions) : undefined;
    const shown = !!permissions && permissions.length <= 4000;
    return {
      description: describe(
        [permissions ? `Grant permissions: ${permissions}` : undefined],
        "Codex requests permissions it did not describe.",
      ),
      decisions: shown ? ["accept", "acceptForSession", "decline"] : ["decline"],
      detail: {
        kind: "permissions",
        ...(shown ? { permissions } : {}),
        ...(reason ? { reason } : {}),
      },
    };
  }
  if (method === "item/tool/requestUserInput")
    return {
      // Answers need free text the app cannot collect yet, so declining is the only reply.
      description: describe(
        (Array.isArray(params?.questions) ? params.questions : []).map(
          (q: any) =>
            [
              str(q?.header),
              str(q?.question),
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
      detail: { kind: "question" },
    };
  if (method === "mcpServer/elicitation/request")
    return {
      description: describe(
        [
          str(params?.serverName) ? `${params.serverName} asks:` : undefined,
          str(params?.message),
          str(params?.url) ? `Link: ${params.url}` : undefined,
        ],
        "An MCP server asks for input.",
      ),
      decisions: ["decline", "cancel"],
      detail: { kind: "elicitation" },
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
/** A record as a gateway parses it: an older gateway rejects the event fields and the path. */
export function wireRecord(record: SessionRecord, events: boolean, paths = false) {
  const copy = structuredClone(record);
  if (!paths) delete copy.path;
  if (events) return copy;
  for (const key of SESSION_EVENT_FIELDS) delete copy[key];
  for (const r of copy.requests) {
    delete r.decisions;
    delete r.detail;
  }
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
      keepFinished?: number;
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
  /** Per session: resolves once its last provider process has exited. */
  private exits = new Map<string, Promise<void>>();
  private closing(id: string, process: JsonProcess) {
    const exited = process.exited
      ? Promise.resolve()
      : new Promise<void>((resolve) => process.child.once("close", () => resolve()));
    this.exits.set(id, exited);
    void exited.then(() => {
      if (this.exits.get(id) === exited) this.exits.delete(id);
    });
  }
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
  /** Keeps every live session and the newest finished ones, so the store never fills up with history. */
  private prune(keepFinished = this.opts.keepFinished ?? KEEP_FINISHED) {
    const finished = this.records
      .filter((r) => !this.active.has(r.id) && r.status !== "running" && r.status !== "needs-you")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (finished.length <= keepFinished) return;
    const drop = new Set(finished.slice(keepFinished).map((r) => r.id));
    this.records = this.records.filter((r) => !drop.has(r.id));
    this.persist();
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
      // Cancel ends Codex's turn: the owner chose that, so that turn's interruption reads as a stop.
      if (p.decision === "cancel") active.cancelledTurn = active.turnId;
      record.requests = record.requests.filter((r) => r !== request);
      record.status = record.requests.length ? "needs-you" : "running";
      // The wait was the owner's, not a silent provider.
      active.lastEventAt = Date.now();
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
        try {
          await active.process.request("turn/steer", {
            threadId: record.threadId,
            input: [{ type: "text", text: p.text, text_elements: [] }],
            expectedTurnId: active.turnId,
          });
          record.promptIds = [...record.promptIds, p.requestId].slice(-100);
          record.output = (record.output + `\nYou: ${p.text}\n\n`).slice(-64000);
          this.note(record, p.origin, "steer", p.text);
          this.alive(record, active);
          // The request id guards against a repeat, so it is persisted at once.
          record.updatedAt = new Date().toISOString();
          this.persist();
          return structuredClone(record);
        } catch (err) {
          // The turn ended while the steer was in flight: resume the transcript with the message instead.
          if (this.active.get(record.id) === active) throw err;
        }
      } else if (active) {
        // Claude Code -p takes no input mid-turn: SIGINT ends the turn cleanly, then the transcript resumes.
        active.stopped = true;
        this.active.delete(record.id);
        active.process.interrupt(this.opts.stopGraceMs ?? 5000);
      }
    }
    const run = async () => {
      let record: SessionRecord;
      let cwd: string;
      if (p.action === "start") {
        const dir = await this.files.codingDir(p.rootId, p.path);
        cwd = dir.cwd;
        const existing = this.records.find((r) => r.id === p.sessionId);
        if (existing) {
          if (
            existing.taskId !== p.taskId ||
            existing.rootId !== p.rootId ||
            existing.path !== dir.path ||
            existing.provider !== p.provider
          )
            throw new Error(
              "Session ID is already used by another assignment.",
            );
          return structuredClone(existing); // Idempotent start: a timeout never creates duplicate work.
        }
        this.prune();
        if (this.records.length >= 1000)
          throw new Error("Remote session storage is full.");
        record = {
          id: p.sessionId,
          taskId: p.taskId,
          rootId: p.rootId,
          ...(dir.path ? { path: dir.path } : {}),
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
        // A resumed transcript belongs to the folder it started in.
        cwd = (await this.files.codingDir(record.rootId, record.path)).cwd;
      }
      // A previous provider process for this session may still be exiting; two must never share a transcript.
      await this.exits.get(record.id);
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
    // Waiting out a previous process happens before the lock, so it never holds up other agents.
    if (p.action !== "start") await this.exits.get(p.sessionId);
    const next = this.mutation.then(run, run);
    this.mutation = next.catch(() => {});
    return next;
  }
  private codexEvent(record: SessionRecord, process: JsonProcess, msg: any) {
    const active = this.active.get(record.id);
    if (active?.process === process) this.alive(record, active);
    if (msg.id !== undefined && msg.method) {
      const request = active
        ? codexRequest(msg.method, msg.params, active.files)
        : undefined;
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
        if (
          msg.params?.item?.type === "fileChange" &&
          active &&
          Array.isArray(msg.params.item.changes) &&
          active.files.size < 200
        )
          active.files.set(
            String(msg.params.item.id),
            msg.params.item.changes.slice(0, 101).map(parseChange),
          );
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
        const turnId = msg.params?.turn?.id ?? active?.turnId;
        const stopped =
          active?.stopped === true ||
          (status === "interrupted" && !!active?.cancelledTurn && active.cancelledTurn === turnId);
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
          if (this.active.get(record.id) === active) this.active.delete(record.id);
        }
        this.bump(record);
        process.kill();
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
    this.closing(record.id, process);
    this.active.set(record.id, {
      process,
      stopped: false,
      pending: new Map(),
      lastEventAt: Date.now(),
      files: new Map(),
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
