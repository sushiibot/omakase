import { createHash } from "node:crypto";
import { z } from "zod";
import type { ConnectorManager } from "../connectors.ts";
import type { maintenancePrepare } from "../../orchestration/maintenanceContracts.ts";

export const fingerprint = (value: unknown): string => createHash("sha256").update(stable(value)).digest("hex");
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
const eventSchema = z.object({
  id: z.string(), title: z.string(), start: z.string(), description: z.string().nullish(),
  timeZone: z.string().nullish(), participants: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]).nullable(),
}).passthrough();
const emailSchema = z.object({ id: z.string(), subject: z.string(), receivedAt: z.string(), bodyText: z.string() }).passthrough();
export type CalendarInput = z.infer<typeof maintenancePrepare>;
export type CalendarEvent = z.infer<typeof eventSchema>;
export type CalendarEmail = z.infer<typeof emailSchema>;
export const emailFingerprint = (email: CalendarEmail) => fingerprint({ id: email.id, subject: email.subject, receivedAt: email.receivedAt, bodyText: email.bodyText, from: email.from });
export interface CalendarPort {
  binding(serverId: string): Promise<string>;
  event(input: CalendarInput, binding: string): Promise<CalendarEvent>;
  email(input: CalendarInput, binding: string): Promise<CalendarEmail>;
  update(input: CalendarInput, description: string, binding: string): Promise<void>;
}

/** Fixed provider operations: model output can supply excerpts, never tool names or write arguments. */
export class FastmailCalendar implements CalendarPort {
  constructor(private connectors: Pick<ConnectorManager, "maintenanceTool" | "maintenanceCall">) {}
  private async tool(serverId: string, name: "read_email" | "search_events" | "update_event") {
    const metadata = await this.connectors.maintenanceTool(serverId, name);
    const props = metadata.tool.inputSchema.properties ?? {};
    const required = name === "search_events" ? ["after", "before"] : name === "read_email" ? ["id"] : ["id", "description"];
    if (!required.every(k => k in props)) throw new Error(`Fastmail ${name} has an unsupported schema. Reconnect or update the adapter.`);
    if ((metadata.tool.inputSchema.required ?? []).some(k => !required.includes(k))) throw new Error(`Fastmail ${name} requires unsupported arguments.`);
    return metadata;
  }
  async binding(serverId: string) {
    return fingerprint(await Promise.all((["read_email", "search_events", "update_event"] as const).map(name => this.tool(serverId, name))));
  }
  private async call(input: CalendarInput, name: "read_email" | "search_events" | "update_event", args: Record<string, unknown>, binding: string) {
    if (await this.binding(input.serverId) !== binding) throw new Error("Connector tools changed. Prepare a new proposal.");
    const metadata = await this.tool(input.serverId, name);
    return this.connectors.maintenanceCall(input.serverId, name, args, JSON.stringify(metadata.tool.inputSchema), metadata.generation);
  }
  async event(input: CalendarInput, binding: string) {
    const raw = await this.call(input, "search_events", { after: input.after, before: input.before }, binding);
    const object = raw as Record<string, unknown> | null;
    const rows = Array.isArray(raw) ? raw : object?.events ?? object?.results;
    if (!Array.isArray(rows)) throw new Error("Unsupported calendar response. No event can be verified.");
    const matching = rows.filter(row => row && typeof row === "object" && row.id === input.eventId);
    if (matching.length !== 1) throw new Error("The calendar event is missing or ambiguous. Refresh the proposal.");
    return eventSchema.parse(matching[0]);
  }
  async email(input: CalendarInput, binding: string) {
    const raw = await this.call(input, "read_email", { id: input.emailId }, binding);
    const email = emailSchema.parse(raw);
    if (email.id !== input.emailId) throw new Error("The source email changed identity.");
    return email;
  }
  async update(input: CalendarInput, description: string, binding: string) {
    await this.call(input, "update_event", { id: input.eventId, description }, binding);
  }
}

export function privateEvent(event: CalendarEvent) {
  if (event.participants && Object.keys(event.participants).length) throw new Error("This event has participants. Updating it could send invitations; calendar maintenance cannot change it.");
}
