import { isNoReply } from "../../../orchestration/contracts.ts";

/** Complete phrases feed a serial consumer while the producer keeps generating text. */
export class Utterances {
  private pending = "";
  private received = "";
  private currentMessage = "";
  private lastMessage = "";
  private work = Promise.resolve();
  private error: unknown;
  constructor(
    private consume: (text: string) => Promise<void>,
    private signal: AbortSignal,
  ) {}
  push(text: string, boundary = false) {
    if (this.signal.aborted || this.error) return;
    const delta = text.slice(0, Math.max(0, 24000 - this.received.length));
    this.received += delta;
    this.currentMessage += delta;
    this.pending += delta;
    while (this.pending.length) {
      const match = /[.!?。！？](?:["”’']?)(?:\s)/u.exec(this.pending);
      let end = match ? match.index + match[0].length : 0;
      if (!end && this.pending.length >= 300) {
        end = this.pending.lastIndexOf(" ", 300);
        if (end < 80) end = 300;
      }
      if (!end && boundary) end = this.pending.length;
      if (!end) break;
      const phrase = this.pending.slice(0, end).trim();
      this.pending = this.pending.slice(end);
      if (!phrase || isNoReply(phrase)) continue;
      // Catch immediately: synthesis may fail before the agent finishes generating.
      this.work = this.work
        .then(async () => {
          if (this.error) return;
          this.signal.throwIfAborted();
          await this.consume(phrase);
        })
        .catch((error) => {
          this.error = error;
        });
    }
    if (boundary && this.currentMessage) {
      this.lastMessage = this.currentMessage;
      this.currentMessage = "";
      this.received += "\n\n";
    }
  }
  async finish(finalText: string) {
    const latest = this.currentMessage || this.lastMessage;
    // Complete a partial last message without repeating its already-spoken prefix.
    // Older workspaces / fallback agents have no live text and enqueue the full reply here.
    if (latest && finalText.startsWith(latest))
      this.push(finalText.slice(latest.length), true);
    else {
      this.push("", true);
      if (
        !this.received.trimEnd().endsWith(finalText.trim()) &&
        finalText.trim()
      )
        this.push(finalText, true);
    }
    await this.work;
    if (this.error) throw this.error;
  }
}
