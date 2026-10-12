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
  type SessionRecord,
} from "../../orchestration/machines/contracts.ts";
import { SharedFiles } from "./files.ts";
import { JsonProcess } from "./process.ts";
export interface ProviderCommands {
  codex?: string[];
  claude?: string[];
}
export class MachineSessions {
  private records: SessionRecord[];
  private active = new Map<
    string,
    { process: JsonProcess; turnId?: string; stopped: boolean }
  >();
  private mutation: Promise<unknown> = Promise.resolve();
  private readonly path: string;
  constructor(
    private files: SharedFiles,
    stateDir: string,
    private commands: ProviderCommands,
  ) {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    this.path = join(stateDir, "sessions.json");
    this.records = existsSync(this.path)
      ? z
          .array(sessionRecord)
          .max(1000)
          .parse(JSON.parse(readFileSync(this.path, "utf8")))
      : [];
    for (const record of this.records)
      if (record.status === "running" || record.status === "needs-you") {
        record.status = "interrupted";
        record.requests = [];
        record.error =
          "Daemon restarted; send a follow-up to resume this session.";
      }
    this.persist();
  }
  private persist() {
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.records), { mode: 0o600 });
    renameSync(tmp, this.path);
  }
  private get(id: string) {
    const record = this.records.find((r) => r.id === id);
    if (!record) throw new Error("Remote session not found.");
    return record;
  }
  private touch(record: SessionRecord) {
    record.updatedAt = new Date().toISOString();
    this.persist();
  }
  private append(record: SessionRecord, text: string) {
    record.output = (record.output + text).slice(-64000);
    this.touch(record);
  }
  async request(raw: unknown) {
    const p = sessionRequest.parse(raw);
    if (p.action === "get") return structuredClone(this.get(p.sessionId));
    if (p.action === "stop") {
      const record = this.get(p.sessionId);
      const active = this.active.get(record.id);
      if (active) {
        active.stopped = true;
        if (record.provider === "codex" && active.turnId)
          await active.process
            .request("turn/interrupt", {
              threadId: record.threadId,
              turnId: active.turnId,
            })
            .catch(() => {});
        active.process.kill();
        this.active.delete(record.id);
      }
      record.status = "stopped";
      record.requests = [];
      this.touch(record);
      return structuredClone(record);
    }
    if (p.action === "answer") {
      const record = this.get(p.sessionId);
      const active = this.active.get(record.id);
      const request = record.requests.find((r) => r.id === p.requestId);
      if (!active || !request)
        throw new Error("This approval is no longer pending.");
      active.process.send({
        id: p.requestId,
        result: { decision: p.decision },
      });
      record.requests = record.requests.filter((r) => r.id !== p.requestId);
      record.status = record.requests.length ? "needs-you" : "running";
      this.touch(record);
      return structuredClone(record);
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
        };
      } else {
        record = this.get(p.sessionId);
        if (record.promptIds.includes(p.requestId))
          return structuredClone(record);
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
        throw new Error("Four remote sessions are already working.");
      if (p.action === "start") this.records.push(record);
      else {
        record.attempts++;
        record.promptIds = [...record.promptIds, p.requestId].slice(-100);
      }
      record.status = "running";
      record.error = undefined;
      record.requests = [];
      this.append(record, `\nYou: ${p.text}\n\n`);
      void this.launch(record, command, cwd, p.text).catch((err) => {
        if (record.status === "stopped") return;
        record.status = "failed";
        record.error = (
          err instanceof Error ? err.message : "Could not start session."
        ).slice(0, 1000);
        this.touch(record);
        this.active.get(record.id)?.process.kill();
        this.active.delete(record.id);
      });
      return structuredClone(record);
    };
    const next = this.mutation.then(run, run);
    this.mutation = next.catch(() => {});
    return next;
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
    const process = new JsonProcess(
      args,
      cwd,
      (msg) => {
        if (record.provider === "codex") {
          if (msg.id !== undefined && msg.method) {
            if (
              [
                "item/commandExecution/requestApproval",
                "item/fileChange/requestApproval",
              ].includes(msg.method) &&
              record.requests.length < 20
            ) {
              record.requests.push({
                id: msg.id,
                method: msg.method,
                description:
                  [
                    msg.params?.reason,
                    msg.params?.command,
                    msg.params?.cwd
                      ? `Working folder: ${msg.params.cwd}`
                      : undefined,
                    msg.params?.grantRoot
                      ? `Requested write access: ${msg.params.grantRoot}`
                      : undefined,
                  ]
                    .filter(Boolean)
                    .join("\n")
                    .slice(0, 2000) ||
                  "Codex requests permission for this operation.",
              });
              record.status = "needs-you";
              this.touch(record);
            } else
              process.send({
                id: msg.id,
                error: {
                  code: -32601,
                  message:
                    "This daemon does not support this interactive request. Report the blocker in your reply.",
                },
              });
          } else if (msg.method === "item/agentMessage/delta")
            this.append(record, String(msg.params?.delta ?? ""));
          else if (
            msg.method === "item/started" &&
            msg.params?.item?.type === "commandExecution"
          )
            this.append(
              record,
              `\n$ ${String(msg.params.item.command).slice(0, 2000)}\n`,
            );
          else if (msg.method === "turn/started") {
            const a = this.active.get(record.id);
            if (a) a.turnId = msg.params?.turn?.id;
          } else if (msg.method === "turn/completed") {
            gotResult = true;
            const status = msg.params?.turn?.status;
            record.status =
              status === "completed"
                ? "completed"
                : status === "interrupted"
                  ? "stopped"
                  : "failed";
            record.requests = [];
            if (status === "failed")
              record.error = String(
                msg.params?.turn?.error?.message ?? "Codex turn failed.",
              ).slice(0, 1000);
            this.touch(record);
            this.active.delete(record.id);
            process.kill();
          }
        } else {
          if (typeof msg.session_id === "string") {
            record.threadId = msg.session_id;
            this.touch(record);
          }
          if (msg.type === "assistant")
            for (const item of msg.message?.content ?? []) {
              if (item.type === "text") this.append(record, item.text);
              else if (item.type === "tool_use")
                this.append(record, `\n${item.name}\n`);
            }
          if (msg.type === "result") {
            gotResult = true;
            record.status = msg.is_error ? "failed" : "completed";
            if (msg.is_error)
              record.error = String(msg.result ?? "Claude turn failed.").slice(
                0,
                1000,
              );
            if (!record.output.trim() && msg.result)
              this.append(record, msg.result);
            this.touch(record);
          }
        }
      },
      (error) => {
        const active = this.active.get(record.id);
        if (active?.process !== process) return;
        this.active.delete(record.id);
        record.requests = [];
        if (active.stopped) record.status = "stopped";
        else if (!gotResult) {
          record.status = "failed";
          record.error = error ?? "Provider closed without a completed turn.";
        }
        this.touch(record);
      },
    );
    this.active.set(record.id, { process, stopped: false });
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
      this.touch(record);
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
      if (active) active.turnId = result.turn.id;
    } else {
      process.child.stdin.end(text);
    }
  }
  stop() {
    for (const active of this.active.values()) active.process.kill();
  }
}
