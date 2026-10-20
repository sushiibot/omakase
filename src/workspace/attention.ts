import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { attentionParams, RPC_METHODS, type AttentionMute, type AttentionRequest, type AttentionResult, type JobItem } from "../orchestration/contracts.ts";
import { readJson, writeFileAtomic } from "./files.ts";

/** Ratings the prompt lists, newest last; mutes are always listed in full. */
const PROMPT_RATINGS_MAX = 20;
const RATINGS_MAX = 100;
/** Topics the prompt offers for reuse. */
const PROMPT_TOPICS_MAX = 30;

interface Rating {
  key: string;
  job: string;
  title: string;
  topic?: string;
  rating: "up" | "down";
  at: string;
}

/** A mute, with the item keys whose 👎 set it, so undoing that 👎 lifts it. */
interface Mute extends AttentionMute {
  match: string;
  sources: string[];
}

interface State {
  ratings: Rating[];
  mutes: Mute[];
}

/**
 * The owner's 👍/👎 on job items. A 👎 mutes the item or its whole topic: muted items are dropped before
 * delivery, and every job's prompt lists the mutes and ratings so it stops flagging that kind of thing.
 * Owner-set, so nothing expires; the owner lifts a mute from Settings.
 */
export class AttentionPrefs {
  private readonly path: string;

  constructor(stateDir: string) {
    this.path = join(stateDir, "attention.json");
  }

  apply(req: AttentionRequest, at: Date): AttentionResult {
    if (req.action === "rate") this.rate(req, at);
    if (req.action === "unmute") {
      const state = this.read();
      this.write({ ...state, mutes: state.mutes.filter((m) => m.id !== req.id) });
    }
    return { mutes: this.read().mutes.map(({ id, scope, label, job, at }) => ({ id, scope, label, job, at })) };
  }

  /** False for an item the owner muted, by its key or its topic. */
  allows(item: Pick<JobItem, "key" | "topic">): boolean {
    const topic = item.topic ? norm(item.topic) : undefined;
    return !this.read().mutes.some((m) => (m.scope === "item" ? m.match === item.key : m.match === topic));
  }

  /** A prompt section with the owner's mutes and recent ratings, or "" when there are none. */
  promptSection(): string {
    const { ratings, mutes } = this.read();
    if (!ratings.length && !mutes.length) return "";
    const topics = mutes.filter((m) => m.scope === "topic");
    const items = mutes.filter((m) => m.scope === "item");
    const recent = ratings.slice(-PROMPT_RATINGS_MAX);
    const up = recent.filter((r) => r.rating === "up");
    const down = recent.filter((r) => r.rating === "down" && !items.some((m) => m.match === r.key));
    const known = [...new Set([...topics.map((m) => m.label), ...ratings.map((r) => r.topic).filter((t): t is string => !!t)])].slice(-PROMPT_TOPICS_MAX);
    const quote = (s: string) => JSON.stringify(s);
    return [
      "Owner's attention preferences, set with 👍/👎 on earlier items (the owner's own choices; follow them strictly):",
      topics.length ? `- Muted topics. Never flag anything of these kinds, from any source: ${topics.map((m) => quote(m.label)).join(", ")}. Items with a muted topic are dropped before the owner sees them.` : "",
      items.length ? `- Muted items. Never flag these again: ${items.map((m) => `${m.match} (${quote(m.label)})`).join("; ")}.` : "",
      up.length ? `- Useful (👍), lean toward things like these: ${up.map((r) => quote(r.topic ? `${r.title} [${r.topic}]` : r.title)).join("; ")}.` : "",
      down.length ? `- Not useful (👎), raise similar things only when clearly more important: ${down.map((r) => quote(r.topic ? `${r.title} [${r.topic}]` : r.title)).join("; ")}.` : "",
      known.length ? `When an item fits one of these existing topics, use that exact topic label: ${known.map(quote).join(", ")}.` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  private rate(req: Extract<AttentionRequest, { action: "rate" }>, at: Date): void {
    const { item } = req;
    const state = this.read();
    // A new rating replaces the item's last one and lifts any mute that one set.
    const ratings = state.ratings.filter((r) => r.key !== item.key);
    let mutes = state.mutes.map((m) => ({ ...m, sources: m.sources.filter((k) => k !== item.key) })).filter((m) => m.sources.length);
    if (req.rating) {
      ratings.push({ key: item.key, job: req.job, title: item.title, ...(item.topic ? { topic: item.topic } : {}), rating: req.rating, at: at.toISOString() });
      if (req.rating === "down") mutes = withMute(mutes, req.job, item, req.scope === "item" || !item.topic ? "item" : "topic", at);
    }
    this.write({ ratings: ratings.slice(-RATINGS_MAX), mutes });
  }

  private read(): State {
    const raw = readJson<Partial<State>>(this.path);
    return {
      ratings: Array.isArray(raw?.ratings) ? raw.ratings.filter((r) => r && typeof r.key === "string" && typeof r.title === "string") : [],
      mutes: Array.isArray(raw?.mutes) ? raw.mutes.filter((m) => m && typeof m.id === "string" && typeof m.match === "string" && Array.isArray(m.sources)) : [],
    };
  }

  private write(state: State): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileAtomic(this.path, `${JSON.stringify(state, null, 2)}\n`);
  }
}

function withMute(mutes: Mute[], job: string, item: Pick<JobItem, "key" | "title" | "topic">, scope: "item" | "topic", at: Date): Mute[] {
  const match = scope === "item" ? item.key : norm(item.topic!);
  const id = `${scope}:${match}`;
  const existing = mutes.find((m) => m.id === id);
  if (existing) return mutes.map((m) => (m === existing ? { ...m, sources: [...m.sources, item.key] } : m));
  return [...mutes, { id, scope, match, label: scope === "item" ? item.title : item.topic!.trim(), job, at: at.toISOString(), sources: [item.key] }];
}

const norm = (topic: string) => topic.trim().toLowerCase().replace(/\s+/g, " ");

/** `attention/manage`: the owner rated a job item in the app, or listed or lifted a mute. */
export function attentionHandlers(prefs: AttentionPrefs, principalId: string, now: () => Date = () => new Date()): Record<string, (params: unknown) => Promise<unknown>> {
  return {
    [RPC_METHODS.attentionManage]: async (p: unknown) => {
      const q = attentionParams.parse(p);
      if (q.principalId !== principalId) throw new Error("principal mismatch");
      return prefs.apply(q.request, now());
    },
  };
}
