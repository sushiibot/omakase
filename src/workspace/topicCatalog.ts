import { join } from "node:path";
import { z } from "zod";
import { TOPIC_ID_RE } from "../orchestration/contracts.ts";
import { readJson, writeFileAtomic } from "./files.ts";

const topicRecord = z.object({
  id: z.string().regex(TOPIC_ID_RE),
  title: z.string().min(1).max(120),
  brief: z.string().max(16000),
  archived: z.boolean(),
});
export type TopicRecord = z.infer<typeof topicRecord>;

export function readTopicCatalog(stateDir: string): Record<string, TopicRecord> {
  const saved = z.record(topicRecord).safeParse(readJson<unknown>(join(stateDir, "topics.json")) ?? {});
  if (!saved.success) throw new Error("invalid persisted topic catalog");
  return Object.assign(Object.create(null) as Record<string, TopicRecord>, saved.data);
}

export function writeTopicCatalog(stateDir: string, records: Record<string, TopicRecord>): void {
  writeFileAtomic(join(stateDir, "topics.json"), JSON.stringify(records));
}

/** Query without constructing sessions: startup wakeups run before TopicSessions exists.
 * Archived topics still exist and can receive results or scheduled checks. This is
 * a presence check; full catalog validation remains at session construction. */
export function topicConversationExists(stateDir: string, id: string): boolean {
  return id === "main" || !!readJson<Record<string, unknown>>(join(stateDir, "topics.json"))?.[id];
}
