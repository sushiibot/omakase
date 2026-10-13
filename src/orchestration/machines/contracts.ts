import { z } from "zod";
export const machineId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
export const provider = z.enum(["codex", "claude"]);
export type Provider = z.infer<typeof provider>;
export const sessionStatus = z.enum([
  "running",
  "needs-you",
  "completed",
  "failed",
  "stopped",
  "interrupted",
]);
export type SessionStatus = z.infer<typeof sessionStatus>;
export const machineInfo = z
  .object({
    name: z.string().min(1).max(100),
    roots: z
      .array(
        z
          .object({
            id: machineId,
            name: z.string().max(100),
            coding: z.boolean(),
          })
          .strict(),
      )
      .max(32),
    providers: z.array(provider).max(2),
    /** Only the features the gateway asked about; an older gateway rejects the key. */
    features: z.array(z.string().max(32)).max(16).optional(),
  })
  .strict();
export const fileRequest = z
  .object({
    action: z.enum(["list", "read", "search"]),
    machineId,
    rootId: machineId,
    path: z.string().max(2000).default("."),
    query: z.string().min(1).max(200).optional(),
    offset: z.number().int().min(0).max(10000000).default(0),
  })
  .strict();
/** A folder relative to a coding root: no absolute path, drive letter or `..` segment. */
export const agentPath = z
  .string()
  .max(2000)
  .refine((p) => p.trim().length > 0, "The folder path is empty.")
  .refine((p) => !/^([\\/]|[A-Za-z]:)/.test(p), "Use a folder path relative to the coding folder.")
  .refine((p) => !p.split(/[\\/]/).includes(".."), "The folder path cannot contain '..'.");
export const answerDecision = z.enum([
  "accept",
  "acceptForSession",
  "decline",
  "cancel",
]);
export type AnswerDecision = z.infer<typeof answerDecision>;
export const actionOrigin = z.enum(["owner", "agent"]);
export const requestDetail = z
  .object({
    kind: z.enum([
      "command",
      "writeStdin",
      "fileChange",
      "permissions",
      "question",
      "elicitation",
    ]),
    command: z.string().max(8000).optional(),
    cwd: z.string().max(2000).optional(),
    host: z.string().max(500).optional(),
    protocol: z.string().max(50).optional(),
    grantRoot: z.string().max(2000).optional(),
    files: z
      .array(
        z
          .object({
            path: z.string().max(2000),
            change: z.enum(["add", "delete", "update"]),
            movePath: z.string().max(2000).optional(),
          })
          .strict(),
      )
      .max(100)
      .optional(),
    diff: z.string().max(8000).optional(),
    permissions: z.string().max(4000).optional(),
    /** The provider's own explanation, written by the model: context, never the thing approved. */
    reason: z.string().max(300).optional(),
  })
  .strict();
export type RequestDetail = z.infer<typeof requestDetail>;
export const sessionRequest = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("start"),
      sessionId: machineId,
      taskId: z.string().max(80),
      rootId: machineId,
      provider,
      text: z.string().trim().min(1).max(60000),
      /** Working folder relative to the root; only sent to a daemon that negotiated sessionPath. */
      path: agentPath.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("prompt"),
      sessionId: machineId,
      text: z.string().trim().min(1).max(60000),
      requestId: machineId,
    })
    .strict(),
  // Reaches the session in any state: resumes an idle one, steers or restarts a running one.
  z
    .object({
      action: z.literal("message"),
      sessionId: machineId,
      text: z.string().trim().min(1).max(60000),
      requestId: machineId,
      origin: actionOrigin,
    })
    .strict(),
  z.object({ action: z.literal("get"), sessionId: machineId }).strict(),
  z.object({ action: z.literal("stop"), sessionId: machineId }).strict(),
  z
    .object({
      action: z.literal("answer"),
      sessionId: machineId,
      requestId: z.union([z.string().max(200), z.number()]),
      decision: answerDecision,
    })
    .strict(),
]);
export const sessionRecord = z
  .object({
    id: machineId,
    taskId: z.string().max(80),
    rootId: machineId,
    /** The resolved working folder relative to the root, with `/` separators; absent means the root. */
    path: z.string().max(2000).optional(),
    provider,
    threadId: z.string().max(200).optional(),
    status: sessionStatus,
    output: z.string().max(64000),
    error: z.string().max(1000).optional(),
    updatedAt: z.string(),
    attempts: z.number().int().min(1),
    requests: z
      .array(
        z.object({
          id: z.union([z.string().max(200), z.number()]),
          method: z.string().max(200),
          description: z.string().max(2000),
          /** Answers this request accepts; absent means accept or decline. */
          decisions: z.array(answerDecision).max(4).optional(),
          /** Exactly what an approval allows, shown in full before any decision. */
          detail: requestDetail.optional(),
        }),
      )
      .max(20),
    promptIds: z.array(machineId).max(100),
    // Event fields: bumped only on status, request, error or turn changes. Absent from older daemons.
    stateVersion: z.number().int().min(0).optional(),
    turn: z
      .object({
        id: z.string().max(200).optional(),
        startedAt: z.string(),
        endedAt: z.string().optional(),
      })
      .strict()
      .optional(),
    final: z.string().max(4000).optional(),
    blocked: z
      .object({ deniedTools: z.array(z.string().max(200)).max(50) })
      .strict()
      .optional(),
    /** Running with no provider output for the daemon's stall window; stalledAt names the episode. */
    stalled: z.boolean().optional(),
    stalledAt: z.string().optional(),
    messages: z
      .array(
        z
          .object({
            at: z.string(),
            origin: actionOrigin,
            mode: z.enum(["resume", "steer", "restart"]),
            text: z.string().max(500),
          })
          .strict(),
      )
      .max(20)
      .optional(),
  })
  .strict();
export type SessionRecord = z.infer<typeof sessionRecord>;
/** Fields only a gateway that negotiated session events understands; an older gateway parses records strictly. */
export const SESSION_EVENT_FIELDS = [
  "stateVersion",
  "turn",
  "final",
  "blocked",
  "stalled",
  "stalledAt",
  "messages",
] as const;
export const SESSION_EVENTS_FEATURE = "sessionEvents";
/** The daemon starts sessions in a folder below the coding root. */
export const SESSION_PATH_FEATURE = "sessionPath";
export const MACHINE_SESSIONS = "machine/sessions";
export const MACHINE_SESSION_CHANGED = "machine/sessionChanged";
export const sessionSummary = z
  .object({
    sessionId: machineId,
    taskId: z.string().max(80),
    stateVersion: z.number().int().min(0),
    status: sessionStatus,
  })
  .strict();
export type SessionSummary = z.infer<typeof sessionSummary>;

/** Gateway → workspace: a coding agent finished, failed, was interrupted or stalled; the workspace wakes the
 *  conversation that started it. */
export const AGENT_RESULT = "agents/result";
export const agentResultParams = z
  .object({
    principalId: z.string(),
    conversationId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
    agentId: machineId,
    stateVersion: z.number().int().min(0),
    status: z.enum(["completed", "failed", "interrupted", "stalled"]),
    provider,
    title: z.string().max(200),
    machineName: z.string().max(100),
    final: z.string().max(4000).optional(),
    error: z.string().max(1000).optional(),
    deniedTools: z.array(z.string().max(200)).max(50).optional(),
    tail: z.string().max(2000).optional(),
  })
  .strict();
export type AgentResultParams = z.infer<typeof agentResultParams>;
export const agentResultReply = z.object({ accepted: z.literal(true) }).strict();
