import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { defineDocFamily, type Session } from "@earendil-works/pi-durable";
import { DurableState } from "../agentRuntime/durableState.ts";
import { Type } from "typebox";
import { z } from "zod";
import type {
  ExtensionFactory,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  chatOrigin,
  TOPIC_ID_RE,
  type ChatOrigin,
} from "../orchestration/contracts.ts";
import { taskId } from "../orchestration/taskContracts.ts";
import { isValidTimeZone } from "./scheduler.ts";
import type { Wake } from "./personalSession.ts";
import type { TaskStore } from "./taskStore.ts";
import type { TopicSessions } from "./topicSessions.ts";
import { ulid } from "./ulid.ts";

const timestamp = z.string().datetime({ offset: true });
const purpose = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
const timeZone = z.string().refine(isValidTimeZone, "Use an IANA time zone.");
const checkSchema = z
  .object({
    id: z.string().min(1).max(80),
    key: purpose,
    title: z.string().trim().min(1).max(200),
    prompt: z.string().trim().min(1).max(16000),
    at: timestamp,
    timeZone,
    origin: chatOrigin,
    conversationId: z.string().regex(TOPIC_ID_RE),
    taskId: taskId.optional(),
    status: z.enum(["pending", "consumed", "cancelled"]),
    revision: z.number().int().positive(),
    createdAt: timestamp,
    updatedAt: timestamp,
    reason: z.string().max(500).optional(),
  })
  .strict();
export type ScheduledCheck = z.infer<typeof checkSchema>;

const scheduleArgs = checkSchema
  .pick({ key: true, title: true, prompt: true, at: true, taskId: true })
  .extend({
    timeZone: timeZone.optional(),
    conversationId: z.string().regex(TOPIC_ID_RE).optional(),
  })
  .strict();
const rescheduleArgs = z
  .object({
    id: checkSchema.shape.id,
    at: timestamp,
    timeZone: timeZone.optional(),
  })
  .strict();
const MAX_RECORDS = 2000;
const MAX_PENDING = 100;

const Checks = defineDocFamily({
  kind: "sushii.scheduled-checks",
  version: 1,
  scope: "session",
  family: true,
  initial: (_: null) => ({ records: [] as ScheduledCheck[] }),
});

/** One-time checks are durable until their prompt is consumed; recurring jobs keep their own scheduler. */
export class WakeupManager {
  private records: ScheduledCheck[] = [];
  private readonly store: DurableState;
  private readonly ownsStore: boolean;
  private session?: Session;
  private opening?: Promise<void>;
  private writes: Promise<void> = Promise.resolve();
  private failure: unknown;
  private readonly queued = new Set<string>();
  private readonly dispatching = new Set<Promise<void>>();
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;

  constructor(
    private readonly opts: {
      stateDir: string;
      store?: DurableState;
      timeZone: string;
      tasks?: Pick<TaskStore, "get" | "list">;
      conversationExists: (id: string) => boolean;
      deliver: (check: ScheduledCheck, wake: Wake) => Promise<void>;
      now?: () => Date;
      newId?: () => string;
      pollMs?: number;
      ready?: () => boolean;
      warn?: (error: unknown, message: string) => void;
    },
  ) {
    if (!isValidTimeZone(opts.timeZone))
      throw new Error("Invalid wake-up time zone.");
    this.store = opts.store ?? new DurableState(opts.stateDir);
    this.ownsStore = !opts.store;
  }

  async open(): Promise<void> {
    this.opening ??= (async () => {
      this.session = await this.store.open();
      if (
        !(await this.session.snapshot(Checks, "workspace", BACKGROUND_CONTEXT))
      ) {
        await this.session.commit(async (tx) => {
          await tx.doc(Checks, "workspace", null);
        }, BACKGROUND_CONTEXT);
      }
      const doc = (await this.session.snapshot(
        Checks,
        "workspace",
        BACKGROUND_CONTEXT,
      ))!;
      // Reject damaged state instead of silently losing promised follow-ups.
      this.records = z.array(checkSchema).max(MAX_RECORDS).parse(doc.records);
    })();
    await this.opening;
  }

  /** Pi awaits this fence before model requests and tool side effects. */
  async flush(): Promise<void> {
    await this.open();
    await this.writes;
    if (this.failure !== undefined) throw this.failure;
  }

  private now() {
    return this.opts.now?.() ?? new Date();
  }
  private token(check: ScheduledCheck) {
    return `scheduled:${check.id}:${check.revision}`;
  }
  private save(records: ScheduledCheck[]) {
    if (!this.session)
      throw new Error("Scheduled checks have not been opened.");
    if (this.failure !== undefined) throw this.failure;
    const saved = JSON.parse(JSON.stringify(records)) as ScheduledCheck[];
    this.records = records;
    this.writes = this.writes
      .then(async () => {
        if (this.failure !== undefined) return;
        await this.session!.commit(async (tx) => {
          const doc = await tx.doc(Checks, "workspace", null);
          doc.records = saved;
        }, BACKGROUND_CONTEXT);
      })
      .catch((error) => {
        this.failure = error;
      });
  }
  private replace(check: ScheduledCheck) {
    this.save(this.records.map((r) => (r.id === check.id ? check : r)));
  }
  private get(id: string) {
    const check = this.records.find((r) => r.id === id);
    if (!check)
      throw new Error(
        "Scheduled check not found. Use list_scheduled_checks first.",
      );
    return check;
  }
  private future(at: string) {
    if (Date.parse(at) <= this.now().getTime())
      throw new Error(
        "Choose a future date and time with an explicit UTC offset.",
      );
    return new Date(at).toISOString();
  }
  private task(id: string) {
    if (!this.opts.tasks) throw new Error("Task checks are unavailable.");
    return this.opts.tasks.get(id);
  }
  private finishedTask(check: ScheduledCheck): boolean {
    if (!check.taskId) return false;
    const task = this.task(check.taskId);
    return task.status === "done" || task.status === "cancelled";
  }

  list(includeFinished = false) {
    return structuredClone(
      this.records
        .filter((r) => includeFinished || r.status === "pending")
        .sort((a, b) => Date.parse(a.at) - Date.parse(b.at)),
    );
  }

  schedule(
    raw: unknown,
    origin: ChatOrigin,
  ): { check: ScheduledCheck; existing: boolean } {
    const args = scheduleArgs.parse(raw);
    const currentConversation =
      origin.surface === "web" ? origin.conversationId : "main";
    const task = args.taskId
      ? this.task(args.taskId)
      : this.opts.tasks
          ?.list()
          .find(
            (t) =>
              t.workConversationId ===
              (args.conversationId ?? currentConversation),
          );
    if (task?.status === "done" || task?.status === "cancelled")
      throw new Error("This task is already complete or cancelled.");
    const conversationId =
      args.conversationId ??
      (task
        ? (task.workConversationId ?? task.sourceConversationId)
        : currentConversation);
    if (!this.opts.conversationExists(conversationId))
      throw new Error("Unknown conversation. Choose an existing conversation.");
    const target =
      conversationId === currentConversation
        ? origin
        : { surface: "web" as const, conversationId };
    // The same task/purpose is shared across conversations. Ordinary checks belong to their conversation.
    const existing = this.records.find(
      (r) =>
        r.status === "pending" &&
        r.key === args.key &&
        (task
          ? r.taskId === task.id
          : !r.taskId && r.conversationId === conversationId),
    );
    if (existing) return { check: structuredClone(existing), existing: true };
    if (
      this.records.filter((r) => r.status === "pending").length >= MAX_PENDING
    )
      throw new Error("Too many pending checks. Cancel unused checks first.");
    const at = this.future(args.at);
    const now = this.now().toISOString();
    const check: ScheduledCheck = {
      id: (this.opts.newId ?? ulid)(),
      key: args.key,
      title: args.title,
      prompt: args.prompt,
      at,
      timeZone: args.timeZone ?? this.opts.timeZone,
      origin: chatOrigin.parse(target),
      conversationId,
      ...(task ? { taskId: task.id } : {}),
      status: "pending",
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    // Trim only terminal history; pending promises are never dropped to make room.
    const retained =
      this.records.length < MAX_RECORDS
        ? this.records
        : this.records.filter(
            (r) =>
              r.status === "pending" ||
              r.id !== this.records.find((r) => r.status !== "pending")?.id,
          );
    this.save([...retained, check]);
    return { check: structuredClone(check), existing: false };
  }

  reschedule(raw: unknown) {
    const args = rescheduleArgs.parse(raw);
    const current = this.get(args.id);
    if (current.status !== "pending")
      throw new Error(
        "This check is no longer pending. Schedule a new check instead.",
      );
    if (this.finishedTask(current))
      throw new Error("This task is already complete or cancelled.");
    const check = {
      ...current,
      at: this.future(args.at),
      timeZone: args.timeZone ?? current.timeZone,
      revision: current.revision + 1,
      updatedAt: this.now().toISOString(),
    };
    this.replace(check);
    return structuredClone(check);
  }

  cancel(id: string, reason = "Cancelled") {
    const current = this.get(id);
    if (current.status !== "pending") return structuredClone(current);
    const check: ScheduledCheck = {
      ...current,
      status: "cancelled",
      reason,
      updatedAt: this.now().toISOString(),
    };
    this.replace(check);
    return structuredClone(check);
  }

  private isPending(check: ScheduledCheck) {
    const current = this.get(check.id);
    if (
      this.stopped ||
      current.status !== "pending" ||
      current.revision !== check.revision
    ) {
      this.queued.delete(this.token(check));
      return false;
    }
    if (this.finishedTask(current)) {
      this.cancel(current.id, "Task completed or cancelled");
      this.queued.delete(this.token(check));
      return false;
    }
    return true;
  }

  /** Due and overdue checks run after restart. Queued checks wait for their conversation to become idle. */
  async tick() {
    if (this.stopped || this.opts.ready?.() === false) return;
    await this.flush();
    const pending = this.list();
    for (const check of pending) {
      const token = this.token(check);
      try {
        if (
          !this.isPending(check) ||
          Date.parse(check.at) > this.now().getTime() ||
          this.queued.has(token)
        )
          continue;
      } catch (error) {
        this.opts.warn?.(
          error,
          "Cannot check a scheduled item; retaining its wake-up",
        );
        continue;
      }
      this.queued.add(token);
      const wake: Wake = {
        id: token,
        origin: check.origin,
        text: scheduledCheckPrompt(check),
        isPending: () => this.isPending(check),
        onConsumed: () => {
          const current = this.get(check.id);
          if (
            current.status === "pending" &&
            current.revision === check.revision
          )
            this.replace({
              ...current,
              status: "consumed",
              updatedAt: this.now().toISOString(),
            });
          this.queued.delete(token);
        },
        onFailed: (error) => {
          this.queued.delete(token);
          this.opts.warn?.(
            error,
            "Scheduled prompt was not consumed; retrying on the next poll",
          );
        },
      };
      const dispatch = Promise.resolve()
        .then(() => this.opts.deliver(check, wake))
        .catch((error) => {
          this.queued.delete(token);
          this.opts.warn?.(
            error,
            "Scheduled check could not be queued; retrying on the next poll",
          );
        });
      this.dispatching.add(dispatch);
      void dispatch.finally(() => this.dispatching.delete(dispatch));
    }
    await Promise.all(this.dispatching);
  }

  start() {
    this.stopped = false;
    if (!this.timer) {
      this.timer = setInterval(
        () =>
          void this.tick().catch((error) =>
            this.opts.warn?.(error, "Wake-up poll failed"),
          ),
        this.opts.pollMs ?? 30_000,
      );
      this.timer.unref();
    }
    return this.tick();
  }
  async stop() {
    this.stopped = true;
    clearInterval(this.timer);
    this.timer = undefined;
    await Promise.all(this.dispatching);
    this.queued.clear();
    try {
      await this.flush();
    } finally {
      if (this.ownsStore) await this.store.close();
    }
  }

  tools(origin: () => ChatOrigin): ToolDefinition[] {
    const result = (value: unknown) => ({
      content: [{ type: "text" as const, text: JSON.stringify(value) }],
      details: {},
    });
    return [
      {
        name: "schedule_check",
        label: "Schedule a check",
        description:
          "Schedule a one-time follow-up that wakes the agent in an existing conversation at a specific date/time. Use a stable key for the item's purpose, such as deployment-status. An existing pending check for the same task/conversation and key is returned unchanged; use reschedule_check to move it. Supply taskId for a persistent assignment. The prompt must say what to check and when to notify the owner. Check current status and existing unanswered requests before asking again. Recurring jobs and heartbeat remain separate.",
        parameters: Type.Object({
          key: Type.String({
            description:
              "Stable purpose key: lowercase letters, digits and hyphens, max 80 characters.",
          }),
          title: Type.String({ maxLength: 200 }),
          prompt: Type.String({
            maxLength: 16000,
            description:
              "Check instructions, item context, and conditions for notifying the owner.",
          }),
          at: Type.String({
            description:
              "Future ISO 8601 date/time with Z or an explicit UTC offset, e.g. 2026-10-12T15:30:00-07:00.",
          }),
          timeZone: Type.Optional(
            Type.String({
              description: `IANA display time zone; defaults to ${this.opts.timeZone}. The offset in at determines the instant.`,
            }),
          ),
          taskId: Type.Optional(Type.String()),
          conversationId: Type.Optional(
            Type.String({
              description:
                "Existing target conversation; defaults to the task's conversation or current conversation.",
            }),
          ),
        }),
        execute: async (_id, args) => {
          await this.flush();
          const value = this.schedule(args, origin());
          await this.flush();
          return result(value);
        },
      },
      {
        name: "list_scheduled_checks",
        label: "List scheduled checks",
        description:
          "List shared pending one-time checks across conversations and tasks, ordered by wake-up time. Inspect existing checks before adding a follow-up. includeFinished also returns consumed and cancelled checks; consumed means the prompt reached the agent, not that the item is complete.",
        parameters: Type.Object({
          includeFinished: Type.Optional(Type.Boolean()),
        }),
        execute: async (_id, raw) => {
          await this.flush();
          const args = z
            .object({ includeFinished: z.boolean().optional() })
            .strict()
            .parse(raw);
          return result({
            now: this.now().toISOString(),
            timeZone: this.opts.timeZone,
            checks: this.list(args.includeFinished),
          });
        },
      },
      {
        name: "reschedule_check",
        label: "Reschedule a check",
        description:
          "Move an existing pending check to a future ISO date/time with an explicit UTC offset. Replaces its queued wake-up; does not create another check.",
        parameters: Type.Object({
          id: Type.String(),
          at: Type.String(),
          timeZone: Type.Optional(Type.String()),
        }),
        execute: async (_id, args) => {
          await this.flush();
          const value = this.reschedule(args);
          await this.flush();
          return result(value);
        },
      },
      {
        name: "cancel_scheduled_check",
        label: "Cancel a scheduled check",
        description:
          "Cancel a pending one-time check, including a wake-up waiting behind a busy conversation. Already consumed checks cannot stop a run; use the normal task/run stop controls for active work.",
        parameters: Type.Object({ id: Type.String() }),
        execute: async (_id, raw) => {
          const args = z
            .object({ id: checkSchema.shape.id })
            .strict()
            .parse(raw);
          await this.flush();
          const value = this.cancel(args.id);
          await this.flush();
          return result(value);
        },
      },
    ];
  }

  awareness(): ExtensionFactory {
    return (pi) => {
      let context = "";
      pi.on("before_agent_start", () => {
        const checks = this.list();
        context = `One-time follow-ups use schedule_check, list_scheduled_checks, reschedule_check and cancel_scheduled_check. Keep heartbeat for broad periodic review. Reuse a stable item/purpose key and inspect existing checks to avoid duplicates. Completed/cancelled tasks automatically cancel pending checks. A wake-up is a check, not a request for the owner; notify only for a useful change or a decision.\nCurrent time: ${this.now().toISOString()}; owner time zone: ${this.opts.timeZone}.\nPending checks (${checks.length}; first 40): ${JSON.stringify(checks.slice(0, 40).map(({ id, key, title, at, timeZone, conversationId, taskId }) => ({ id, key, title, at, timeZone, conversationId, taskId })))}`;
      });
      pi.on("context_with_system", ({ messages }) => {
        if (!context || messages[0]?.role !== "system") return;
        const [system, ...rest] = messages;
        return {
          messages: [
            {
              ...system,
              sections: { ...system.sections, scheduledChecks: context },
            },
            ...rest,
          ],
        };
      });
    };
  }
}

export function scheduledCheckPrompt(check: ScheduledCheck): string {
  return `[Scheduled check ${check.id}; purpose ${check.key}; due ${check.at}; time zone ${check.timeZone}]\n${check.title}\n${check.prompt}\n${check.taskId ? `Task: ${check.taskId}. Read its current state with task_manage and keep its outcome/checklist current.\n` : ""}This is an automated follow-up, not a new owner message. Check the item's current status and existing unresolved questions/approvals first. Reuse an existing request for the same decision; do not ask it again. If the item is resolved or nothing useful changed, reply NO_REPLY. If another check is needed, schedule it deliberately with the same purpose key. Do not create a duplicate task or restart an active agent.`;
}

/** Task checks resume the task's own work conversation; ordinary checks retain their original surface. */
export async function deliverScheduledCheck(
  topics: TopicSessions,
  tasks: TaskStore,
  check: ScheduledCheck,
  wake: Wake,
  prepareTask: (id: string) => Promise<void>,
) {
  if (!wake.isPending?.()) return;
  let origin = check.origin;
  if (check.taskId) {
    // The bot must create its chat log/routing too; creating only a local topic would lose delivery.
    await prepareTask(check.taskId);
    if (!wake.isPending?.()) return;
    const task = tasks.get(check.taskId);
    if (!task.workConversationId)
      throw new Error("The task's work conversation was not prepared.");
    origin = { surface: "web", conversationId: task.workConversationId };
  }
  const session = await topics.session(origin);
  if (wake.isPending?.()) session.wake({ ...wake, origin });
}
