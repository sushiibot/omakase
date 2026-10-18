import type { ConversationOperations } from "../application/conversationService.ts";
import type { WebWorkspaceAdapter } from "../workspaceAdapter.ts";
import type { AskAgent } from "./session.ts";
import { ulid } from "../../../workspace/ulid.ts";

interface VoiceConversations {
  channel(id: string): { adapter: Pick<WebWorkspaceAdapter, "openTurns" | "subscribeSpeech" | "subscribeReply"> };
  conversation(id: string): ConversationOperations;
}

/** Uses the same durable conversation operations, actor and approval flow as typed web chat. */
export function createVoiceAgent(threads: VoiceConversations): AskAgent {
  return async (text, actor, conversation, signal, onlink, ontext) => {
    const channel = threads.channel(conversation);
    if (signal.aborted) throw new Error("Voice call ended");
    if (channel.adapter.openTurns().length)
      return "Sushii is already working. Wait for the current turn or use the web chat to steer it.";
    const clientId = ulid();
    onlink?.({ userId: clientId });
    const unsubscribeSpeech = channel.adapter.subscribeSpeech((replyTo, delta, boundary) => {
      if (replyTo === clientId && !signal.aborted) ontext?.(delta, boundary);
    });
    let unsubscribe = () => {};
    let timer: ReturnType<typeof setTimeout>;
    let rejectReply: (reason: Error) => void = () => {};
    const abort = () => rejectReply(new Error("Voice call ended"));
    const reply = new Promise<string>((resolve, reject) => {
      rejectReply = reject;
      unsubscribe = channel.adapter.subscribeReply((reply) => {
        if (reply.kind === "reply" && reply.replyTo === clientId) {
          onlink?.({
            userId: clientId,
            ...(reply.turnId ? { assistantId: reply.turnId } : {}),
          });
          resolve(reply.text);
        }
      });
      timer = setTimeout(
        () =>
          resolve(
            "Sushii is still working or waiting for your approval. Check the web chat; no completion has been confirmed yet.",
          ),
        15 * 60 * 1000,
      );
      signal.addEventListener("abort", abort, { once: true });
    });
    // Attach a handler before submission awaits: cancellation can arrive during routing.
    void reply.catch(() => {});
    try {
      const res = await threads.conversation(conversation).submit({ clientId, text, voice: true }, actor);
      if (res.kind !== "accepted") throw new Error("Sushii couldn't accept the voice request");
      return await reply;
    } finally {
      unsubscribe();
      unsubscribeSpeech();
      clearTimeout(timer!);
      signal.removeEventListener("abort", abort);
    }
  };
}
