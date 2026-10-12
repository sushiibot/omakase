import type { ConversationRef, ConversationStore, SpaceMemoryStore, SurfaceId, ToolContext, ToolEntry, ToolHosts, ToolRegistry, SurfaceSession } from "../contracts.ts";
import { config } from "../../config.ts";
import { PORTABLE_TOOL_ENTRIES } from "./portable/tools.ts";
import { OPS_TRIAGE_TOOL_ENTRIES } from "./opsTriage/tools.ts";

export const ALL_TOOL_ENTRIES: ToolEntry<keyof ToolHosts>[] = [...PORTABLE_TOOL_ENTRIES, ...OPS_TRIAGE_TOOL_ENTRIES];

const EXA_TOOLS = new Set(["web_search", "fetch_url_content"]);
const GRAFANA_TOOLS = new Set(["search_logs", "get_trace"]);
const LINEAR_TOOLS = new Set(["file_linear_issue", "get_issue_status", "list_triaged_issues"]);

/** Config-key gates, resolved once per `resolve()` call so tests can supply availability directly. */
export interface ToolAvailability {
  exa: boolean;
  grafanaBaseUrl: boolean;
  linear: boolean;
}

function defaultAvailability(): ToolAvailability {
  return {
    exa: !!config.exaApiKey,
    grafanaBaseUrl: !!config.grafanaBaseUrl,
    linear: !!(config.linearApiKey && config.linearTeamId),
  };
}

function hostsSatisfied(entry: ToolEntry<keyof ToolHosts>, hosts: ToolHosts): boolean {
  return entry.requiresHosts.every((h) => hosts[h] !== undefined);
}

function capabilitiesSatisfied(entry: ToolEntry<keyof ToolHosts>, session: SurfaceSession): boolean {
  return (entry.requiresCapabilities ?? []).every((c) => session.capabilities[c]);
}

export class CoreToolRegistry implements ToolRegistry {
  constructor(
    private readonly entries: ToolEntry<keyof ToolHosts>[] = ALL_TOOL_ENTRIES,
    private readonly availability: () => ToolAvailability = defaultAvailability,
  ) {}

  resolve(
    session: SurfaceSession,
    space: { surface: SurfaceId; spaceId: string; isOwner?: boolean; isPrivate?: boolean; authorized?: boolean },
  ): ToolEntry<keyof ToolHosts>[] {
    const a = this.availability();
    // update_profile edits the owner's profile, so it never shows in a shared space.
    const profileAllowed = space.isOwner === true && space.isPrivate === true;
    const opsAllowed = space.authorized === true;

    return this.entries
      .filter((entry) => hostsSatisfied(entry, session.hosts) && capabilitiesSatisfied(entry, session))
      .filter((entry) => a.exa || !EXA_TOOLS.has(entry.name))
      .filter((entry) => opsAllowed || !(GRAFANA_TOOLS.has(entry.name) || LINEAR_TOOLS.has(entry.name)))
      .filter((entry) => a.grafanaBaseUrl || !GRAFANA_TOOLS.has(entry.name))
      .filter((entry) => a.linear || !LINEAR_TOOLS.has(entry.name))
      .filter((entry) => entry.name !== "update_profile" || profileAllowed);
  }
}

export function createToolRegistry(entries?: ToolEntry<keyof ToolHosts>[], availability?: () => ToolAvailability): ToolRegistry {
  return new CoreToolRegistry(entries, availability);
}

export function buildToolContextBase(input: {
  conversation: ConversationRef;
  isPrivate: boolean;
  store: ConversationStore;
  memory: SpaceMemoryStore;
  hosts: ToolHosts;
}): Omit<ToolContext, "owner"> {
  return {
    space: { surface: input.conversation.surface, spaceId: input.conversation.spaceId },
    isPrivate: input.isPrivate,
    privacyUnverified: input.conversation.privacyUnverified,
    store: input.store,
    memory: input.memory,
    log: undefined,
    ...input.hosts,
  };
}
