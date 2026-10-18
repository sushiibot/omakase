import { MAINTENANCE, maintenanceParams, maintenanceResult, type MaintenanceRequest } from "../maintenanceContracts.ts";
import { artifactReadParams, artifactList, artifactDocument } from "../artifactContracts.ts";
import { TASKS_MANAGE, tasksParams, tasksResult, type TaskRequest } from "../taskContracts.ts";
import {
  BROWSER_READ,
  BROWSER_CONTROL,
  browserControlParams,
  type BrowserControlRequest,
  browserReadParams,
  browserReadResult,
  type BrowserReadResult,
} from "../browserContracts.ts";
import { memoryParams, memoryOverview, memoryDetail } from "../memoryContracts.ts";
import { ownerUpdateParams, runsStopParams, runsStopResult } from "../contracts.ts";
import { AGENT_RESULT, agentResultParams, agentResultReply, type AgentResultParams } from "../machines/contracts.ts";
import { connectorsParams, connectorsResult, type ConnectorRequest, type ConnectorsResult } from "../contracts.ts";
import type { z } from "zod";
import {
  CHAT_EXPORT_TIMEOUT_MS,
  HISTORY_SEARCH_TIMEOUT_MS,
  RPC_METHODS,
  RUNS_TIMEOUT_MS,
  historyDayParams,
  historyDayResult,
  historyDaysParams,
  historyDaysResult,
  historySearchParams,
  historySearchResult,
  runsGetParams,
  runsGetResult,
  runsListParams,
  runsListResult,
  type HistoryDayResult,
  type HistoryDaysResult,
  type HistorySearchResult,
  type RunsGetResult,
  type RunsListResult,
  topicsManageParams,
  topicsManageResult,
  chatRewindResult,
  chatExportResult,
  type ChatExportParams,
  type ChatExportResult,
  type ChatOrigin,
  modelsGetParams,
  modelsResult,
  modelsSearchParams,
  modelsSearchResult,
  modelsSetParams,
  type ModelsResult,
  type ModelsSearchResult,
} from "../contracts.ts";
import { RpcErrorReply, WorkspaceNotConnectedError } from "../transport/server.ts";

/** The workspace answered a read with something outside the contract. */
export class WorkspaceBadResponseError extends Error {
  constructor(
    readonly method: string,
    readonly issues?: z.ZodError,
  ) {
    super(`${method}: response outside the contract`);
  }
}

export const MESSAGE_TIMEOUT_MS = 10_000;
export const CONTROL_TIMEOUT_MS = 30_000;
// The workspace bounds the whole chat/new, memory flush included, at 3m30s (NEW_BUDGET_MS).
export const NEW_SESSION_TIMEOUT_MS = 240_000;

/** Transport is supplied by the owner; no store or delivery setup is needed. */
export interface WorkspaceApiOptions {
  principalId: string;
  request: (method: string, params: unknown, timeoutMs: number) => Promise<unknown>;
  isConnected: () => boolean;
}

export class WorkspaceApi {
  constructor(private readonly opts: WorkspaceApiOptions) {}

  /** One page of the Main transcript for the import. An old workspace without the method rejects with MethodNotFound. */
  async chatExport(q: Omit<ChatExportParams, "principalId">): Promise<ChatExportResult> {
    const params: ChatExportParams = { principalId: this.opts.principalId, ...q };
    return chatExportResult.parse(await this.opts.request(RPC_METHODS.chatExport, params, CHAT_EXPORT_TIMEOUT_MS));
  }

  /** `timeoutMs` lets Home answer within its own budget. */
  async runsList(q: Omit<z.input<typeof runsListParams>, "principalId">, timeoutMs = RUNS_TIMEOUT_MS): Promise<RunsListResult> {
    return this.read(RPC_METHODS.runsList, runsListParams, runsListResult, q, timeoutMs);
  }

  async runsGet(q: Omit<z.input<typeof runsGetParams>, "principalId">): Promise<RunsGetResult> {
    return this.read(RPC_METHODS.runsGet, runsGetParams, runsGetResult, q, RUNS_TIMEOUT_MS);
  }

  async browserControl(request: BrowserControlRequest): Promise<BrowserReadResult> {
    return this.read(BROWSER_CONTROL, browserControlParams, browserReadResult, { request }, 130_000);
  }

  async browserRead(conversationId: string, frames = false): Promise<BrowserReadResult> {
    return this.read(BROWSER_READ, browserReadParams, browserReadResult, { conversationId, frames }, 5000);
  }

  async tasksManage(request: TaskRequest) {
    return this.read(TASKS_MANAGE, tasksParams, tasksResult, { request }, RUNS_TIMEOUT_MS);
  }

  async maintenance(request: MaintenanceRequest) {
    return this.read(MAINTENANCE, maintenanceParams, maintenanceResult, { request }, 5 * 60_000);
  }

  async artifactsRead(id?: string, query?: string) {
    return id === undefined ? this.read("artifacts/read", artifactReadParams, artifactList, { query }, RUNS_TIMEOUT_MS) : this.read("artifacts/read", artifactReadParams, artifactDocument.nullable(), { id }, RUNS_TIMEOUT_MS);
  }

  async memoryRead(id?: string) {
    return id === undefined ? this.read("memory/read", memoryParams, memoryOverview, {}, RUNS_TIMEOUT_MS) : this.read("memory/read", memoryParams, memoryDetail, { id }, RUNS_TIMEOUT_MS);
  }

  async historyDays(q: Omit<z.input<typeof historyDaysParams>, "principalId">): Promise<HistoryDaysResult> {
    return this.read(RPC_METHODS.historyDays, historyDaysParams, historyDaysResult, q, RUNS_TIMEOUT_MS);
  }

  async historyDay(q: Omit<z.input<typeof historyDayParams>, "principalId">): Promise<HistoryDayResult> {
    return this.read(RPC_METHODS.historyDay, historyDayParams, historyDayResult, q, RUNS_TIMEOUT_MS);
  }

  async historySearch(q: Omit<z.input<typeof historySearchParams>, "principalId">): Promise<HistorySearchResult> {
    return this.read(RPC_METHODS.historySearch, historySearchParams, historySearchResult, q, HISTORY_SEARCH_TIMEOUT_MS);
  }

  async connectors(request: ConnectorRequest): Promise<ConnectorsResult> {
    return this.read(RPC_METHODS.connectors, connectorsParams, connectorsResult, { request }, 60_000);
  }

  async runsStop(runId: string): Promise<{ stopped: boolean }> {
    return this.read(RPC_METHODS.runsStop, runsStopParams, runsStopResult, { runId }, CONTROL_TIMEOUT_MS);
  }

  async topicManage(q: { id: string; action: "create" | "close" | "reopen" | "rename"; title?: string; brief?: string }): Promise<void> {
    await this.read(RPC_METHODS.topicsManage, topicsManageParams, topicsManageResult, q, NEW_SESSION_TIMEOUT_MS);
  }

  async modelsGet(conversationId?: string): Promise<ModelsResult> {
    return this.read(RPC_METHODS.modelsGet, modelsGetParams, modelsResult, conversationId ? { conversationId } : {}, CONTROL_TIMEOUT_MS);
  }

  /** Switches the owner's model, or the ChatGPT fallback, from the next turn, as `!model <alias>` does. */
  async modelsSet(alias: string, role: "main" | "fallback" = "main"): Promise<ModelsResult> {
    return this.read(RPC_METHODS.modelsSet, modelsSetParams, modelsResult, { alias, ...(role === "fallback" ? { role } : {}) }, CONTROL_TIMEOUT_MS);
  }

  /** Sends the owner's new name to a connected workspace. An offline or older workspace (no such method)
   *  is skipped: it reads the name from the register result when it next connects. */
  async ownerUpdate(name: string | null): Promise<void> {
    if (!this.opts.isConnected()) return;
    try {
      await this.opts.request(RPC_METHODS.ownerUpdate, ownerUpdateParams.parse({ principalId: this.opts.principalId, name }), CONTROL_TIMEOUT_MS);
    } catch (err) {
      if (err instanceof WorkspaceNotConnectedError || (err instanceof RpcErrorReply && err.code === -32601)) return;
      throw err;
    }
  }

  /** Wakes a conversation with a coding agent's result. "unsupported" and "offline" mean the workspace
   *  cannot take it (older version, or disconnected), so the caller tells the owner instead. */
  async agentResult(q: Omit<AgentResultParams, "principalId">): Promise<"delivered" | "unsupported" | "offline"> {
    if (!this.opts.isConnected()) return "offline";
    try {
      await this.read(AGENT_RESULT, agentResultParams, agentResultReply, q, CONTROL_TIMEOUT_MS);
      return "delivered";
    } catch (err) {
      if (err instanceof WorkspaceNotConnectedError) return "offline";
      if (err instanceof RpcErrorReply && err.code === -32601) return "unsupported";
      throw err;
    }
  }

  async modelsSearch(query: string): Promise<ModelsSearchResult> {
    return this.read(RPC_METHODS.modelsSearch, modelsSearchParams, modelsSearchResult, { query }, RUNS_TIMEOUT_MS);
  }

  /** A read-only workspace request. Run and history content is agent-writable, so a result outside the
   *  contract rejects the whole response with WorkspaceBadResponseError. */
  private async read<P extends z.ZodTypeAny, R extends z.ZodTypeAny>(method: string, params: P, result: R, q: object, timeoutMs: number): Promise<z.infer<R>> {
    const raw = await this.opts.request(method, params.parse({ ...q, principalId: this.opts.principalId }), timeoutMs);
    const parsed = result.safeParse(raw);
    if (!parsed.success) throw new WorkspaceBadResponseError(method, parsed.error);
    return parsed.data;
  }

  async rewind(messageId: string, origin: ChatOrigin): Promise<{ ok: boolean; error?: string }> {
    return chatRewindResult.parse(await this.opts.request(RPC_METHODS.chatRewind, { principalId: this.opts.principalId, messageId, origin }, 30_000));
  }
}
