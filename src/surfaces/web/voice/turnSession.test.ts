import { expect, test } from "bun:test";
import { TurnVoiceSession } from "./turnSession.ts";
import { mintWebActor } from "../actor.ts";
import { parseSpeechModels, SpeechError } from "./speech.ts";
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
test("muting clears unsubmitted audio and speech failures preserve the reply and allow another turn", async () => {
  const events: any[] = [];
  let asked = 0;
  const model = {
    id: "google/test",
    name: "Gemini TTS",
    description: "",
    voices: [],
    curated: null,
    price: { unit: "characters" as const, input: 0, output: 0 },
  };
  const session = new TurnVoiceSession(
    model,
    "",
    "secret",
    mintWebActor("owner@example.com"),
    "main",
    async () => {
      asked++;
      return "Saved reply.";
    },
    () => {},
    async () => "Work please.",
    async () => {
      throw new SpeechError(
        "OpenRouter speech failed (402). Add OpenRouter credits.",
        402,
      );
    },
  );
  session.open({
    send: (s: string) => events.push(JSON.parse(s)),
    close() {},
    getBufferedAmount: () => 0,
  } as unknown as ServerWebSocket<VoiceSocketData>);
  const pcm = Buffer.alloc(320, 1);
  const audio = JSON.stringify({
    type: "audio",
    audio: pcm.toString("base64"),
  });
  session.message(audio);
  session.message('{"type":"clear"}');
  session.message('{"type":"commit"}');
  await Bun.sleep(10);
  expect(asked).toBe(0);
  expect(
    events.some((e) => e.type === "notice" && e.message.includes("No speech")),
  ).toBe(true);
  for (let i = 0; i < 2; i++) {
    session.message(audio);
    session.message('{"type":"commit"}');
    await Bun.sleep(10);
    expect(events.at(-1).type).toBe("turn_done");
  }
  expect(asked).toBe(2);
  expect(
    events.some((e) => e.type === "transcript" && e.text === "Saved reply."),
  ).toBe(true);
  expect(
    events.filter(
      (e) =>
        e.type === "notice" &&
        e.message.includes("OpenRouter speech failed (402)"),
    ),
  ).toHaveLength(2);
  session.close();
});

test("streaming bounds audio ahead of playback, ignores stale credits and waits for the last frame", async () => {
  const events: any[] = [];
  let released = false;
  const model = parseSpeechModels({
    data: [
      {
        id: "elevenlabs/eleven-v4-turbo",
        name: "Eleven",
        architecture: {
          input_modalities: ["text"],
          output_modalities: ["speech"],
        },
      },
    ],
  })[0]!;
  const session = new TurnVoiceSession(
    model,
    "george",
    "secret",
    mintWebActor("owner@example.com"),
    "main",
    async () => "A confirmed reply.",
    () => {},
    async () => "Hello.",
    undefined,
    { delivery: "warm" },
    async function* (_key, _model, _voice, text, _signal, options) {
      expect(text).toBe("A confirmed reply.");
      expect(options?.delivery).toBe("warm");
      try {
        for (let i = 0; i < 25; i++)
          yield { audio: Buffer.alloc(4800), sampleRate: 24000 };
      } finally {
        released = true;
      }
    },
  );
  session.open({
    send: (s: string) => events.push(JSON.parse(s)),
    close() {},
    getBufferedAmount: () => 0,
  } as unknown as ServerWebSocket<VoiceSocketData>);
  session.message(
    JSON.stringify({
      type: "audio",
      audio: Buffer.alloc(320, 1).toString("base64"),
    }),
  );
  session.message('{"type":"commit"}');
  await Bun.sleep(10);
  const frames = () => events.filter((e) => e.type === "audio");
  expect(frames()).toHaveLength(20);
  session.message('{"type":"playback_done","id":9999}');
  session.message('{"type":"playback_idle"}');
  await Bun.sleep(10);
  expect(frames()).toHaveLength(20);
  for (const frame of frames())
    session.message(
      JSON.stringify({ type: "playback_done", id: frame.playbackId }),
    );
  await Bun.sleep(10);
  expect(frames()).toHaveLength(25);
  expect(events.some((e) => e.type === "turn_done")).toBe(false);
  for (const frame of frames().slice(20))
    session.message(
      JSON.stringify({ type: "playback_done", id: frame.playbackId }),
    );
  await Bun.sleep(10);
  expect(events.at(-1).type).toBe("turn_done");
  expect(released).toBe(true);
  session.close();
});

test("interrupt cancels a stream blocked on playback and the next turn cannot reuse old credits", async () => {
  const events: any[] = [];
  let aborted: AbortSignal | undefined;
  let released = 0;
  const model = parseSpeechModels({
    data: [
      {
        id: "google/gemini-3.8-flash-lite-tts",
        name: "Gemini",
        architecture: {
          input_modalities: ["text"],
          output_modalities: ["speech"],
        },
      },
    ],
  })[0]!;
  const session = new TurnVoiceSession(
    model,
    "Kore",
    "secret",
    mintWebActor("owner@example.com"),
    "main",
    async () => "Reply.",
    () => {},
    async () => "Hello.",
    undefined,
    {},
    async function* (_key, _model, _voice, _text, signal) {
      aborted = signal;
      try {
        for (let i = 0; i < 50; i++)
          yield { audio: Buffer.alloc(4800), sampleRate: 24000 };
      } finally {
        released++;
      }
    },
  );
  session.open({
    send: (s: string) => events.push(JSON.parse(s)),
    close() {},
    getBufferedAmount: () => 0,
  } as unknown as ServerWebSocket<VoiceSocketData>);
  const start = () => {
    session.message(
      JSON.stringify({
        type: "audio",
        audio: Buffer.alloc(320, 1).toString("base64"),
      }),
    );
    session.message('{"type":"commit"}');
  };
  start();
  await Bun.sleep(10);
  session.message('{"type":"interrupt"}');
  await Bun.sleep(10);
  expect(aborted?.aborted).toBe(true);
  expect(released).toBe(1);
  expect(events.at(-1).type).toBe("turn_done");
  start();
  await Bun.sleep(10);
  session.message('{"type":"playback_done","id":1}');
  await Bun.sleep(10);
  expect(events.filter((e) => e.type === "audio")).toHaveLength(40);
  session.close();
  await Bun.sleep(10);
  expect(released).toBe(2);
});

test("speech starts before the agent resolves and final delivery does not replay streamed text", async () => {
  let finish!: (text: string) => void;
  const reply = new Promise<string>((resolve) => {
    finish = resolve;
  });
  const spoken: string[] = [];
  const events: any[] = [];
  const model = {
    id: "new/voice",
    name: "Voice",
    description: "",
    voices: [],
    curated: null,
    price: { unit: "characters" as const, input: 0, output: 0 },
  };
  const session = new TurnVoiceSession(
    model,
    "",
    "key",
    mintWebActor("owner@example.com"),
    "main",
    async (_text, _actor, _conversation, _signal, _link, ontext) => {
      ontext?.("The first sentence. ");
      return reply;
    },
    () => {},
    async () => "Hello",
    async (_key, _model, _voice, text) => {
      spoken.push(text);
      return Buffer.from("mp3");
    },
  );
  session.open({
    send: (raw: string) => {
      const event = JSON.parse(raw);
      events.push(event);
      if (event.type === "audio_encoded")
        queueMicrotask(() => session.message('{"type":"playback_idle"}'));
    },
    close() {},
    getBufferedAmount: () => 0,
  } as unknown as ServerWebSocket<VoiceSocketData>);
  session.message(
    JSON.stringify({
      type: "audio",
      audio: Buffer.alloc(320, 4).toString("base64"),
    }),
  );
  session.message('{"type":"commit"}');
  await Bun.sleep(10);
  expect(spoken).toEqual(["The first sentence."]);
  expect(events.some((e) => e.type === "turn_done")).toBe(false);
  finish("The first sentence.");
  await Bun.sleep(10);
  expect(spoken).toEqual(["The first sentence."]);
  expect(events.at(-1).type).toBe("turn_done");
  session.close();
});

test("read-aloud uses the same settings and playback protocol without transcription or agent calls", async () => {
  const events: any[] = [];
  const model = {
    id: "new/voice",
    name: "Voice",
    description: "",
    voices: ["warm"],
    curated: null,
    price: { unit: "characters" as const, input: 0, output: 0 },
  };
  let closed = false;
  const session = new TurnVoiceSession(
    model,
    "warm",
    "key",
    mintWebActor("owner@example.com"),
    "main",
    async () => {
      throw new Error("must not ask");
    },
    () => {
      closed = true;
    },
    async () => {
      throw new Error("must not transcribe");
    },
    async (_key, selected, voice, text, _signal, _fetch, options) => {
      expect(selected).toBe(model);
      expect(voice).toBe("warm");
      expect(text).toBe("Read this reply.");
      expect(options?.delivery).toBe("gentle");
      return Buffer.from("mp3");
    },
    { delivery: "gentle" },
    undefined,
    true,
  );
  session.open({
    send: (raw: string) => {
      events.push(JSON.parse(raw));
    },
    close() {},
    getBufferedAmount: () => 0,
  } as unknown as ServerWebSocket<VoiceSocketData>);
  session.message(JSON.stringify({ type: "speak", text: "Read this reply." }));
  await Bun.sleep(10);
  expect(events.some((e) => e.type === "audio_encoded")).toBe(true);
  expect(closed).toBe(false);
  session.message('{"type":"playback_idle"}');
  await Bun.sleep(10);
  expect(closed).toBe(true);
  expect(events.at(-1).type).toBe("turn_done");
});
