import { expect, test } from "bun:test";
import { TurnVoiceSession } from "./turnSession.ts";
import { mintWebActor } from "../actor.ts";
import { parseSpeechModels } from "./speech.ts";
import type { ServerWebSocket } from "bun";
import type { VoiceSocketData } from "./session.ts";
test("turns wait for commit, use the selected voice, reject duplicate commits and stop synthesis after interruption", async () => {
  const events: any[] = [];
  let asked = 0;
  let spoken = 0;
  const model = parseSpeechModels({
    data: [
      {
        id: "new/voice",
        name: "New",
        architecture: {
          input_modalities: ["text"],
          output_modalities: ["speech"],
        },
        pricing: { prompt: "0.000001" },
      },
    ],
  })[0]!;
  const session = new TurnVoiceSession(
    model,
    "heart",
    "secret",
    mintWebActor("owner@example.com"),
    "main",
    async () => {
      asked++;
      return "Result ".repeat(400);
    },
    () => {},
    async (audio) => {
      expect(audio.mediaType).toBe("audio/wav");
      return "Please work.";
    },
    async (_key, chosen, voice) => {
      expect(chosen.id).toBe("new/voice");
      expect(voice).toBe("heart");
      spoken++;
      return Buffer.from("mp3");
    },
  );
  session.open({
    send: (s: string) => events.push(JSON.parse(s)),
    close() {},
    getBufferedAmount: () => 0,
  } as unknown as ServerWebSocket<VoiceSocketData>);
  const pcm = Buffer.alloc(320);
  pcm.writeInt16LE(1000);
  session.message(
    JSON.stringify({ type: "audio", audio: pcm.toString("base64") }),
  );
  expect(asked).toBe(0);
  session.message('{"type":"commit"}');
  session.message('{"type":"commit"}');
  await Bun.sleep(10);
  expect(asked).toBe(1);
  expect(spoken).toBe(1);
  expect(events.some((e) => e.type === "audio_encoded")).toBe(true);
  session.message('{"type":"interrupt"}');
  await Bun.sleep(10);
  expect(spoken).toBe(1);
  expect(events.at(-1).type).toBe("turn_done");
  session.close();
});
