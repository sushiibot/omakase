import { createServer, request } from "node:http";
import { chmodSync, mkdirSync, unlinkSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveStateDir } from "./sessionPaths.ts";

export const externalFilesSocket = (stateDir: string) =>
  join(stateDir, "external-files.sock");
type Args = Record<string, unknown>;
const HELP = `usage:
  external-files stores
  external-files list <storeId> <folderId> [relative-path]
  external-files read <storeId> <folderId> <relative-path>
  external-files download <storeId> <folderId> <relative-path>
  external-files write <storeId> <folderId> <relative-path> --from <local-file> --create
  external-files write <storeId> <folderId> <relative-path> --from <local-file> --etag '<etag>'

Commands print JSON. Discover storeId and folderId with stores. Paths are relative
to the allowed folder. Read returns content, etag and canReplace. Downloads return
a private temporary file path; remove it when finished. Writes are UTF-8 text,
limited to 256 KiB, and require a writable folder. --create refuses an existing
file; --etag requires the strong ETag from a fresh read. No automatic write retries.
Connection configuration belongs in Workspace > File stores, not this command.`;

export async function materializeExternalDownload(value: unknown) {
  const d = value as {
    externalDownload?: boolean;
    base64?: string;
    filename?: string;
    bytes?: number;
    etag?: string;
  };
  if (
    !d ||
    d.externalDownload !== true ||
    typeof d.base64 !== "string" ||
    d.base64.length > 3_000_000 ||
    typeof d.filename !== "string"
  )
    throw new Error("Invalid external document response.");
  const bytes = Buffer.from(d.base64, "base64");
  if (bytes.length !== d.bytes || bytes.length > 2 * 1024 * 1024)
    throw new Error("Invalid external document size.");
  const folder = await mkdtemp(join(tmpdir(), "sushii-external-"));
  const filename = d.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
  const path = join(
    folder,
    filename && filename !== "." && filename !== ".." ? filename : "document",
  );
  await writeFile(path, bytes, { mode: 0o600 });
  return { path, bytes: bytes.length, etag: d.etag, temporary: true };
}

/** Private, fixed-purpose bridge. The shell cannot choose an RPC method or principal. */
export async function startExternalFilesBridge(
  stateDir: string,
  call: (args: Args, runId?: string) => Promise<unknown>,
) {
  mkdirSync(stateDir, { recursive: true });
  const socketPath = externalFilesSocket(stateDir);
  // The workspace owns this path; stale sockets remain after a killed process.
  try {
    unlinkSync(socketPath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const server = createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(body));
    };
    if (req.method !== "POST" || req.url !== "/external-files") {
      send(404, { error: "Not found." });
      return;
    }
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += Buffer.byteLength(chunk);
        if (size > 2 * 1024 * 1024) {
          send(413, { error: "External file request is too large." });
          return;
        }
        chunks.push(Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (
        !body ||
        typeof body !== "object" ||
        !body.args ||
        typeof body.args !== "object" ||
        Array.isArray(body.args) ||
        (body.runId !== undefined &&
          (typeof body.runId !== "string" || body.runId.length > 100))
      ) {
        send(400, { error: "Invalid external file request." });
        return;
      }
      const result = await call(body.args, body.runId);
      send(
        200,
        body.args.action === "download"
          ? await materializeExternalDownload(result)
          : result,
      );
    } catch (error) {
      send(422, {
        error:
          error instanceof Error
            ? error.message
            : "External file request failed.",
      });
    }
  });
  server.requestTimeout = 30_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  chmodSync(socketPath, 0o600);
  return {
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      try {
        unlinkSync(socketPath);
      } catch {}
    },
  };
}

export function callExternalFiles(
  socketPath: string,
  args: Args,
  runId?: string,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        socketPath,
        path: "/external-files",
        method: "POST",
        headers: { "content-type": "application/json" },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > 4 * 1024 * 1024)
            res.destroy(new Error("External file response is too large."));
          else chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (res.statusCode !== 200)
              reject(new Error(body.error ?? "External file request failed."));
            else resolve(body);
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.setTimeout(160_000, () =>
      req.destroy(
        new Error(
          "External file request timed out. Inspect a write before retrying.",
        ),
      ),
    );
    req.on("error", (error) => {
      const code = (error as NodeJS.ErrnoException).code;
      reject(
        code === "ENOENT" || code === "ECONNREFUSED"
          ? new Error(
              "The workspace file service is unavailable. Check that the workspace is running.",
            )
          : error,
      );
    });
    req.end(JSON.stringify({ args, ...(runId ? { runId } : {}) }));
  });
}

export async function runExternalFiles(
  argv: string[],
  io: {
    env: NodeJS.ProcessEnv;
    out: (line: string) => void;
    err: (line: string) => void;
    call?: typeof callExternalFiles;
  },
): Promise<number> {
  if (argv.length === 1 && ["--help", "help", "-h"].includes(argv[0]!)) {
    io.out(HELP);
    return 0;
  }
  try {
    const [cmd, storeId, folderId, path] = argv;
    let args: Args;
    if (cmd === "stores" && argv.length === 1) args = { action: "list_stores" };
    else if (
      cmd &&
      ["list", "read", "download"].includes(cmd) &&
      storeId &&
      folderId &&
      (cmd === "list"
        ? argv.length === 3 || argv.length === 4
        : argv.length === 4)
    )
      args = { action: cmd, storeId, folderId, path: path ?? "" };
    else if (cmd === "write" && storeId && folderId && path) {
      const flags = argv.slice(4);
      let from: string | undefined,
        etag: string | undefined,
        create = false;
      for (let i = 0; i < flags.length; i++) {
        const flag = flags[i];
        if (flag === "--from" && !from && flags[i + 1]) from = flags[++i];
        else if (flag === "--etag" && !etag && flags[i + 1]) etag = flags[++i];
        else if (flag === "--create" && !create) create = true;
        else throw new Error(HELP);
      }
      if (!from || create === !!etag) throw new Error(HELP);
      const file = Bun.file(from);
      if (file.size > 256 * 1024)
        throw new Error("Writes are limited to 256 KiB of UTF-8 text.");
      const bytes = await file.arrayBuffer();
      if (bytes.byteLength > 256 * 1024)
        throw new Error("Writes are limited to 256 KiB of UTF-8 text.");
      const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      args = {
        action: "write",
        storeId,
        folderId,
        path,
        content,
        ...(create ? { create: true } : { expectedEtag: etag }),
      };
    } else {
      io.err(HELP);
      return 2;
    }
    const stateDir = resolveStateDir(io.env);
    if (!stateDir && !io.env.EXTERNAL_FILES_SOCKET)
      throw new Error("HOME is not set.");
    const result = await (io.call ?? callExternalFiles)(
      io.env.EXTERNAL_FILES_SOCKET ?? externalFilesSocket(stateDir!),
      args,
      io.env.WS_RUN_ID,
    );
    io.out(JSON.stringify(result));
    return 0;
  } catch (error) {
    io.err(
      error instanceof Error ? error.message : "External file request failed.",
    );
    return 1;
  }
}
