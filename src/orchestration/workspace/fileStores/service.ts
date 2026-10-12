import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { Agent, request } from "node:https";
import { connect } from "node:tls";
import { isIP } from "node:net";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import type { ToolManifestEntry } from "../../contracts.ts";

export const storeInput = z
  .object({
    id: z.string().uuid().optional(),
    revision: z.number().int().positive().optional(),
    name: z.string().trim().min(1).max(100),
    endpoint: z.string().max(2048),
    folders: z
      .array(
        z
          .object({
            id: z.string().uuid().optional(),
            path: z.string().max(1000),
            writable: z.boolean().default(false),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    username: z.string().min(1).max(200),
    password: z.string().max(2000).optional(),
    certificateSha256: z
      .string()
      .regex(/^([a-fA-F0-9]{64})?$/)
      .default(""),
    enabled: z.boolean().default(true),
  })
  .strict();
export type StoreFolder = { id: string; path: string; writable: boolean };
export type StoreConfig = Omit<z.infer<typeof storeInput>, "folders"> & {
  id: string;
  revision: number;
  password: string;
  folders: StoreFolder[];
};
export type StoreView = Omit<StoreConfig, "password">;
export class FileStoreError extends Error {
  constructor(
    message: string,
    readonly status = 422,
    readonly field?: string,
  ) {
    super(message);
  }
}
/** Only expose known diagnostic codes, never raw errors containing credentials or request headers. */
export function connectionError(
  error: unknown,
  method: string,
): FileStoreError {
  if (error instanceof FileStoreError) return error;
  let cause = error;
  let code = "";
  for (let i = 0; i < 4 && cause && typeof cause === "object"; i++) {
    const item = cause as { code?: unknown; cause?: unknown };
    if (typeof item.code === "string" && /^[A-Z0-9_]+$/.test(item.code))
      code = item.code;
    cause = item.cause;
  }
  const reasons: Record<string, string> = {
    ENOTFOUND:
      "Server name could not be resolved. Check the address or use the NAS Tailscale IP.",
    EAI_AGAIN:
      "Server name lookup temporarily failed. Try again or use the NAS Tailscale IP.",
    ECONNREFUSED:
      "The server refused the connection. Check that HTTPS WebDAV is enabled on this port.",
    ETIMEDOUT:
      "The connection timed out. Check Tailscale access rules and the NAS firewall.",
    EHOSTUNREACH:
      "The server is unreachable. Check that the NAS is online in Tailscale.",
    ENETUNREACH:
      "No network route to the server. Check the server’s Tailscale connection.",
    ECONNRESET:
      "The server closed the connection. Check the HTTPS port and WebDAV service.",
    DEPTH_ZERO_SELF_SIGNED_CERT:
      "The NAS certificate is self-signed. Enter its verified SHA-256 fingerprint under Private certificate, or use a trusted certificate.",
    SELF_SIGNED_CERT_IN_CHAIN:
      "The NAS certificate chain is self-signed. Enter its verified SHA-256 fingerprint under Private certificate, or use a trusted certificate.",
    UNABLE_TO_VERIFY_LEAF_SIGNATURE:
      "The NAS certificate chain could not be verified. Check its intermediate certificates or enter its verified SHA-256 fingerprint.",
    UNABLE_TO_GET_ISSUER_CERT_LOCALLY:
      "The NAS certificate issuer is not trusted. Use a trusted certificate or enter its verified SHA-256 fingerprint.",
    CERT_HAS_EXPIRED: "The NAS certificate has expired. Renew it in DSM.",
    CERT_NOT_YET_VALID:
      "The NAS certificate is not valid yet. Check the server clock and certificate dates.",
    ERR_TLS_CERT_ALTNAME_INVALID:
      "The NAS certificate does not match the server address. Use its certificate hostname or enter its verified SHA-256 fingerprint.",
    ERR_SSL_WRONG_VERSION_NUMBER:
      "This port did not provide HTTPS. Use the HTTPS WebDAV port, normally 5006.",
  };
  const reason = reasons[code];
  const caution =
    method === "PUT"
      ? " Inspect the remote file before retrying the write."
      : "";
  return new FileStoreError(
    (reason
      ? `${reason} (${code})`
      : "Connection failed. Check the HTTPS address, certificate, Tailscale access rules and NAS firewall.") +
      caution,
    code === "ETIMEDOUT" ? 504 : 502,
  );
}
const MAX_BYTES = 2 * 1024 * 1024;
const TEXT_BYTES = 256 * 1024;
function normalizedPath(path: string, absolute = false): string {
  if (
    /[\x00-\x1f\x7f\\%]/.test(path) ||
    path.split("/").some((p) => p === "." || p === "..")
  )
    throw new FileStoreError(
      "Use a path inside the configured folder without parent segments or encoded separators.",
    );
  const clean = path.replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/");
  return absolute ? "/" + clean : clean;
}
const publicView = ({ password: _password, ...view }: StoreConfig): StoreView =>
  view;
export type DavResponse = {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
};
export type DavTransport = (
  config: StoreConfig,
  method: string,
  path: string,
  headers?: Record<string, string>,
  body?: string,
) => Promise<DavResponse>;

/** Pin verification completes before the agent hands the socket to HTTP. No redirects or write retries. */
export const davRequest: DavTransport = async (
  config,
  method,
  path,
  headers = {},
  body,
) => {
  const endpoint = new URL(config.endpoint);
  const agent = new Agent({ keepAlive: false });
  if (config.certificateSha256) {
    agent.createConnection = (_options, callback) => {
      const socket = connect({
        host: endpoint.hostname.replace(/^\[|\]$/g, ""),
        port: Number(endpoint.port || 443),
        servername: isIP(endpoint.hostname.replace(/^\[|\]$/g, ""))
          ? undefined
          : endpoint.hostname,
        rejectUnauthorized: false,
      });
      let complete = false;
      const finish = (error: Error | null) => {
        if (complete) return;
        complete = true;
        socket.setTimeout(0);
        if (error) socket.destroy();
        callback?.(error, socket);
      };
      socket.setTimeout(10_000, () =>
        finish(new FileStoreError("NAS TLS connection timed out.", 504)),
      );
      socket.once("error", (error: Error) =>
        finish(connectionError(error, method)),
      );
      socket.once("secureConnect", () => {
        const raw = socket.getPeerCertificate().raw;
        const fingerprint =
          raw && createHash("sha256").update(raw).digest("hex");
        finish(
          fingerprint === config.certificateSha256.toLowerCase()
            ? null
            : new FileStoreError(
                "The NAS certificate changed or does not match the verified fingerprint.",
                502,
              ),
        );
      });
      return undefined;
    };
  }
  try {
    return await new Promise<DavResponse>((resolve, reject) => {
      const req = request(
        new URL(path.split("/").map(encodeURIComponent).join("/"), endpoint),
        {
          method,
          agent,
          headers: {
            Authorization:
              "Basic " +
              Buffer.from(config.username + ":" + config.password).toString(
                "base64",
              ),
            "Cache-Control": "no-cache",
            ...headers,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BYTES) {
              res.destroy();
              reject(
                new FileStoreError(
                  "The file or folder response exceeds the 2 MiB limit.",
                ),
              );
            } else chunks.push(chunk);
          });
          res.on("error", () =>
            reject(
              new FileStoreError(
                method === "PUT"
                  ? "NAS response interrupted. Inspect the remote file before retrying the write."
                  : "NAS response interrupted. Try the connection test again.",
                502,
              ),
            ),
          );
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 502,
              headers: Object.fromEntries(
                Object.entries(res.headers).map(([k, v]) => [
                  k,
                  Array.isArray(v) ? v.join(", ") : (v ?? ""),
                ]),
              ),
              body: Buffer.concat(chunks),
            }),
          );
        },
      );
      const timer = setTimeout(
        () =>
          req.destroy(
            new FileStoreError(
              method === "PUT"
                ? "NAS request timed out after 15 seconds. Inspect the remote file before retrying the write."
                : "NAS request timed out after 15 seconds. Check Tailscale access rules and the NAS firewall.",
              504,
            ),
          ),
        15_000,
      );
      req.once("close", () => clearTimeout(timer));
      req.on("error", (error) => reject(connectionError(error, method)));
      req.end(body);
    });
  } finally {
    agent.destroy();
  }
};

function status(response: DavResponse, expected: number[]) {
  if (expected.includes(response.status)) return;
  if (response.status === 412)
    throw new FileStoreError(
      "The file changed or already exists. Read the current version before deciding how to proceed.",
      409,
    );
  if (response.status === 401)
    throw new FileStoreError(
      "The NAS rejected the login (HTTP 401). Check the account and password.",
      422,
    );
  if (response.status === 403)
    throw new FileStoreError(
      "The NAS denied access (HTTP 403). Check folder permissions and the account’s WebDAV application permission.",
      422,
    );
  if (response.status === 404)
    throw new FileStoreError(
      "The remote file or folder was not found (HTTP 404). Check the allowed folder path.",
      404,
    );
  throw new FileStoreError(`The NAS returned HTTP ${response.status}.`, 502);
}
const xml = new XMLParser({
  removeNSPrefix: true,
  processEntities: true,
  isArray: (name) => name === "response" || name === "propstat",
});

export class FileStores {
  constructor(
    private db: Database,
    private transport: DavTransport = davRequest,
  ) {}
  list(): StoreView[] {
    return this.db
      .query<{ config: string }, []>(
        "SELECT config FROM external_file_stores ORDER BY rowid",
      )
      .all()
      .map((row) => publicView(JSON.parse(row.config)));
  }
  private get(id: string): StoreConfig {
    const row = this.db
      .query<{ config: string }, [string]>(
        "SELECT config FROM external_file_stores WHERE id=?",
      )
      .get(id);
    if (!row) throw new FileStoreError("File store not found.", 404);
    return JSON.parse(row.config);
  }
  save(raw: unknown): StoreView {
    const input = storeInput.parse(raw);
    const prior = input.id ? this.get(input.id) : undefined;
    if (prior && input.revision !== prior.revision)
      throw new FileStoreError(
        "The connection changed. Reload before saving.",
        409,
      );
    let endpoint: URL;
    try {
      endpoint = new URL(input.endpoint);
    } catch {
      throw new FileStoreError(
        "Enter a valid HTTPS server address.",
        422,
        "endpoint",
      );
    }
    if (
      endpoint.protocol !== "https:" ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      endpoint.pathname !== "/"
    )
      throw new FileStoreError(
        "Use an HTTPS server address with no login, folder or query in the address.",
        422,
        "endpoint",
      );
    const folders = input.folders.map((folder) => {
      const path = normalizedPath(folder.path, true);
      if (path === "/")
        throw new FileStoreError(
          "Choose specific allowed folders, rather than the server root.",
          422,
          "folders",
        );
      return { ...folder, id: folder.id ?? crypto.randomUUID(), path };
    });
    if (
      new Set(folders.map((f) => f.path)).size !== folders.length ||
      new Set(folders.map((f) => f.id)).size !== folders.length
    )
      throw new FileStoreError(
        "Each allowed folder must have a unique path and identifier.",
        422,
        "folders",
      );
    const password = input.password || prior?.password;
    if (!password)
      throw new FileStoreError(
        "Enter the NAS account password.",
        422,
        "password",
      );
    if (input.username.includes(":"))
      throw new FileStoreError(
        "The account name cannot contain a colon.",
        422,
        "username",
      );
    const config: StoreConfig = {
      ...input,
      endpoint: endpoint.origin,
      folders,
      password,
      id: prior?.id ?? crypto.randomUUID(),
      revision: (prior?.revision ?? 0) + 1,
    };
    this.db
      .query(
        "INSERT INTO external_file_stores(id,config) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET config=excluded.config",
      )
      .run(config.id, JSON.stringify(config));
    return publicView(config);
  }
  remove(id: string, revision: number) {
    if (this.get(id).revision !== revision)
      throw new FileStoreError(
        "The connection changed. Reload before removing it.",
        409,
      );
    this.db.query("DELETE FROM external_file_stores WHERE id=?").run(id);
    return { removed: true };
  }
  private active(id: string) {
    const config = this.get(id);
    if (!config.enabled)
      throw new FileStoreError("This file store is disabled.");
    return config;
  }
  private path(folder: StoreFolder, relative: string) {
    const suffix = normalizedPath(relative);
    return folder.path + (suffix ? "/" + suffix : "");
  }
  async check(id: string) {
    const config = this.get(id);
    const folders = await Promise.all(
      config.folders.map(async (folder) => {
        try {
          const entries = await this.folder(config, folder, "");
          return {
            id: folder.id,
            path: folder.path,
            ok: true,
            entries: entries.length,
            message: "Folder is reachable.",
          };
        } catch (error) {
          return {
            id: folder.id,
            path: folder.path,
            ok: false,
            message:
              error instanceof FileStoreError
                ? error.message
                : "Folder check failed.",
          };
        }
      }),
    );
    return {
      ok: folders.every((f) => f.ok),
      folders,
      message: folders.every((f) => f.ok)
        ? "All allowed folders are reachable. No files were changed."
        : "Some folders could not be reached. Check their access results.",
    };
  }
  private async folder(
    config: StoreConfig,
    folder: StoreFolder,
    relative: string,
  ) {
    const path = this.path(folder, relative);
    const res = await this.transport(
      config,
      "PROPFIND",
      path + "/",
      { Depth: "1", "Content-Type": "application/xml" },
      '<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getetag/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>',
    );
    status(res, [207]);
    const text = res.body.toString("utf8");
    if (/<!DOCTYPE|<!ENTITY/i.test(text))
      throw new FileStoreError(
        "The NAS returned unsupported XML declarations.",
        502,
      );
    let responses: any[];
    try {
      responses = xml.parse(text)?.multistatus?.response;
      if (!Array.isArray(responses)) throw new Error();
    } catch {
      throw new FileStoreError(
        "The NAS returned an invalid folder listing.",
        502,
      );
    }
    const entries = [];
    for (const item of responses) {
      try {
        if (typeof item.href !== "string") continue;
        const href = new URL(item.href, config.endpoint);
        if (href.origin !== config.endpoint) continue;
        const full = normalizedPath(decodeURIComponent(href.pathname), true);
        if (!full.startsWith(path + "/")) continue;
        const name = full.slice(path.length + 1);
        if (!name || name.includes("/")) continue;
        const prop = item.propstat?.find((p: any) =>
          /\s200\s/.test(p.status),
        )?.prop;
        if (!prop) continue;
        const bytes = Number(prop.getcontentlength);
        entries.push({
          name,
          path: full.slice(folder.path.length + 1),
          directory: prop.resourcetype?.collection !== undefined,
          bytes: Number.isFinite(bytes) ? bytes : undefined,
          etag: typeof prop.getetag === "string" ? prop.getetag : undefined,
          modified: prop.getlastmodified,
        });
      } catch {
        /* Ignore out-of-root or invalid server hrefs. */
      }
    }
    if (entries.length > 1000)
      throw new FileStoreError(
        "This folder has more than 1,000 entries. Choose a smaller folder.",
      );
    return entries;
  }
  async action(raw: unknown) {
    const p = z
      .object({
        action: z.enum(["list_stores", "list", "read", "download", "write"]),
        storeId: z.string().uuid().optional(),
        folderId: z.string().uuid().optional(),
        path: z.string().max(1000).optional(),
        content: z.string().max(TEXT_BYTES).optional(),
        expectedEtag: z.string().max(300).optional(),
        create: z.boolean().optional(),
      })
      .strict()
      .parse(raw);
    if (p.action === "list_stores")
      return {
        stores: this.list()
          .filter((s) => s.enabled)
          .map(({ id, name, folders }) => ({ id, name, folders })),
      };
    if (!p.storeId) throw new FileStoreError("Choose a file store.");
    const config = this.active(p.storeId);
    const folder = p.folderId
      ? config.folders.find((f) => f.id === p.folderId)
      : config.folders.length === 1
        ? config.folders[0]
        : undefined;
    if (!folder)
      throw new FileStoreError(
        "Choose an allowed folder using its folderId from list_stores.",
      );
    const relative = p.path ?? "";
    const path = this.path(folder, relative);
    if (p.action === "list")
      return { entries: await this.folder(config, folder, relative) };
    if (!normalizedPath(relative))
      throw new FileStoreError("Choose a file inside the allowed folder.");
    if (p.action === "download") {
      const res = await this.transport(config, "GET", path);
      status(res, [200]);
      return {
        externalDownload: true,
        base64: res.body.toString("base64"),
        bytes: res.body.length,
        filename: relative.split("/").at(-1),
        etag: res.headers.etag || null,
      };
    }
    if (p.action === "read") {
      const res = await this.transport(config, "GET", path);
      status(res, [200]);
      if (res.body.length > TEXT_BYTES)
        throw new FileStoreError("Text reads are limited to 256 KiB.");
      let content: string;
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(res.body);
        if (
          content.includes("\0") ||
          /^%PDF-/.test(content) ||
          content.startsWith("PK\x03\x04")
        )
          throw new Error();
      } catch {
        throw new FileStoreError(
          "This is a binary document. Text tools currently support UTF-8 files; Use download and the workspace document tools to inspect PDF and Office files.",
        );
      }
      const etag = res.headers.etag;
      return {
        content,
        etag: etag || null,
        canReplace: folder.writable && !!etag && !etag.startsWith("W/"),
        modified: res.headers["last-modified"] || null,
      };
    }
    if (!folder.writable)
      throw new FileStoreError("Writes are disabled for this folder.");
    if (p.content === undefined || Buffer.byteLength(p.content) > TEXT_BYTES)
      throw new FileStoreError("Provide at most 256 KiB of UTF-8 text.");
    if (p.create && p.expectedEtag)
      throw new FileStoreError(
        "Choose either create or replace with an expected version.",
      );
    if (!p.create && (!p.expectedEtag || !/^"[^"\r\n]+"$/.test(p.expectedEtag)))
      throw new FileStoreError(
        "Replacement requires the strong ETag from a fresh read. If it is weak, read again after a short delay.",
      );
    const res = await this.transport(
      config,
      "PUT",
      path,
      {
        "Content-Type": "text/plain; charset=utf-8",
        ...(p.create
          ? { "If-None-Match": "*" }
          : { "If-Match": p.expectedEtag! }),
      },
      p.content,
    );
    status(res, p.create ? [201] : [200, 204]);
    return {
      written: true,
      message:
        "The NAS acknowledged the write. Read the file again to verify its contents and obtain its current version.",
    };
  }
}
export const fileStoreManifest: ToolManifestEntry = {
  name: "external_files",
  approval: "none",
  description:
    "Access owner-configured external file stores directly, without a daemon, local index or file cache. list_stores discovers enabled stores. list lists one folder; read returns UTF-8 text and its ETag. Choose a folderId from list_stores. Paths are relative to that allowed folder, and write permission is specific to the selected folder. write requires write permission and either create:true (fails if file exists) or expectedEtag from a fresh read (fails on a conflict). Never retry a timed-out write blindly. Weak ETags cannot authorize replacement: read again after a short delay. download fetches a document into a private temporary workspace file; use existing document tools such as pdftotext on that file. It does not create a synchronized copy or local index. Downloads are capped at 2 MiB; text reads and writes at 256 KiB. Store configuration and credentials are owner-managed; this tool cannot change them.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["list_stores", "list", "read", "download", "write"],
      },
      storeId: { type: "string" },
      folderId: { type: "string" },
      path: { type: "string" },
      content: { type: "string" },
      expectedEtag: { type: "string" },
      create: { type: "boolean" },
    },
    required: ["action"],
    additionalProperties: false,
  },
};
