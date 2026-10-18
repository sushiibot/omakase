import { expect, test } from "bun:test";
import { createVoiceAgent } from "./agent.ts";
import { mintWebActor } from "../actor.ts";
import type { WebThreads } from "../threadRoutes.ts";

test("voice uses a valid durable chat ID and waits for the matching agent reply", async () => {
  let listener: (reply: any) => void = () => {};
  let unsubscribed = false;
  let speechListener: (
    id: string,
    text: string,
    boundary?: boolean,
  ) => void = () => {};
  let speechUnsubscribed = false;
  const spoken: string[] = [];
  const links: { userId: string; assistantId?: string }[] = [];
  const actor = mintWebActor("owner@example.com");
  const threads = {
    channel: (conversation: string) => {
      expect(conversation).toBe("topic");
      return {
        adapter: {
          openTurns: () => [],
          subscribeSpeech: (next: typeof speechListener) => {
            speechListener = next;
            return () => {
              speechUnsubscribed = true;
            };
          },
          subscribeReply: (next: typeof listener) => {
            listener = next;
            return () => {
              unsubscribed = true;
            };
          },
        },
      };
    },
    conversation: (conversation: string) => {
      expect(conversation).toBe("topic");
      return {
        submit: async (
          body: { clientId: string; text: string; voice?: boolean },
          receivedActor: unknown,
        ) => {
          expect(receivedActor).toBe(actor);
          expect(body.clientId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
          expect(body.text).toBe("check my calendar");
          expect(body.voice).toBe(true);
          expect(links).toEqual([{ userId: body.clientId }]);
          speechListener("other", "Unrelated reply.");
          speechListener(body.clientId, "Your calendar is clear.");
          listener({ kind: "reply", replyTo: "other", text: "unrelated" });
          listener({
            kind: "reply",
            replyTo: body.clientId,
            text: "Your calendar is clear.",
            turnId: "calendar-turn",
          });
          return { kind: "accepted", seq: 1, routed: false };
        },
      };
    },
  } as unknown as WebThreads;
  expect(
    await createVoiceAgent(threads)(
      "check my calendar",
      actor,
      "topic",
      new AbortController().signal,
      (link) => links.push(link),
      (text) => spoken.push(text),
    ),
  ).toBe("Your calendar is clear.");
  expect(unsubscribed).toBe(true);
  expect(speechUnsubscribed).toBe(true);
  expect(spoken).toEqual(["Your calendar is clear."]);
  expect(links).toEqual([
    { userId: links[0]!.userId },
    { userId: links[0]!.userId, assistantId: "calendar-turn" },
  ]);
});
