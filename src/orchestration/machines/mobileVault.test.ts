import { describe, expect, test } from "bun:test";
import { MobileVaults, vaultRequest } from "./mobileVault.ts";
const id = "phone-11111111-1111-4111-8111-111111111111";
const read = { action: "read", machineId: id, rootId: "vault", path: "note.md" };
const signal = () => new AbortController().signal;
describe("foreground phone vault", () => {
  test("delivers a call once and correlates the result", async () => {
    const hub = new MobileVaults();
    const { session } = hub.connect(id, "Notes");
    const result = hub.request(read);
    const batch = await hub.poll(session, signal());
    expect(batch.requests).toHaveLength(1);
    const controller = new AbortController();
    const pending = hub.poll(session, controller.signal);
    controller.abort();
    expect((await pending).requests).toEqual([]);
    hub.result(session, batch.requests[0]!.id, { content: "hello", hash: "a".repeat(64) });
    expect(await result).toEqual({ content: "hello", hash: "a".repeat(64) });
    expect(hub.list()[0]!.roots[0]!.writable).toBe(true);
    hub.stop();
  });
  test("reconnect rejects outstanding writes without replay", async () => {
    const hub = new MobileVaults();
    const old = hub.connect(id, "Notes");
    const result = hub.request({ ...read, action: "write", content: "new", expectedHash: null });
    const assertion = result.catch(error => error);
    await hub.poll(old.session, signal());
    const next = hub.connect(id, "Notes");
    const error = await assertion;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("disconnected");
    expect(() => hub.result(old.session, "old", {})).toThrow("expired");
    const abort = new AbortController();
    const pending = hub.poll(next.session, abort.signal); abort.abort();
    expect((await pending).requests).toEqual([]);
    hub.stop();
  });
  test("validates paths, actions and write preconditions", () => {
    for (const path of ["../secret.md", "/note.md", ".obsidian/config.md", "folder/../note.md", "a\\note.md", "folder//note.md", "a\u0000.md"]) {
      expect(vaultRequest.safeParse({ ...read, path }).success).toBe(false);
    }
    expect(vaultRequest.safeParse({ ...read, action: "write", content: "x" }).success).toBe(false);
    expect(vaultRequest.safeParse({ ...read, action: "search", query: "x" }).success).toBe(false);
    const hub = new MobileVaults(); hub.connect(id, "Notes");
    expect(() => hub.request({ ...read, path: "file.txt" })).toThrow("Markdown");
    hub.stop();
  });
  test("timeouts explicitly report uncertain completion", async () => {
    const hub = new MobileVaults(5); hub.connect(id, "Notes");
    await expect(hub.request(read)).rejects.toThrow("may have completed"); hub.stop();
  });
  test("pending poll wakes on disconnect and rejects other sessions", async () => {
    const hub = new MobileVaults(); const { session } = hub.connect(id, "Notes");
    const pending = hub.poll(session, signal());
    await expect(hub.poll(session, signal())).rejects.toThrow("already active");
    hub.disconnect(session);
    expect((await pending).requests).toEqual([]);
    expect(hub.list()).toEqual([]);
    expect(() => hub.request(read)).toThrow("offline");
  });
});
