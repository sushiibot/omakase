import { config } from "../config.ts";
import { buildTeamIndex, keyOf, toTeam, type Team, type TeamConfig, type TeamIndex } from "./teamConfig.ts";
export { parseTeams, buildTeamIndex } from "./teamConfig.ts";
export type { Team, TeamConfig, TeamSpace, TeamMembers, TeamLinear } from "./teamConfig.ts";

// Reference-identity cache: rebuilt only when `config.teams` is REASSIGNED (never mutate the
// map in place — an in-place edit leaves this index stale). Lazy so config load order is irrelevant
// and tests can swap the whole map between cases. Same pattern as principals.ts.
let cache: { source: Record<string, TeamConfig>; index: TeamIndex } | null = null;

function index(): TeamIndex {
  if (!cache || cache.source !== config.teams) {
    cache = { source: config.teams, index: buildTeamIndex(config.teams) };
  }
  return cache.index;
}

/** Resolve (surface, spaceId) → its team, or undefined when the space belongs to none. */
export function resolveTeam(surface: string, spaceId: string): Team | undefined {
  if (spaceId.length === 0) return undefined;
  return index().bySpace.get(keyOf(surface, spaceId));
}

/** Whether `principalId` is a trusted member of the team that owns (surface, spaceId). Pure;
 *  false when the space belongs to no team or the principal isn't listed as trusted there. */
export function isTeamMember(principalId: string, surface: string, spaceId: string): boolean {
  return resolveTeam(surface, spaceId)?.members?.[principalId]?.trusted === true;
}

/** All teams, by id — for a DM listing where there's no (surface, spaceId) to resolve from. */
export function listTeams(): Team[] {
  return Object.entries(config.teams).map(([id, entry]) => toTeam(id, entry));
}

/** A team by its own id, independent of any space — for a DM's `team` lookup. */
export function getTeam(teamId: string): Team | undefined {
  const entry = Object.hasOwn(config.teams, teamId) ? config.teams[teamId] : undefined;
  return entry ? toTeam(teamId, entry) : undefined;
}
