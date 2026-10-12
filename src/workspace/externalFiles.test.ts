import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  FileStores,
  type DavTransport,
} from "../orchestration/workspace/fileStores/service.ts";
import {
  startExternalFilesBridge,
  runExternalFiles,
  externalFilesSocket,
} from "./externalFiles.ts";

test("CLI uses the private bridge, preserves folder grants and materializes downloads", async () => {
  const state = mkdtempSync(join(tmpdir(), "external-cli-"));
  const db = new Database(":memory:");
  db.exec(
    "CREATE TABLE external_file_stores (id TEXT PRIMARY KEY, config TEXT NOT NULL)",
  );
  const calls: string[] = [];
  const transport: DavTransport = async (_config, method) => {
    calls.push(method);
    return {
      status: method === "PUT" ? 201 : 200,
      headers: { etag: '"v1"' },
      body: Buffer.from("%PDF-test"),
    };
  };
  const stores = new FileStores(db, transport);
  let store = stores.save({
    name: "Property",
    endpoint: "https://fileserver:5006",
    username: "private-account",
    password: "private-password",
    folders: [{ path: "/public/Property", writable: false }],
  });
  const runs: (string | undefined)[] = [];
  const bridge = await startExternalFilesBridge(state, async (args, runId) => {
    runs.push(runId);
    return stores.action(args);
  });
  const out: string[] = [],
    err: string[] = [];
  const cli = (args: string[]) =>
    runExternalFiles(args, {
      env: { WORKSPACE_STATE_DIR: state, WS_RUN_ID: "active-run" },
      out: (line) => out.push(line),
      err: (line) => err.push(line),
    });
  let download: string | undefined;
  try {
    expect(statSync(externalFilesSocket(state)).mode & 0o777).toBe(0o600);
    expect(await cli(["stores"])).toBe(0);
    expect(out[0]).toContain("Property");
    expect(out[0]).not.toContain("private-password");
    expect(out[0]).not.toContain("private-account");
    const ids = [store.id, store.folders[0]!.id];
    expect(await cli(["download", ...ids, "lease.pdf"])).toBe(0);
    const result = JSON.parse(out.at(-1)!);
    download = result.path;
    expect(readFileSync(download!, "utf8")).toBe("%PDF-test");
    expect(statSync(download!).mode & 0o777).toBe(0o600);
    expect(out.at(-1)).not.toContain("base64");
    const local = join(state, "draft.txt");
    writeFileSync(local, "new text");
    expect(
      await cli(["write", ...ids, "notes.txt", "--from", local, "--create"]),
    ).toBe(1);
    expect(err.at(-1)).toContain("Writes are disabled");
    expect(calls).toEqual(["GET"]);
    store = stores.save({
      ...store,
      folders: store.folders.map((f) => ({ ...f, writable: true })),
    });
    expect(
      await cli(["write", ...ids, "notes.txt", "--from", local, "--create"]),
    ).toBe(0);
    expect(calls).toEqual(["GET", "PUT"]);
    expect(await cli(["read", ...ids, "../outside.txt"])).toBe(1);
    expect(calls).toEqual(["GET", "PUT"]);
    expect(runs.every((run) => run === "active-run")).toBe(true);
  } finally {
    await bridge.close();
    db.close();
    if (download)
      rmSync(join(download, ".."), { recursive: true, force: true });
    rmSync(state, { recursive: true, force: true });
  }
});

test("help works offline; invalid or unsafe write arguments never reach the bridge", async () => {
  const dir = mkdtempSync(join(tmpdir(), "external-cli-args-"));
  const path = join(dir, "draft.txt");
  writeFileSync(path, "text");
  let calls = 0;
  const out: string[] = [],
    err: string[] = [];
  const cli = (args: string[]) =>
    runExternalFiles(args, {
      env: { HOME: dir },
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      call: async () => {
        calls++;
        return {};
      },
    });
  try {
    expect(await cli(["--help"])).toBe(0);
    expect(out[0]).toContain("--etag");
    for (const flags of [
      ["--from", path],
      ["--from", path, "--create", "--etag", '"v1"'],
      ["--from", path, "--create", "--force"],
    ])
      expect(
        await cli(["write", "store", "folder", "notes.txt", ...flags]),
      ).toBe(1);
    writeFileSync(path, Buffer.alloc(256 * 1024 + 1));
    expect(
      await cli([
        "write",
        "store",
        "folder",
        "notes.txt",
        "--from",
        path,
        "--create",
      ]),
    ).toBe(1);
    expect(err.at(-1)).toContain("256 KiB");
    expect(calls).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
