import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  machineId,
  provider,
  MACHINE_SESSIONS,
  MACHINE_SESSION_CHANGED,
  SESSION_EVENTS_FEATURE,
  SESSION_PATH_FEATURE,
  SESSION_TRANSCRIPT_FEATURE,
  type SessionRecord,
} from "../../orchestration/machines/contracts.ts";
import { SharedFiles } from "./files.ts";
import { MachineSessions, wireRecord } from "./sessions.ts";
const config = z
  .object({
    id: machineId,
    name: z.string().min(1).max(100),
    url: z.string().url(),
    token: z.string().min(32),
    stateDir: z.string().min(1),
    roots: z
      .array(
        z
          .object({
            id: machineId,
            name: z.string().min(1).max(100),
            path: z.string().min(1),
            coding: z.boolean().default(false),
          })
          .strict(),
      )
      .max(32),
    providers: z
      .record(provider, z.array(z.string().min(1)).min(1).max(10))
      .default({}),
    stallMinutes: z.number().positive().max(1440).default(10),
  })
  .strict()
  .parse(
    JSON.parse(
      readFileSync(
        process.env.SUSHII_MACHINE_CONFIG ?? process.argv[2] ?? "machine.json",
        "utf8",
      ),
    ),
  );
if (new Set(config.roots.map((r) => r.id)).size !== config.roots.length)
  throw new Error("Shared folder IDs must be unique.");
const url = new URL(config.url);
if (
  url.protocol !== "wss:" &&
  !(
    url.protocol === "ws:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
)
  throw new Error("Use wss:// for a remote machine connection.");
url.pathname = "/machines";
const files = new SharedFiles(config.roots);
const sessions = new MachineSessions(files, config.stateDir, config.providers, {
  stallMs: config.stallMinutes * 60_000,
});
let socket: WebSocket | undefined;
// Set once the gateway asks for session events; an older gateway parses records strictly and sends no such request.
let events = false;
// Set once the gateway asks about session paths; an older gateway rejects the info and record keys.
let paths = false;
// Set once the gateway asks about transcripts; an older gateway rejects the record key and the start origin.
let transcript = false;
sessions.onChange = (summary) => {
  if (events && socket?.readyState === WebSocket.OPEN)
    socket.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: MACHINE_SESSION_CHANGED,
        params: summary,
      }),
    );
};
let stopping = false;
let attempt = 0;
// Bun supports handshake headers; the DOM constructor type omits this overload.
const MachineWebSocket = WebSocket as unknown as {
  new (url: string, options: import("bun").WebSocketOptions): WebSocket;
};
function connect() {
  if (stopping) return;
  const ws = new MachineWebSocket(url.href, {
    headers: {
      Authorization: `Bearer ${config.token}`,
      "X-Sushii-Machine": config.id,
    },
  });
  socket = ws;
  events = false;
  paths = false;
  transcript = false;
  const heartbeat = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ jsonrpc: "2.0", method: "machine/heartbeat" }));
  }, 15000);
  ws.onopen = () => {
    attempt = 0;
    console.log(`Machine ${config.id} connected.`);
  };
  ws.onmessage = async (event) => {
    if (typeof event.data !== "string" || event.data.length > 128000) return;
    let id: unknown;
    try {
      const message = JSON.parse(event.data);
      id = message.id;
      if (message.jsonrpc !== "2.0" || typeof id !== "number") return;
      let result: unknown;
      if (message.method === "machine/info") {
        if (
          Array.isArray(message.params?.features) &&
          message.params.features.includes(SESSION_EVENTS_FEATURE)
        )
          events = true;
        const asked: unknown[] = Array.isArray(message.params?.features)
          ? message.params.features
          : [];
        paths = asked.includes(SESSION_PATH_FEATURE);
        transcript = asked.includes(SESSION_TRANSCRIPT_FEATURE);
        const features = [
          ...(paths ? [SESSION_PATH_FEATURE] : []),
          ...(transcript ? [SESSION_TRANSCRIPT_FEATURE] : []),
        ];
        result = {
          name: config.name,
          roots: config.roots.map(({ id, name, coding }) => ({
            id,
            name,
            coding,
          })),
          providers: Object.keys(config.providers),
          ...(features.length ? { features } : {}),
        };
      } else if (message.method === MACHINE_SESSIONS) {
        events = true;
        result = sessions.summaries();
      } else if (message.method === "machine/files")
        result = await files.request(message.params);
      else if (message.method === "machine/session")
        result = wireRecord(
          (await sessions.request(message.params)) as SessionRecord,
          events,
          paths,
          transcript,
        );
      else throw new Error("Unknown machine operation.");
      if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
    } catch (err) {
      if (ws.readyState === WebSocket.OPEN && typeof id === "number")
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            error: {
              code: -32000,
              message:
                err instanceof Error
                  ? err.message.slice(0, 1000)
                  : "Machine operation failed.",
            },
          }),
        );
    }
  };
  ws.onerror = () => {};
  ws.onclose = () => {
    clearInterval(heartbeat);
    if (!stopping)
      setTimeout(
        connect,
        Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)) +
          Math.random() * 500,
      );
  };
}
function stop() {
  stopping = true;
  sessions.stop();
  socket?.close();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
connect();
