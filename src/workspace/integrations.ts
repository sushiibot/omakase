import { createServer, request } from "node:http";
import { chmodSync, mkdirSync, unlinkSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { resolveStateDir } from "./sessionPaths.ts";
import type { Definition, BrokerResponse } from "../integrations/broker.ts";
export const integrationSocket = (dir: string) =>
  join(dir, "integrations.sock");
type Call = (args: unknown, runId?: string) => Promise<unknown>;
async function readBody(req: AsyncIterable<Uint8Array>): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 32768) throw new Error("Request exceeds 32 KiB.");
    chunks.push(Buffer.from(c));
  }
  return Buffer.concat(chunks).toString("utf8");
}
export async function startIntegrationBridge(dir: string, call: Call) {
  mkdirSync(dir, { recursive: true });
  const socket = integrationSocket(dir);
  try {
    unlinkSync(socket);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const server = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");
    if (req.method !== "POST" || req.url !== "/integrations") {
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      const { args, runId } = JSON.parse(await readBody(req));
      if (
        runId !== undefined &&
        (typeof runId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(runId))
      )
        throw new Error("Invalid run.");
      res.end(JSON.stringify(await call(args, runId)));
    } catch {
      res.writeHead(422);
      res.end(
        JSON.stringify({
          error:
            "Integration request failed. Check the workspace connection and request.",
        }),
      );
    }
  });
  server.requestTimeout = 25000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socket, resolve);
  });
  chmodSync(socket, 0o600);
  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          try {
            unlinkSync(socket);
          } catch {}
          resolve();
        });
        server.closeAllConnections();
      }),
  };
}
export function callIntegration(
  socketPath: string,
  args: unknown,
  runId?: string,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        socketPath,
        path: "/integrations",
        method: "POST",
        agent: false,
        headers: { "content-type": "application/json" },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c) => {
          size += c.length;
          if (size > 2_097_152) res.destroy(new Error("Response too large."));
          else chunks.push(Buffer.from(c));
        });
        res.on("error", reject);
        res.on("end", () => {
          try {
            const value = JSON.parse(Buffer.concat(chunks).toString());
            if (res.statusCode !== 200 || value.error)
              reject(new Error(value.error ?? "Integration failed."));
            else resolve(value);
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.setTimeout(25000, () =>
      req.destroy(
        new Error("Integration timed out. No automatic retry was made."),
      ),
    );
    req.on("error", reject);
    req.end(JSON.stringify({ args, runId }));
  });
}

/** Loopback compatibility endpoint. This process has no provider credential.
 * Token expires when this short-lived server closes; gateway checks every call again. */
export async function startCliProxy(
  definition: Definition,
  call: Call,
  ttlMs = 600_000,
) {
  const token = randomBytes(32).toString("hex");
  let baseUrl = "";
  const server = createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(body));
    };
    if (
      req.headers.origin ||
      req.headers.host !== new URL(baseUrl).host ||
      !(
        req.headers.authorization === `Bearer ${token}` ||
        (definition.auth.type === "header" &&
          req.headers[definition.auth.name.toLowerCase()] === token)
      )
    ) {
      send(403, { error: "Proxy access denied." });
      return;
    }
    try {
      if (!req.url?.startsWith("/") || req.url.startsWith("//"))
        throw new Error("Invalid path.");
      const u = new URL(req.url, baseUrl);
      // Match the raw path too, so normalization cannot turn traversal into an approved path.
      const op = definition.operations.find(
        (o) => o.method === req.method && o.path === req.url!.split("?")[0],
      );
      if (!op || u.origin !== baseUrl || u.hash) {
        send(403, { error: "Operation is not approved." });
        return;
      }
      const query: { [key: string]: string } = {};
      for (const [k, v] of u.searchParams) {
        if (Object.hasOwn(query, k) || !op.query.includes(k))
          throw new Error("Unsupported query parameter.");
        Object.defineProperty(query, k, { value: v, enumerable: true });
      }
      const rawBody = await readBody(req);
      if (
        rawBody &&
        (!op.body ||
          !req.headers["content-type"]?.startsWith("application/json"))
      )
        throw new Error("Only approved JSON bodies are supported.");
      const result = (await call({
        action: "request",
        request: {
          integration: definition.id,
          operation: op.id,
          query,
          ...(rawBody ? { body: JSON.parse(rawBody) } : {}),
        },
      })) as BrokerResponse & { error?: string };
      if (
        result.error ||
        !Number.isInteger(result.status) ||
        result.status < 200 ||
        result.status > 599
      ) {
        send(502, { error: result.error ?? "Gateway request failed." });
        return;
      }
      send(result.status, result.body);
    } catch {
      send(400, {
        error: "Request failed. Check the approved operation and JSON input.",
      });
    }
  });
  server.requestTimeout = 25000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const close = () => {
    clearTimeout(timer);
    server.close();
    server.closeAllConnections();
  };
  const timer = setTimeout(close, ttlMs);
  timer.unref();
  return { baseUrl, token, close };
}
export const INTEGRATIONS_HELP = `usage:
  integrations list
  integrations propose '<definition JSON>'
  integrations request '<{integration,operation,query?,body?} JSON>'
  integrations exec INTEGRATION -- COMMAND [ARGS...]

Keys stay on the gateway. Propose only non-secret setup metadata from official docs.
The owner reviews and enables the integration at /connectors/keys.
exec runs a local CLI with INTEGRATION_BASE_URL and INTEGRATION_TOKEN (a temporary
proxy token, not the provider key). Configure the CLI's endpoint and Bearer or configured header auth
using these variables. The loopback proxy expires after ten minutes, permits only
approved exact method/path/query operations and JSON bodies/responses, and forwards
no CLI headers. No signing, OAuth, uploads, streaming, or non-HTTP support.
Example: integrations exec example -- sh -c 'curl -sS "$INTEGRATION_BASE_URL/v1/search?q=coffee" -H "Authorization: Bearer $INTEGRATION_TOKEN"'
Requests can incur provider charges. No automatic retries. --help works offline.`;
export async function runIntegrations(
  argv: string[],
  env = process.env,
): Promise<number> {
  if (["--help", "help", "-h"].includes(argv[0] ?? "")) {
    console.log(INTEGRATIONS_HELP);
    return 0;
  }
  const state = resolveStateDir(env);
  const socket =
    env.INTEGRATIONS_SOCKET ?? (state ? integrationSocket(state) : undefined);
  if (!socket) throw new Error("Workspace state is unavailable.");
  const call: Call = (args) => callIntegration(socket, args, env.WS_RUN_ID);
  if (argv[0] === "list" && argv.length === 1) {
    console.log(JSON.stringify(await call({ action: "list" })));
    return 0;
  }
  if (["propose", "request"].includes(argv[0] ?? "") && argv.length === 2) {
    console.log(
      JSON.stringify(
        await call({
          action: argv[0],
          [argv[0] === "propose" ? "definition" : "request"]: JSON.parse(
            argv[1]!,
          ),
        }),
      ),
    );
    return 0;
  }
  if (argv[0] !== "exec" || argv[2] !== "--" || !argv[3])
    throw new Error(INTEGRATIONS_HELP);
  const list = (await call({ action: "list" })) as {
    integrations: (Definition & {
      configured: boolean;
      execution?: string[];
    })[];
  };
  const d = list.integrations.find((i) => i.id === argv[1]);
  if (!d?.configured || !d.execution?.includes("cli_proxy"))
    throw new Error(
      "Integration needs setup or a dedicated CLI adapter. Check integrations list.",
    );
  const proxy = await startCliProxy(d, call);
  try {
    const child = spawn(argv[3], argv.slice(4), {
      stdio: "inherit",
      env: {
        ...env,
        INTEGRATION_BASE_URL: proxy.baseUrl,
        INTEGRATION_TOKEN: proxy.token,
      },
    });
    const forward = () => {
      child.kill("SIGTERM");
    };
    process.on("SIGTERM", forward);
    process.on("SIGINT", forward);
    const timeout = setTimeout(forward, 600_000);
    timeout.unref();
    try {
      return await new Promise<number>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code) => resolve(code ?? 1));
      });
    } finally {
      clearTimeout(timeout);
      (process as import("node:events").EventEmitter).removeListener(
        "SIGTERM",
        forward,
      );
      (process as import("node:events").EventEmitter).removeListener(
        "SIGINT",
        forward,
      );
    }
  } finally {
    proxy.close();
  }
}
