import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { WorkspaceApi, WorkspaceBadResponseError } from "./api.ts";
import { RpcErrorReply, WorkspaceNotConnectedError } from "../transport/server.ts";
import type { AgentResultParams } from "../machines/contracts.ts";

const agentResult: Omit<AgentResultParams, "principalId"> = {
  conversationId: "main", agentId: "coding", stateVersion: 1,
  status: "completed", provider: "codex", title: "Done", machineName: "local",
};

describe("WorkspaceApi boundary", () => {
  test("validates before transport and stamps the configured principal over untyped input", async () => {
    const calls: unknown[] = [];
    const api = new WorkspaceApi({ principalId: "owner", isConnected: () => true,
      request: async (...args) => { calls.push(args); return { runs: [], before: null, truncated: false }; },
    });
    await expect(api.runsGet({ runId: "../secret" })).rejects.toBeInstanceOf(z.ZodError);
    expect(calls).toEqual([]);
    await api.runsList({ principalId: "other" } as Parameters<WorkspaceApi["runsList"]>[0], 1234);
    expect(calls).toEqual([["runs/list", { principalId: "owner", limit: 30 }, 1234]]);
  });

  test("retains read error identity and direct-parse errors for export and rewind", async () => {
    const api = new WorkspaceApi({ principalId: "owner", isConnected: () => true, request: async () => ({ invalid: true }) });
    try {
      await api.historyDays({});
      throw new Error("expected rejection");
    } catch (err) {
      expect(err).toBeInstanceOf(WorkspaceBadResponseError);
      expect((err as WorkspaceBadResponseError).method).toBe("history/days");
      expect((err as WorkspaceBadResponseError).issues).toBeInstanceOf(z.ZodError);
    }
    await expect(api.chatExport({ limit: 100 })).rejects.toBeInstanceOf(z.ZodError);
    await expect(api.rewind("message", { surface: "web", conversationId: "main" })).rejects.toBeInstanceOf(z.ZodError);
  });

  test("owner updates and agent results retain offline, unsupported, and unexpected-error behavior", async () => {
    let connected = false;
    let calls = 0;
    let failure: Error | undefined;
    const api = new WorkspaceApi({ principalId: "owner", isConnected: () => connected,
      request: async () => { calls++; if (failure) throw failure; return { accepted: true }; },
    });
    await api.ownerUpdate("Owner");
    expect(await api.agentResult(agentResult)).toBe("offline");
    expect(calls).toBe(0);
    connected = true;
    failure = new WorkspaceNotConnectedError();
    await api.ownerUpdate("Owner");
    expect(await api.agentResult(agentResult)).toBe("offline");
    failure = new RpcErrorReply("old workspace", -32601);
    await api.ownerUpdate("Owner");
    expect(await api.agentResult(agentResult)).toBe("unsupported");
    failure = new RpcErrorReply("unexpected", -32603);
    await expect(api.ownerUpdate("Owner")).rejects.toBe(failure);
    await expect(api.agentResult(agentResult)).rejects.toBe(failure);
    failure = undefined;
    expect(await api.agentResult(agentResult)).toBe("delivered");
  });
});
