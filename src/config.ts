import type { PrincipalConfig } from "./orchestration/principals.ts";
import type { TeamConfig } from "./orchestration/teams.ts";
import { parseTeams, buildTeamIndex } from "./orchestration/teams.ts";
import { getLogger } from "./logger.ts";

const logger = getLogger("config");

export interface Config {
  openaiApiKey: string;
  openaiBaseUrl: string;
  /** OpenRouter transcription (ASR) model for voice messages. */
  transcriptionModel: string;
  databasePath: string;
  /** Manual cross-platform identity registry (principal → identities), hand-maintained in
   *  principals.json (path via PRINCIPALS_PATH). Missing/empty file + OWNER_DISCORD_ID set →
   *  a single owner principal is synthesized from it. Neither set → empty map, nobody is owner
   *  (default deny). See loadPrincipals below and orchestration/principals.ts. */
  principals: Record<string, PrincipalConfig>;
  /** Team grouping (team id → its spaces + per-team scoping), hand-maintained in teams.json
   *  (path via TEAMS_PATH). Empty/unset → unconfigured; ops-triage Linear routing falls through
   *  to the global default. See orchestration/teams.ts. */
  teams: Record<string, TeamConfig>;
  exaApiKey: string | undefined;
  googleMapsApiKey: string | undefined;
  /** Seeds the synthesized owner principal when principals.json is absent (see resolveOwnerPrincipals).
   *  Tools run as this user id. */
  ownerDiscordId: string | undefined;
  linearApiKey: string | undefined;
  linearTeamId: string | undefined;
  /** Grafana's own HTTP API — Loki/Tempo aren't independently reachable from the deploy host, so every log/trace query goes through Grafana's datasource-proxy at this base URL. */
  grafanaBaseUrl: string | undefined;
  grafanaApiToken: string | undefined;
}

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

function optional(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

import { readFileSync } from "fs";

/** Reconciles a file-loaded principal registry with OWNER_DISCORD_ID. A non-empty registry is used
 *  as-is — never merged — but a declared owner whose discord identity differs from the env var only
 *  warns (the file wins). An empty registry (missing/empty file) with OWNER_DISCORD_ID set
 *  synthesizes a single owner principal from it; with neither set, the registry stays empty and
 *  nobody is owner (default deny). Factored out of loadPrincipals, with `warn` injectable, so
 *  synthesis/mismatch logic is testable without touching the filesystem or the real logger. */
export function resolveOwnerPrincipals(
  raw: Record<string, PrincipalConfig>,
  ownerDiscordId: string | undefined,
  warn: (ctx: Record<string, unknown>, msg: string) => void = (ctx, msg) => logger.warn(ctx, msg),
): Record<string, PrincipalConfig> {
  const ownerId = Object.keys(raw).find((id) => raw[id]?.owner === true);
  if (ownerId) {
    const fileOwnerDiscord = raw[ownerId]?.identities?.discord;
    if (ownerDiscordId && fileOwnerDiscord && fileOwnerDiscord !== ownerDiscordId) {
      warn(
        { principalId: ownerId, fileOwnerDiscord, ownerDiscordId },
        "principals.json owner's discord identity differs from OWNER_DISCORD_ID; the file wins",
      );
    }
    return lowercaseWebLogins(raw);
  }
  if (Object.keys(raw).length === 0 && ownerDiscordId) {
    return { owner: { owner: true, identities: { discord: ownerDiscordId } } };
  }
  return lowercaseWebLogins(raw);
}

/** Web actors carry logins normalized as surfaces/web/actor.ts's normalizeLogin does (trim + lowercase),
 *  so a mixed-case `web` identity would never match one. */
function lowercaseWebLogins(raw: Record<string, PrincipalConfig>): Record<string, PrincipalConfig> {
  let out: Record<string, PrincipalConfig> | undefined;
  for (const [id, p] of Object.entries(raw)) {
    const web = p?.identities?.["web"];
    if (typeof web !== "string" || web === web.trim().toLowerCase()) continue;
    out ??= { ...raw };
    out[id] = { ...p, identities: { ...p.identities, web: web.trim().toLowerCase() } };
  }
  return out ?? raw;
}

/** Load + validate the manual principal registry. A missing DEFAULT file means "empty" (subject to
 *  OWNER_DISCORD_ID synthesis below); an explicitly-set PRINCIPALS_PATH that can't be read or parsed
 *  is a misconfiguration and throws. Enforces the at-most-one-owner invariant at load. */
function loadPrincipals(): Record<string, PrincipalConfig> {
  const explicit = process.env["PRINCIPALS_PATH"];
  const filePath = explicit ?? "./principals.json";
  let content: string | undefined;
  try {
    content = readFileSync(filePath, "utf8");
  } catch (e) {
    if (explicit) throw new Error(`Failed to load principals from ${filePath}: ${e}`);
  }
  let raw: Record<string, PrincipalConfig> = {};
  if (content !== undefined) {
    try {
      raw = JSON.parse(content);
    } catch (e) {
      throw new Error(`Invalid principals JSON in ${filePath}: ${e}`);
    }
  }
  const owners = Object.keys(raw).filter((id) => raw[id]?.owner === true);
  if (owners.length > 1) {
    throw new Error(`principals: at most one principal may be owner (found ${owners.join(", ")})`);
  }
  return resolveOwnerPrincipals(raw, process.env["OWNER_DISCORD_ID"]);
}

function parseTeamsJson(content: string, filePath: string): Record<string, TeamConfig> {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (e) {
    throw new Error(`Invalid teams JSON in ${filePath}: ${e}`);
  }
  const teams = parseTeams(raw);
  buildTeamIndex(teams);
  return teams;
}

/** Load + validate the team grouping, which routes ops-triage per space. TEAMS_PATH set →
 *  it wins outright, and a failure to read/parse it throws (an explicit path is a promise the file
 *  is there). Unset → `./teams.json` if present, else unconfigured (empty). The read and the parse
 *  are two separate try blocks: an unreadable default path is "no teams.json", but an existing,
 *  invalid one must still throw.
 *  `readFile` is injectable so this is testable without real files (mirrors resolveOwnerPrincipals's
 *  injectable `warn`). Shape validation and buzz spaceId normalization live in parseTeams (teams.ts);
 *  buildTeamIndex then runs on the normalized output so two spellings of one relay collide as a
 *  duplicate at boot, not later. */
export function resolveTeamsConfig(
  teamsPathEnv: string | undefined,
  readFile: (filePath: string) => string,
): Record<string, TeamConfig> {
  if (teamsPathEnv) {
    let content: string;
    try {
      content = readFile(teamsPathEnv);
    } catch (e) {
      throw new Error(`Failed to load teams from ${teamsPathEnv}: ${e}`);
    }
    return parseTeamsJson(content, teamsPathEnv);
  }

  let content: string;
  try {
    content = readFile("./teams.json");
  } catch {
    return {};
  }
  return parseTeamsJson(content, "./teams.json");
}

function loadTeams(): Record<string, TeamConfig> {
  return resolveTeamsConfig(process.env["TEAMS_PATH"], (p) => readFileSync(p, "utf8"));
}

const loadedTeams = loadTeams();

export const config: Config = {
  openaiApiKey: required("OPENAI_API_KEY"),
  openaiBaseUrl: optional("OPENAI_BASE_URL", "https://api.anthropic.com/v1"),
  transcriptionModel: optional("TRANSCRIPTION_MODEL", "openai/whisper-large-v3"),
  databasePath: optional("DATABASE_PATH", "./data/personal.db"),
  principals: loadPrincipals(),
  teams: loadedTeams,
  exaApiKey: process.env["EXA_API_KEY"],
  googleMapsApiKey: process.env["GOOGLE_MAPS_API_KEY"],
  ownerDiscordId: process.env["OWNER_DISCORD_ID"],
  linearApiKey: process.env["LINEAR_API_KEY"],
  linearTeamId: process.env["LINEAR_TEAM_ID"],
  grafanaBaseUrl: process.env["GRAFANA_BASE_URL"],
  grafanaApiToken: process.env["GRAFANA_API_TOKEN"],
};
