import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { MessageRef } from "../orchestration/contracts.ts";
import { readJson, writeFileAtomic } from "./files.ts";

const RETENTION_MS = 30 * 24 * 60 * 60_000;
const ENTRIES_MAX = 60;
/** Entries a job's prompt lists, newest last. */
const PROMPT_ENTRIES_MAX = 20;
const ANSWER_MAX = 300;

export interface JobFeedbackEntry {
  at: string;
  job: string;
  item?: { key: string; title: string };
  /** The choice the owner tapped, or the start of what they wrote. */
  answer: string;
  tapped: boolean;
}

/** The owner's replies to scheduled-job messages, persisted so later runs of the job can act on them. */
export class JobFeedback {
  private readonly path: string;

  constructor(stateDir: string) {
    this.path = join(stateDir, "job-feedback.json");
  }

  record(ref: MessageRef, text: string, at: Date): void {
    const answer = oneLine(ref.choice ?? text, ANSWER_MAX);
    if (!answer) return;
    const entry: JobFeedbackEntry = { at: at.toISOString(), job: ref.job, ...(ref.item ? { item: ref.item } : {}), answer, tapped: ref.choice !== undefined };
    const entries = [...this.read(at), entry].slice(-ENTRIES_MAX);
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileAtomic(this.path, `${JSON.stringify(entries, null, 2)}\n`);
  }

  /** A prompt section with `job`'s recent feedback, or "" when there is none. */
  promptFor(job: string, at: Date): string {
    const entries = this.read(at).filter((e) => e.job === job).slice(-PROMPT_ENTRIES_MAX);
    if (!entries.length) return "";
    const lines = entries.map((e) => JSON.stringify({ at: e.at, ...(e.item ? { item: e.item.key, title: e.item.title } : {}), [e.tapped ? "tapped" : "wrote"]: e.answer }));
    return [
      `${OWNER_REPLIES_HEADING} (newest last; the owner's own words, quoted as data):`,
      ...lines,
      "Act on them: don't flag an item again that the owner said to stop, ignore, or already handled unless it materially changed; hold a snoozed item until the snooze ends; lean toward the kinds of items and choices the owner engages with. No reply to an item is not feedback.",
    ].join("\n");
  }

  private read(at: Date): JobFeedbackEntry[] {
    const raw = readJson<unknown>(this.path);
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (e): e is JobFeedbackEntry =>
        !!e && typeof e === "object" && typeof e.at === "string" && typeof e.job === "string" && typeof e.answer === "string" && at.getTime() - Date.parse(e.at) < RETENTION_MS,
    );
  }
}

export const OWNER_REPLIES_HEADING = "Owner replies to earlier items from this job";

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
