import { expect, test } from "bun:test";
import { FastmailCalendar } from "./calendar.ts";
import type { ConnectorManager } from "../connectors.ts";

function setup() {
  const calls: Array<{ name: string; args: unknown }> = [];
  const event = { id: "event-1", title: "Show", start: "2026-11-02T20:00:00", timeZone: "America/Los_Angeles", participants: null, description: "Notes" };
  let generation = "connection-1";
  let shape: unknown = { events: [event] };
  const connectors: Pick<ConnectorManager, "maintenanceTool" | "maintenanceCall"> = {
    maintenanceTool: async (_id, name) => ({ url: "https://api.fastmail.com/mcp", generation, tool: { name, inputSchema: { type: "object", properties: (name === "search_events" ? { after: { type: "string" }, before: { type: "string" } } : name === "read_email" ? { id: { type: "string" } } : { id: { type: "string" }, description: { type: "string" } }) as Record<string, object> } } }),
    maintenanceCall: async (_id, name, args) => { calls.push({ name, args }); return name === "search_events" ? shape : name === "read_email" ? { id: "email-1", subject: "Ticket", receivedAt: "2026-10-16T00:00:00Z", bodyText: "Seat A12" } : { id: "event-1" }; },
  };
  const adapter = new FastmailCalendar(connectors);
  const input = { serverId: "connector-1", eventId: "event-1", emailId: "email-1", after: "2026-11-01", before: "2026-11-03", reason: "Matching date", excerpts: ["Seat A12"] };
  return { adapter, input, calls, rebind: () => { generation = "connection-2"; }, response: (v: unknown) => { shape = v; } };
}
test("Fastmail adapter reads exact identities and writes only the approved notes field", async () => {
  const s = setup(); const binding = await s.adapter.binding(s.input.serverId);
  expect((await s.adapter.event(s.input, binding)).id).toBe("event-1");
  expect((await s.adapter.email(s.input, binding)).id).toBe("email-1");
  await s.adapter.update(s.input, "Notes\nSeat A12", binding);
  expect(s.calls.at(-1)).toEqual({ name: "update_event", args: { id: "event-1", description: "Notes\nSeat A12" } });
});
test("changed account binding and ambiguous or unrecognized provider data fail closed", async () => {
  const s = setup(); const binding = await s.adapter.binding(s.input.serverId);
  s.response({ unexpected: [] }); await expect(s.adapter.event(s.input, binding)).rejects.toThrow("Unsupported");
  s.response({ events: [{ id: "event-1" }, { id: "event-1" }] }); await expect(s.adapter.event(s.input, binding)).rejects.toThrow("ambiguous");
  s.rebind(); await expect(s.adapter.update(s.input, "Notes", binding)).rejects.toThrow("changed");
  expect(s.calls.some(c => c.name === "update_event")).toBe(false);
});
