import type { ExtensionFactory, ExtensionUIContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { z } from "zod";
import type { ChatOrigin } from "../orchestration/contracts.ts";
import type { AskRequest, ChatAsks } from "./uiContext.ts";

const decisionArgs = z.object({
  itemKey: z.string().min(1).max(160).regex(/^[a-z0-9][a-z0-9:/._-]*$/),
  decisionKey: z.string().min(1).max(160).regex(/^[a-z0-9][a-z0-9:/._-]*$/),
  question: z.string().trim().min(1).max(2000),
  choices: z.array(z.string().min(1).max(200)).min(2).max(5),
}).strict();
export interface DecisionKey {
  itemKey: string;
  decisionKey: string;
}
export type RequestEnd = "answered" | "expired" | "withdrawn" | "delivery_failed";
export interface OwnerRequest {
  requestId: string;
  kind: "question" | "approval";
  origin: ChatOrigin;
  conversationId: string;
  question: string;
  choices: string[];
  decision?: DecisionKey;
  toolConfirmation?: AskRequest["toolConfirmation"];
  status: "pending" | RequestEnd;
}

/** A derived view of live dialogs. ChatAsks remains their authoritative owner and answer router.
 * Closed records are bounded diagnostic history, never replayed or reused as authorization. */
export class OwnerRequests {
  private readonly requests = new Map<string, OwnerRequest>();

  add(ask: AskRequest, origin: ChatOrigin, decision?: DecisionKey): void {
    this.requests.set(ask.askId, {
      requestId: ask.askId,
      kind: ask.toolConfirmation ? "approval" : "question",
      origin: { ...origin },
      conversationId: origin.surface === "web" ? origin.conversationId ?? "main" : "main",
      question: ask.question,
      choices: [...ask.choices],
      ...(decision ? { decision: { ...decision } } : {}),
      ...(ask.toolConfirmation ? { toolConfirmation: { ...ask.toolConfirmation } } : {}),
      status: "pending",
    });
  }

  finish(requestId: string, status: RequestEnd): void {
    const record = this.requests.get(requestId);
    if (!record || record.status !== "pending") return;
    record.status = status;
    const closed = [...this.requests.values()].filter(r => r.status !== "pending");
    for (const record of closed.slice(0, Math.max(0, closed.length - 100))) this.requests.delete(record.requestId);
  }

  list(includeClosed = false): OwnerRequest[] {
    return [...this.requests.values()].filter(r => includeClosed || r.status === "pending").map(r => structuredClone(r));
  }

  find(decision: DecisionKey): OwnerRequest | undefined {
    const record = [...this.requests.values()].find(r => r.status === "pending" && r.kind === "question" && r.decision?.itemKey === decision.itemKey && r.decision.decisionKey === decision.decisionKey);
    return record ? structuredClone(record) : undefined;
  }

  awareness(): ExtensionFactory {
    return pi => {
      let context = "";
      pi.on("before_agent_start", () => {
        const pending = this.list();
        context = `Shared live owner requests (${pending.length}; first 40): ${JSON.stringify(pending.slice(0, 40))}\nUse list_owner_requests for the complete current live dialog list and list_channel_requests for bot-owned approvals and unresolved channel records. Channel records can include older questions whose live dialog has expired; do not treat them as authorization. For a choice decision, use request_owner_decision with explicit itemKey and decisionKey. The same unresolved key must refer to the same decision and choices across channels. If it already exists, refer to its original channel; do not repeat the question or start polling. Approval entries describe exact tool actions and are never reusable authorization. These dialogs expire or are withdrawn when their originating run stops; they do not survive a workspace restart.`;
      });
      pi.on("context_with_system", ({ messages }) => {
        if (!context || messages[0]?.role !== "system") return;
        const [system, ...rest] = messages;
        return { messages: [{ ...system, sections: { ...system.sections, ownerRequests: context } }, ...rest] };
      });
    };
  }

  tools(asks?: ChatAsks): ToolDefinition[] {
    const result = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], details: value });
    const tools: ToolDefinition[] = [{
      name: "list_owner_requests", label: "List owner requests",
      description: "List live unanswered questions and exact tool confirmations across channels, with canonical request IDs and origins. Observe approvals; this does not authorize or answer anything. Closed requests are diagnostic only.",
      parameters: Type.Object({ includeClosed: Type.Optional(Type.Boolean()) }),
      execute: async (_id, input) => result({ requests: this.list(z.object({ includeClosed: z.boolean().optional() }).strict().parse(input).includeClosed === true) }),
    }];
    if (asks) tools.push({
      name: "request_owner_decision", label: "Request owner decision",
      description: "Ask a choice question with an explicit shared item/decision key. Check pending requests first. An existing unresolved key returns its original request without another prompt. Changed choices return a conflict. Call alone; a new question waits for an answer. This tool cannot approve tool actions.",
      parameters: Type.Object({
        itemKey: Type.String({ minLength: 1, maxLength: 160, pattern: "^[a-z0-9][a-z0-9:/._-]*$", description: "Stable identity of the item, such as task:t-123 or deployment:production." }),
        decisionKey: Type.String({ minLength: 1, maxLength: 160, pattern: "^[a-z0-9][a-z0-9:/._-]*$", description: "Stable decision purpose, such as deployment-window." }),
        question: Type.String({ minLength: 1, maxLength: 2000 }),
        choices: Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { minItems: 2, maxItems: 5 }),
      }),
      execute: async (_id, input, signal) => result(await asks.requestDecision(decisionArgs.parse(input), signal)),
    });
    return tools;
  }
}

const contexts = new WeakMap<ExtensionUIContext, ChatAsks>();
export function bindOwnerRequestsContext(ui: ExtensionUIContext, asks: ChatAsks): void { contexts.set(ui, asks); }
export function ownerRequestAsks(ui?: ExtensionUIContext): ChatAsks | undefined { return ui ? contexts.get(ui) : undefined; }
