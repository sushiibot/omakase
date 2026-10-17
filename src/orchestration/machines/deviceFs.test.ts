import { describe, expect, test } from "bun:test";
import { DeviceFiles, deviceFileRequest } from "./deviceFs.ts";
const id = "phone-11111111-1111-4111-8111-111111111111";
const read = { action: "read", machineId: id, rootId: "vault", path: "note.md" };
const signal = () => new AbortController().signal;
describe("foreground phone vault", () => {
  test("delivers a call once and correlates the result", async () => {
    const hub = new DeviceFiles();
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
    const hub = new DeviceFiles();
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
    for (const path of ["../secret.md", "/note.md", "folder/../note.md", "a\\note.md", "folder//note.md", "a\u0000.md", "a\u007f.md"]) {
      expect(deviceFileRequest.safeParse({ ...read, path }).success).toBe(false);
    }
    expect(deviceFileRequest.safeParse({ ...read, action: "write", content: "x" }).success).toBe(false);
    expect(deviceFileRequest.safeParse({ ...read, action: "search", query: "x" }).success).toBe(true);
    const hub = new DeviceFiles(); hub.connect(id, "Notes");
    expect(() => hub.request({ ...read, path: "file.txt" })).toThrow("Markdown");
    hub.stop();
  });
  test("timeouts explicitly report uncertain completion", async () => {
    const hub = new DeviceFiles(5); hub.connect(id, "Notes");
    await expect(hub.request(read)).rejects.toThrow("may have completed"); hub.stop();
  });
  test("pending poll wakes on disconnect and rejects other sessions", async () => {
    const hub = new DeviceFiles(); const { session } = hub.connect(id, "Notes");
    const pending = hub.poll(session, signal());
    await expect(hub.poll(session, signal())).rejects.toThrow("already active");
    hub.disconnect(session);
    expect((await pending).requests).toEqual([]);
    expect(hub.list()).toEqual([]);
    expect(() => hub.request(read)).toThrow("offline");
  });
});

test("general folders deliver text, hidden paths and binary files with advertised capabilities", async () => {
  const hub = new DeviceFiles();
  const { session } = hub.connect(id, "Documents", 2);
  expect(hub.list()[0]).toMatchObject({ fileTypes: "all", encodings: ["utf8", "base64"] });
  for (const params of [
    { ...read, path: ".config/settings.json" },
    { ...read, path: "image.png", encoding: "base64" },
    { ...read, action: "write", path: "file.bin", encoding: "base64", content: "AP8=", expectedHash: null },
    { ...read, action: "write", path: "plain.txt", content: "hello", expectedHash: "a".repeat(64) },
  ]) {
    const pending = hub.request(params);
    const batch = await hub.poll(session, signal());
    expect(batch.requests[0]!.params).toMatchObject(params);
    hub.result(session, batch.requests[0]!.id, { ok: true });
    expect(await pending).toEqual({ ok: true });
  }
  hub.stop();
});
test("binary and text writes enforce byte limits and encoding before reaching the phone", () => {
  const hub = new DeviceFiles(); hub.connect(id, "Documents", 2);
  const write = { ...read, action: "write", path: "file.bin", expectedHash: null };
  expect(() => hub.request({ ...write, encoding: "base64", content: "%%%=" })).toThrow("base64");
  expect(() => hub.request({ ...write, encoding: "base64", content: Buffer.alloc(262145).toString("base64") })).toThrow("256 KiB");
  expect(() => hub.request({ ...write, content: "é".repeat(131073) })).toThrow("256 KiB");
  expect(() => hub.request({ ...write, content: "a\0b" })).toThrow("binary");
  expect(deviceFileRequest.safeParse({ ...read, encoding: "hex" }).success).toBe(false);
  hub.stop();
});
test("old APKs keep their original restricted capabilities", () => {
  const hub = new DeviceFiles(); hub.connect(id, "Notes");
  expect(hub.list()[0]).toMatchObject({ fileTypes: "Markdown", encodings: ["utf8"] });
  expect(() => hub.request({ ...read, path: ".private/note.md" })).toThrow("Update");
  expect(() => hub.request({ ...read, encoding: "base64" })).toThrow("Update");
  hub.stop();
});

test("multiple folder grants route separately and removed roots are refused", async () => {
  const hub = new DeviceFiles();
  const roots = [{ id: "vault", name: "Notes" }, { id: "folder-22222222-2222-4222-8222-222222222222", name: "Projects" }];
  const { session } = hub.connect(id, "Local files", 3, roots);
  expect(hub.list()[0]!.roots.map(r => r.id)).toEqual(roots.map(r => r.id));
  const second = { ...read, rootId: roots[1]!.id, path: "config.json" };
  const pending = hub.request(second);
  const batch = await hub.poll(session, signal());
  expect(batch.requests[0]!.params.rootId).toBe(roots[1]!.id);
  hub.result(session, batch.requests[0]!.id, { content: "{}" });
  expect(await pending).toEqual({ content: "{}" });
  hub.connect(id, "Local files", 3, [roots[1]!]);
  expect(() => hub.request(read)).toThrow("Folder is not connected");
  expect(hub.list()[0]!.roots).toHaveLength(1);
  hub.stop();
});
test("multiple-folder registration requires bounded, unique grants", () => {
  const hub = new DeviceFiles();
  const root = { id: "vault", name: "Notes" };
  expect(() => hub.connect(id, "Files", 3)).toThrow();
  expect(() => hub.connect(id, "Files", 3, [])).toThrow();
  expect(() => hub.connect(id, "Files", 3, [root, root])).toThrow("Duplicate");
  expect(() => hub.connect(id, "Files", 3, Array(17).fill(root))).toThrow();
  expect(hub.list()).toEqual([]);
});

test("device filesystem advertises and delivers each primitive", async () => {
  const hub = new DeviceFiles(); const { session } = hub.connect(id, "Files", 4, [{ id: "vault", name: "Files" }]);
  const cases = [
    { action: "mkdir", path: "new/deep" },
    { action: "write", path: "new/deep/test.txt", content: "hello", expectedHash: null },
    { action: "edit", oldText: "hello", newText: "world", expectedHash: "a".repeat(64) },
    { action: "find", query: "test" }, { action: "grep", query: "hello" },
    { action: "rename", name: "renamed.txt" }, { action: "delete", recursive: true },
  ];
  for (const operation of cases) {
    expect(hub.list()[0]!.fileActions).toContain(operation.action);
    const result = hub.request({ ...read, rootId: "vault", ...operation });
    const batch = await hub.poll(session, signal());
    expect(batch.requests[0]!.params).toMatchObject(operation);
    hub.result(session, batch.requests[0]!.id, { ok: true });
    expect(await result).toEqual({ ok: true });
  }
  hub.stop();
});

test("older APKs cannot receive new filesystem primitives", () => {
  for (const version of [1, 2, 3] as const) {
    const hub = new DeviceFiles(); hub.connect(id, "Files", version, [{ id: "vault", name: "Files" }]);
    expect(hub.list()[0]!.fileActions).not.toContain("mkdir");
    expect(() => hub.request({ ...read, action: "mkdir" })).toThrow("Update");
    hub.stop();
  }
});
