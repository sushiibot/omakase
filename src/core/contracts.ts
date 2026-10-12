// Tool and store contracts shared by the gateway's proxied tools.
import type { ModelMessage } from "ai";

// ─────────────────────────────────────────────────────────────────────────────
// §1 Identity
// ─────────────────────────────────────────────────────────────────────────────

/** Discriminated tag, open for new surfaces. */
export type SurfaceId = "discord" | "buzz" | (string & {});

/** Replaces the bare Discord `threadId`. THE re-keying primitive. `spaceId` (guildId on Discord)
 *  is deliberately separate from `surface`: a buzz conversation can be scoped to a Discord guild. */
export interface ConversationRef {
  surface: SurfaceId;
  spaceId: string;
  conversationId: string;
  /** Surface declares a private/DM conversation; overrides the spaceId-based personal-space heuristic
   *  for memory scoping. */
  isPrivate?: boolean;
  /** Set when `isPrivate` is a fail-safe guess (e.g. buzz's channel-type lookup returned "unknown"),
   *  not a surface-confirmed private space. Memory scoping may still trust the fail-safe `isPrivate`;
   *  a tool deciding whether to disclose detail must not. */
  privacyUnverified?: boolean;
}

/** Replaces `UserNames` + `TriggeringUser`. Platform-neutral author identity. */
export interface AuthorRef {
  surface: SurfaceId;
  userId: string;
  username: string | null;
  displayName?: string | null;
  /** Neutral permission signal the brain reasons about. Surface computes it (roles → this flag). */
  isModerator?: boolean;
  /** Neutral role list for prompt context; ids opaque to the core. Surface-resolved. */
  roles?: { id: string; name: string }[];
}

// ─────────────────────────────────────────────────────────────────────────────
// §5 Interactive pause/resume (data-addressed, restart-survivable — never a Promise/closure)
// ─────────────────────────────────────────────────────────────────────────────

export interface AskQuestion {
  question: string; // tokenized; surface renders
  choices: string[];
  /** Only this author may answer (ports triggeredByUserId). */
  authorizedResponder: AuthorRef;
}

export type PendingInteraction = { kind: "question"; payload: AskQuestion };

// ─────────────────────────────────────────────────────────────────────────────
// §6 Surface capabilities
// ─────────────────────────────────────────────────────────────────────────────

/** Static flags — readable at prompt-build time (gate slots) AND delivery time (degradation). */
export interface SurfaceCapabilities {
  richComponents: boolean;
  customEmoji: boolean;
  nativeTimestamps: boolean;
  threads: boolean;
  reactions: boolean;
  progress: boolean;
  interactiveChoices: boolean;
  typing: boolean;
  replyTo: boolean;
}

/** What the tool registry needs from a caller's session. */
export interface SurfaceSession {
  readonly capabilities: SurfaceCapabilities;
  readonly hosts: ToolHosts;
}

// ─────────────────────────────────────────────────────────────────────────────
// §7 Tools (C6): host-typed — a tool needing a host is unconstructable without it
// ─────────────────────────────────────────────────────────────────────────────

/** Provider-neutral tool definition; U2 maps this to the AI SDK's tool shape. */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** A tool can request that THIS conversation's stored history be cleared. The reset is applied by
 *  agentCore AFTER the turn (so it survives the normal end-of-turn save), which then persists an
 *  empty history instead of the turn's messages. Durable memory (SpaceMemoryStore) is untouched. */
export interface ResetSink {
  request(): void;
}

export interface ToolContext {
  space: { surface: SurfaceId; spaceId: string };
  /** Whether this turn runs in a private/DM context — threaded into execution authz's
   *  personal-space check (a Slack DM's spaceId is the teamId, not "dm", so a space-string test
   *  can't infer it). */
  isPrivate?: boolean;
  /** Threaded from ConversationRef.privacyUnverified: `isPrivate` may be a fail-safe guess rather than
   *  a surface-confirmed private space. A tool gating disclosure on privacy must check this too. */
  privacyUnverified?: boolean;
  /** One per loop run (fresh inbound or resume) — lets a tool require that a confirmation came
   *  after the user saw the previous turn's reply. Mid-loop injections don't change it: the user
   *  hasn't seen this turn's reply yet. */
  turnId?: string;
  owner: AuthorRef | null; // tainted owner-gate identity, NOT inbound.author
  store: ConversationStore;
  memory: SpaceMemoryStore;
  reset?: ResetSink;
  log: unknown; // Logger; typed loosely to avoid coupling U0 to the logger module
}

/** Extra capabilities a tool may require from its caller. The gateway provides none, so only host-free tools run. */
export interface ToolHosts {}

export interface ToolResult {
  content: string;
}

export interface ToolEntry<H extends keyof ToolHosts = never> {
  name: string;
  definition: ToolDefinition;
  /** Hosts this tool needs; if any is absent for the session, the tool is not registered. */
  requiresHosts: readonly H[];
  /** Surface capabilities this tool needs (e.g. ask_question needs `interactiveChoices`). */
  requiresCapabilities?: readonly (keyof SurfaceCapabilities)[];
  execute(
    input: Record<string, unknown>,
    ctx: ToolContext & Required<Pick<ToolHosts, H>>,
  ): Promise<ToolResult>;
}

export interface ToolRegistry {
  /** The tool set for a caller, given the session's hosts + capabilities + config gates. */
  resolve(
    session: SurfaceSession,
    space: {
      surface: SurfaceId;
      spaceId: string;
      /** Owner-DM gating (update_profile). */
      isOwner?: boolean;
      isPrivate?: boolean;
      /** Gates ops-triage tools. */
      authorized?: boolean;
    },
  ): ToolEntry<keyof ToolHosts>[];
}

// ─────────────────────────────────────────────────────────────────────────────
// §8 Stores (re-keyed by ConversationRef / spaceId)
// ─────────────────────────────────────────────────────────────────────────────

export interface ConversationData {
  messages: ModelMessage[];
  initialThreadContext: string | null;
}

export interface ConversationStore {
  load(ref: ConversationRef): ConversationData;
  save(ref: ConversationRef, data: ConversationData): void;
  deleteStale(maxAgeMs: number): void;
}

export interface MemoryEntry {
  id: number;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface SpaceMemoryStore {
  getServerContext(spaceId: string): string | null;
  setServerContext(spaceId: string, content: string): void;
  listTitles(spaceId: string): string[];
  count(spaceId: string): number;
  read(spaceId: string, title: string): MemoryEntry | null;
  search(spaceId: string, query: string, limit?: number): MemoryEntry[];
  upsert(spaceId: string, title: string, content: string): { ok: true } | { error: string };
  delete(spaceId: string, title: string): boolean;
}
