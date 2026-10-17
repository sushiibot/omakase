import { createServer, request } from "node:http";
import { chmodSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { mapsRequest, type MapsRequest } from "../orchestration/mapsContracts.ts";
import { resolveStateDir } from "./sessionPaths.ts";

export const mapsSocket = (stateDir: string) => join(stateDir, "maps.sock");
export const MAPS_HELP = `usage:
  maps search "query and city/area" [--limit 1..20] [--near LAT,LNG] [--radius METERS]
              [--open-now] [--min-rating 0..5] [--type restaurant] [--price moderate]
              [--page-token TOKEN]
  maps place PLACE_ID [--reviews]
  maps directions "origin" "destination" [--mode walk|transit|drive|bicycle]
                  [--departure 2026-10-20T18:00:00+02:00]

Outputs JSON from Google Maps through the gateway. No key is needed in the shell.
Search defaults to 5 results; --near/--radius bias results, not a strict boundary.
Put the area in the query or use --near; do not rely on the gateway's IP location.
Price: free, inexpensive, moderate, expensive, very_expensive.
Ratings round up to Google's next half-star. Repeat the same query and filters for pagination.
Place takes an ID from search. Reviews are optional (up to five, relevance-sorted).
Directions accept addresses or place:PLACE_ID. Transit requires --departure with
an explicit timezone offset or Z. Departure is supported only for transit/drive.
API billing applies. No automatic pagination or retries. --help works offline.`;

export function parseMapsArgs(argv: string[]): MapsRequest {
  const [action, ...rest] = argv;
  const n = action === "directions" ? 2 : 1;
  if (!["search", "place", "directions"].includes(action ?? "") || rest.length < n) throw new Error(MAPS_HELP);
  const raw: Record<string, unknown> = action === "search" ? { action, query: rest[0] }
    : action === "place" ? { action, id: rest[0] } : { action, origin: rest[0], destination: rest[1] };
  const flags: Record<string, string> = action === "search"
    ? { "--limit": "limit", "--near": "near", "--radius": "radius", "--open-now": "openNow", "--min-rating": "minRating", "--type": "type", "--price": "price", "--page-token": "pageToken" }
    : action === "place" ? { "--reviews": "reviews" } : { "--mode": "mode", "--departure": "departure" };
  for (let i = n; i < rest.length; i++) {
    const flag = rest[i]!;
    const key = flags[flag];
    if (!key || key in raw) throw new Error(`Unknown or repeated option: ${flag}\n${MAPS_HELP}`);
    if (key === "openNow" || key === "reviews") { raw[key] = true; continue; }
    const value = rest[++i];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    if (key === "near") {
      const parts = value.split(",");
      if (parts.length !== 2 || parts.some(p => !p.trim())) throw new Error("--near requires LAT,LNG");
      raw[key] = { latitude: Number(parts[0]), longitude: Number(parts[1]) };
    } else raw[key] = ["limit", "radius", "minRating"].includes(key) ? Number(value) : value;
  }
  const parsed = mapsRequest.safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid maps arguments: ${parsed.error.issues[0]?.message}`);
  return parsed.data;
}

/** Only the local workspace user can call this fixed-purpose bridge. No arbitrary RPC/URL forwarding. */
export async function startMapsBridge(stateDir: string, call: (args: MapsRequest, runId?: string) => Promise<unknown>) {
  mkdirSync(stateDir, { recursive: true });
  const socket = mapsSocket(stateDir);
  try { unlinkSync(socket); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  const server = createServer(async (req, res) => {
    const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
    if (req.method !== "POST" || req.url !== "/maps") { send(404, { error: "Not found." }); return; }
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += Buffer.byteLength(chunk);
        if (size > 16_384) { send(413, { error: "Maps request is too large." }); return; }
        chunks.push(Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const parsed = mapsRequest.safeParse(body?.args);
      if (!parsed.success || (body.runId !== undefined && (typeof body.runId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(body.runId)))) {
        send(400, { error: "Invalid maps request." }); return;
      }
      send(200, await call(parsed.data, body.runId));
    } catch (e) { send(422, { error: e instanceof Error ? e.message : "Maps request failed." }); }
  });
  server.requestTimeout = 30_000;
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(socket, () => { server.removeListener("error", reject); resolve(); }); });
  chmodSync(socket, 0o600);
  return { close: async () => { await new Promise<void>(resolve => server.close(() => resolve())); try { unlinkSync(socket); } catch {} } };
}

export function callMaps(socketPath: string, args: MapsRequest, runId?: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, path: "/maps", method: "POST", agent: false, headers: { "content-type": "application/json" } }, res => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", chunk => { size += chunk.length; if (size > 1_048_576) res.destroy(new Error("Maps response is too large.")); else chunks.push(chunk); });
      res.on("error", reject);
      res.on("end", () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (res.statusCode !== 200) reject(new Error(body.error ?? "Maps request failed.")); else resolve(body);
        } catch (e) { reject(e); }
      });
    });
    req.setTimeout(30_000, () => req.destroy(new Error("Maps request timed out.")));
    req.on("error", e => reject(["ENOENT", "ECONNREFUSED", "EPIPE", "ECONNRESET"].includes((e as NodeJS.ErrnoException).code ?? "") ? new Error("Maps service is unavailable. Check that the workspace is running.") : e));
    req.end(JSON.stringify({ args, ...(runId ? { runId } : {}) }));
  });
}

export async function runMaps(argv: string[], io: { env: NodeJS.ProcessEnv; out: (s: string) => void; err: (s: string) => void; call?: typeof callMaps }): Promise<number> {
  if (argv.length === 1 && ["help", "--help", "-h"].includes(argv[0]!)) { io.out(MAPS_HELP); return 0; }
  let args: MapsRequest;
  try { args = parseMapsArgs(argv); } catch (e) { io.err((e as Error).message); return 2; }
  try {
    const state = resolveStateDir(io.env);
    if (!state && !io.env.MAPS_SOCKET) throw new Error("HOME is not set.");
    io.out(JSON.stringify(await (io.call ?? callMaps)(io.env.MAPS_SOCKET ?? mapsSocket(state!), args, io.env.WS_RUN_ID)));
    return 0;
  } catch (e) { io.err(e instanceof Error ? e.message : "Maps request failed."); return 1; }
}
