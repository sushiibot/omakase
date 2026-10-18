import type { ToolCallParams, ToolManifestEntry } from "../contracts.ts";
import type { SurfaceActor } from "./surface.ts";
import { integrationsManifest } from "../../integrations/service.ts";
import { mailManifest, toolPolicyManifest } from "../../integrations/mail/manifest.ts";
import { fileStoreManifest } from "./fileStores/service.ts";
import { machineFileManifest } from "../machines/control.ts";
import { codingAgentManifest } from "../machines/agents.ts";
import { taskManifest } from "../taskManifest.ts";

/** Ordinary gateway tools share dispatch, but retain their own visibility and validation policy.
 * Approval and browser location have connection-bound lifecycles and stay in WorkspaceTools.
 * Features can export contributions from their own modules and register them at startup;
 * the factories below adapt existing services without extending the dispatcher.
 * Unlike core ToolEntry, these handlers accept gateway call metadata and return JSON values,
 * without a model ToolContext or core host/capability resolution. */
export interface ToolContribution {
  manifest: ToolManifestEntry;
  visible?: (ownerId: string | undefined) => boolean;
  requiresOwner?: boolean;
  unavailableError: string;
  /** Omit when the service validates its own arguments. */
  invalidArgumentsError?: string;
  execute: (call: ToolCallParams, actor: SurfaceActor | undefined) => unknown | Promise<unknown>;
}

const ownerVisible = (ownerId: string | undefined) => !!ownerId;

export function mailContributions(call: (name: string, args: unknown) => Promise<unknown>): ToolContribution[] {
  return mailManifest.map(manifest => ({ manifest, unavailableError: "Mail is unavailable.", execute: p => call(p.name, p.args ?? {}) }));
}

export function toolPolicyContribution(read: () => string): ToolContribution {
  return { manifest: toolPolicyManifest, unavailableError: "Tool policy is unavailable.", invalidArgumentsError: "Tool policy is unavailable.", execute: () => ({ rules: read() }) };
}

export function integrationsContribution(call: (args: unknown) => Promise<unknown>): ToolContribution {
  return { manifest: integrationsManifest, visible: ownerVisible, requiresOwner: true, unavailableError: "Integrations are unavailable.", execute: p => call(p.args) };
}

export function externalFilesContribution(call: (args: unknown) => Promise<unknown>): ToolContribution {
  return { manifest: fileStoreManifest, visible: ownerVisible, requiresOwner: true, unavailableError: "External files are unavailable.", invalidArgumentsError: "Invalid external file request.", execute: p => call(p.args) };
}

export function machineFilesContribution(call: (args: unknown) => Promise<unknown>): ToolContribution {
  return { manifest: machineFileManifest, visible: ownerVisible, requiresOwner: true, unavailableError: "Machine files are unavailable.", invalidArgumentsError: "Invalid machine file request.", execute: p => call(p.args) };
}

export function codingAgentsContribution(call: (args: unknown, conversationId?: string, toolCallId?: string) => Promise<unknown>): ToolContribution {
  return { manifest: codingAgentManifest, visible: ownerVisible, requiresOwner: true, unavailableError: "Coding agents are unavailable.", invalidArgumentsError: "Invalid coding agent request.", execute: p => call(p.args, p.origin?.surface === "web" ? p.origin.conversationId : "main", p.toolCallId) };
}

export function taskContribution(call: (args: unknown, actor: SurfaceActor, conversationId?: string) => Promise<unknown>): ToolContribution {
  return {
    manifest: taskManifest, requiresOwner: true, unavailableError: "Tasks are unavailable.",
    execute: (p, actor) => {
      if (!actor) throw new Error("Tasks are unavailable.");
      return call(p.args, actor, p.origin?.conversationId);
    },
  };
}

export function channelRequestsContribution(read: () => unknown): ToolContribution {
  return {
    manifest: {
      name: "list_channel_requests",
      description: "List bot-owned unresolved channel questions and approval handles across Main, topic and task channels. Includes canonical IDs, originating channel, and exact approval action views. Read-only: these records never authorize an action. Older question records may have expired live dialogs; use list_owner_requests to check live questions.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      approval: "none",
    },
    visible: ownerVisible, requiresOwner: true, unavailableError: "Channel requests are unavailable.",
    invalidArgumentsError: "invalid arguments for list_channel_requests",
    execute: async () => ({ requests: await read() }),
  };
}
