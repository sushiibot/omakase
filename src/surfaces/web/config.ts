import { z } from "zod";
import { dirname, join } from "node:path";
import { isLoopback, parseIp } from "./peers.ts";

/** Settings only the personal gateway reads: the web chat's uploads and the workspace transport. */
export interface PersonalConfig {
  /** WEB_UPLOADS_DIR: web chat photos and agent files. Default: web-uploads next to the database. */
  webUploadsDir: string;
  /** Port the workspace transport listens on (ORCH_PORT). Default 8788. */
  orchPort: number;
  /** Secret the workspace presents on `runner/register` (ORCH_SECRET). Unset → every registration is refused. */
  orchSecret: string | undefined;
  /** Route the owner's web chat to the personal-agent workspace when it is connected (DM_WORKSPACE_ENABLED). Default off. */
  dmWorkspaceEnabled: boolean;
}

function optionalPort(env: Record<string, string | undefined>, name: string, defaultValue: number): number {
  const raw = env[name];
  if (!raw) return defaultValue;
  const port = parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port in env var ${name}: ${raw}`);
  }
  return port;
}

export function parsePersonalConfig(env: Record<string, string | undefined>): PersonalConfig {
  const databasePath = env["DATABASE_PATH"] ?? "./data/sushii-agent.db";
  return {
    webUploadsDir: env["WEB_UPLOADS_DIR"] ?? join(dirname(databasePath), "web-uploads"),
    orchPort: optionalPort(env, "ORCH_PORT", 8788),
    orchSecret: env["ORCH_SECRET"]?.trim() || undefined,
    dmWorkspaceEnabled: ["1", "true", "yes"].includes((env["DM_WORKSPACE_ENABLED"] ?? "false").toLowerCase()),
  };
}

export const personalConfig: PersonalConfig = parsePersonalConfig(process.env);

export interface WebPushConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export interface WebConfig {
  port: number;
  /** The only address the server listens on: the gateway's fixed IP on its dedicated web network. */
  bindAddr: string;
  ownerLogin: string;
  distDir: string;
  /** Local-dev stand-in for the Serve identity header; only set when bound to loopback outside production. */
  devLogin: string | undefined;
  /** Exact peer IPs allowed to carry the identity header (the Serve host's side of the web network). */
  trustedPeers: string[];
  /** Undefined when the VAPID keys are absent or incomplete: push endpoints are off. */
  push: WebPushConfig | undefined;
  /** Why push is off although some VAPID env was set. */
  pushDisabledReason?: string;
}

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().trim().optional());

const webEnvSchema = z.object({
  WEB_OWNER_LOGIN: optionalString,
  WEB_BIND_ADDR: z.preprocess(emptyToUndefined, z.string().trim().refine((v) => parseIp(v) !== null, "must be an IP address").default("127.0.0.1")),
  WEB_PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(65535).default(8790)),
  WEB_DIST_DIR: z.preprocess(emptyToUndefined, z.string().default("/app/web/build")),
  WEB_DEV_LOGIN: optionalString,
  WEB_TRUSTED_PEERS: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .default("127.0.0.1")
      .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean))
      .refine((ips) => ips.length > 0 && ips.every((ip) => parseIp(ip) !== null), "must be a comma-separated list of exact IPs (no CIDR ranges)"),
  ),
  NODE_ENV: optionalString,
  VAPID_PUBLIC_KEY: optionalString,
  VAPID_PRIVATE_KEY: optionalString,
  VAPID_SUBJECT: optionalString,
});

function parseVapid(e: z.infer<typeof webEnvSchema>): { push?: WebPushConfig; reason?: string } {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = e;
  if (!publicKey && !privateKey) return {};
  if (!publicKey || !privateKey) return { reason: "VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set together" };
  if (!subject) return { reason: "VAPID_SUBJECT is required when the VAPID keys are set" };
  if (!/^(mailto:|https:)/.test(subject)) return { reason: "VAPID_SUBJECT must be a mailto: or https: URL" };
  return { push: { publicKey, privateKey, subject } };
}

/** Parses the web gateway env. Throws on an invalid gateway setting; a bad VAPID setup only turns push off.
 *  Not called at import time, so a bad value here can never take the rest of the process down. */
export function parseWebConfig(env: Record<string, string | undefined>): WebConfig | undefined {
  if (!env["WEB_OWNER_LOGIN"]?.trim()) return undefined;
  const e = webEnvSchema.parse(env);
  if (!e.WEB_OWNER_LOGIN) return undefined;
  const { push, reason } = parseVapid(e);
  const production = e.NODE_ENV?.toLowerCase() === "production";
  return {
    port: e.WEB_PORT,
    bindAddr: e.WEB_BIND_ADDR,
    ownerLogin: e.WEB_OWNER_LOGIN,
    distDir: e.WEB_DIST_DIR,
    devLogin: !production && isLoopback(e.WEB_BIND_ADDR) ? e.WEB_DEV_LOGIN : undefined,
    trustedPeers: e.WEB_TRUSTED_PEERS,
    push,
    ...(reason ? { pushDisabledReason: reason } : {}),
  };
}
