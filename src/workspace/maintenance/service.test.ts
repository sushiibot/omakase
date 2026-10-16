import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MaintenanceService } from "./service.ts";
import { fingerprint, type CalendarEvent, type CalendarPort } from "./calendar.ts";
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
const input = { serverId: "00000000-0000-4000-8000-000000000001", eventId: "show", emailId: "ticket", after: "2026-11-01T00:00:00Z", before: "2026-11-03T00:00:00Z", reason: "Same show, date and venue", excerpts: ["Doors open at 7 pm. Seat A12."] };
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "maintenance-test-")); dirs.push(dir);
  let event: CalendarEvent = { id: "show", title: "Friday show", start: "2026-11-02T20:00:00", timeZone: "America/Los_Angeles", description: "My own notes", participants: null };
  let email = { id: "ticket", subject: "Your Friday show ticket", receivedAt: "2026-10-16T12:00:00Z", bodyText: input.excerpts[0]! };
  let writes = 0, failAfterWrite = false, binding = "adapter-1";
  const port: CalendarPort = {
    binding: async () => binding,
    event: async (_input, expected) => { if (expected !== binding) throw new Error("changed connector"); return structuredClone(event); },
    email: async () => structuredClone(email),
    update: async (_input, description) => { writes++; event = { ...event, description }; if (failAfterWrite) throw new Error("network lost"); },
  };
  const store = new MaintenanceService(dir, port, () => new Date("2026-10-16T12:00:00Z"));
  return { dir, store, port, event: () => event, setEvent: (v: Partial<CalendarEvent>) => { event = { ...event, ...v }; }, setEmail: () => { email.bodyText += " Changed"; }, writes: () => writes, fail: () => { failAfterWrite = true; }, rebind: () => { binding = "adapter-2"; } };
}
test("preparing is read-only, survives restart, and duplicate approval writes once", async () => {
  const s = setup(); const p = await s.store.prepare(input);
  expect(s.writes()).toBe(0); expect(p.before).toBe("My own notes"); expect(p.after).toContain(input.excerpts[0]!);
  const restarted = new MaintenanceService(s.dir, s.port);
  expect(restarted.view().proposals[0]?.id).toBe(p.id);
  const results = await Promise.all([1, 2].map(() => s.store.command({ action: "approve", id: p.id, revision: 1 })));
  expect(results.every(r => !r.error)).toBe(true); expect(s.writes()).toBe(1);
  expect(s.store.view().proposals[0]?.status).toBe("completed");
  expect(s.event().description).toContain("My own notes");
});
test("dismissal suppresses forwarded or repeated excerpts for the same event", async () => {
  const s = setup(); const p = await s.store.prepare(input);
  await s.store.command({ action: "dismiss", id: p.id, revision: 1 });
  expect((await s.store.prepare(input)).status).toBe("dismissed"); expect(s.store.view().proposals).toHaveLength(1);
});
test("fabricated excerpts and participant-bearing events cannot become proposals", async () => {
  const s = setup(); await expect(s.store.prepare({ ...input, excerpts: ["Invented seat"] })).rejects.toThrow("exact excerpt");
  s.setEvent({ participants: { guest: { email: "guest@example.com" } } });
  await expect(s.store.prepare(input)).rejects.toThrow("participants"); expect(s.writes()).toBe(0);
});
test("source changes and owner edits block approval", async () => {
  for (const change of ["email", "event"] as const) {
    const s = setup(); const p = await s.store.prepare(input);
    if (change === "email") s.setEmail(); else s.setEvent({ description: "Owner changed the notes" });
    const result = await s.store.command({ action: "approve", id: p.id, revision: 1 });
    expect(result.error).toBeTruthy(); expect(s.writes()).toBe(0); expect(result.view.proposals[0]?.status).toBe("conflict");
  }
});
test("new invitees and changed connector bindings prevent dispatch", async () => {
  for (const change of ["invitee", "connector"] as const) {
    const s = setup(); const p = await s.store.prepare(input);
    if (change === "invitee") s.setEvent({ participants: [{ email: "guest@example.com" }] }); else s.rebind();
    expect((await s.store.command({ action: "approve", id: p.id, revision: 1 })).error).toBeTruthy(); expect(s.writes()).toBe(0);
  }
});
test("pause and revision mismatch refuse approval", async () => {
  const s = setup(); const p = await s.store.prepare(input);
  expect((await s.store.command({ action: "approve", id: p.id, revision: 2 })).error).toBeTruthy();
  await s.store.command({ action: "pause", paused: true });
  expect((await s.store.command({ action: "approve", id: p.id, revision: 1 })).error).toContain("paused");
  await expect(s.store.prepare(input)).rejects.toThrow("paused"); expect(s.writes()).toBe(0);
});
test("uncertain provider acceptance is reconciled without repeating the write", async () => {
  const s = setup(); const p = await s.store.prepare(input); s.fail();
  await s.store.command({ action: "approve", id: p.id, revision: 1 });
  expect(s.store.view().proposals[0]?.status).toBe("uncertain");
  const restarted = new MaintenanceService(s.dir, s.port);
  await restarted.command({ action: "reconcile", id: p.id, revision: 1 });
  expect(restarted.view().proposals[0]?.status).toBe("completed"); expect(s.writes()).toBe(1);
});
test("Undo restores original notes, but never overwrites later owner changes", async () => {
  for (const changed of [false, true]) {
    const s = setup(); const p = await s.store.prepare(input);
    await s.store.command({ action: "approve", id: p.id, revision: 1 });
    if (changed) s.setEvent({ description: "New owner notes" });
    const result = await s.store.command({ action: "undo", id: p.id, revision: 1 });
    expect(s.event().description).toBe(changed ? "New owner notes" : "My own notes");
    expect(s.writes()).toBe(changed ? 1 : 2); expect(!!result.error).toBe(changed);
  }
});
test("interrupted intent becomes uncertain, never automatically retried", async () => {
  const s = setup(); const p = await s.store.prepare(input);
  const file = join(s.dir, "maintenance.json"); const saved = JSON.parse(readFileSync(file, "utf8")); saved.proposals[0].status = "executing"; writeFileSync(file, JSON.stringify(saved));
  const restarted = new MaintenanceService(s.dir, s.port);
  expect(restarted.view().proposals[0]?.status).toBe("uncertain");
  expect((await restarted.command({ action: "approve", id: p.id, revision: 1 })).error).toBeTruthy(); expect(s.writes()).toBe(0);
});
test("canonical hashes ignore object property order, not event changes", () => {
  expect(fingerprint({ a: 1, b: 2 })).toBe(fingerprint({ b: 2, a: 1 }));
  expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
});

test("pause during preparation prevents saving, and pause during validation prevents the write", async () => {
  for (const phase of ["prepare", "approve"] as const) {
    const s = setup(); const prepared = phase === "approve" ? await s.store.prepare(input) : undefined;
    const original = s.port.email; let entered!: () => void; let release!: () => void;
    const started = new Promise<void>(r => { entered = r; }); const held = new Promise<void>(r => { release = r; });
    s.port.email = async (args, binding) => { entered(); await held; return original(args, binding); };
    const pending = phase === "prepare" ? s.store.prepare(input).then(() => "saved", () => "paused") : s.store.command({ action: "approve", id: prepared!.id, revision: 1 });
    await started; await s.store.command({ action: "pause", paused: true }); release();
    const result = await pending;
    expect(s.writes()).toBe(0);
    if (phase === "prepare") { expect(result).toBe("paused"); expect(s.store.view().proposals).toHaveLength(0); }
    else expect(typeof result === "object" && result.error).toContain("paused");
  }
});

test("host handlers enforce principal and no model tool can approve or write", async () => {
  const s = setup();
  await expect(s.store.handlers("owner")["maintenance/manage"]({ principalId: "other", request: { action: "pause", paused: true } })).rejects.toThrow("wrong principal");
  expect(s.store.tools().map(t => t.name)).toEqual(["calendar_maintenance_list", "calendar_maintenance_prepare"]);
});

test("an interrupted Undo is reconciled as undone, without repeating it", async () => {
  const s = setup(); const p = await s.store.prepare(input);
  await s.store.command({ action: "approve", id: p.id, revision: 1 }); s.fail();
  await s.store.command({ action: "undo", id: p.id, revision: 1 });
  expect(s.store.view().proposals[0]?.status).toBe("uncertain");
  const restarted = new MaintenanceService(s.dir, s.port);
  await restarted.command({ action: "reconcile", id: p.id, revision: 1 });
  expect(restarted.view().proposals[0]?.status).toBe("undone"); expect(s.writes()).toBe(2);
});

test("proposal notifications are durably queued once, including retries after restart", async () => {
  const s = setup(); const sent: string[] = [];
  s.store.setNotifier(p => { sent.push(p.id); });
  const p = await s.store.prepare(input);
  await s.store.prepare(input);
  expect(sent).toEqual([p.id]);
  const restarted = new MaintenanceService(s.dir, s.port, () => new Date("2026-10-16T12:00:00Z"));
  restarted.setNotifier(p => { sent.push(p.id); });
  expect(sent).toEqual([p.id]);
});
test("failed notification enqueue is retried, but dismissed proposals are not notified", async () => {
  const s = setup(); let attempts = 0;
  s.store.setNotifier(() => { attempts++; throw new Error("disk full"); });
  const p = await s.store.prepare(input);
  expect(p.status).toBe("pending"); expect(attempts).toBe(1);
  const sent: string[] = [];
  const restarted = new MaintenanceService(s.dir, s.port, () => new Date("2026-10-16T12:00:00Z"));
  restarted.setNotifier(p => { sent.push(p.id); });
  expect(sent).toEqual([p.id]);
  const other = setup(); const dismissed = await other.store.prepare(input);
  await other.store.command({ action: "dismiss", id: dismissed.id, revision: 1 });
  other.store.setNotifier(p => { sent.push(p.id); });
  expect(sent).toEqual([p.id]);
});
