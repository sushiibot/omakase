import { expect, test } from "bun:test";
import { parseSpeechModels, streamSpeech, synthesizeSpeech } from "./speech.ts";
import {
  speechCapabilities,
  speechDelivery,
  validDelivery,
} from "./speechCapabilities.ts";

const model = (id = "elevenlabs/eleven-v4-turbo") =>
  parseSpeechModels({
    data: [
      {
        id,
        name: id,
        architecture: {
          input_modalities: ["text"],
          output_modalities: ["speech"],
        },
      },
    ],
  })[0]!;

test("delivery controls follow the model and never become spoken text for unsupported models", () => {
  expect(
    speechDelivery(model().id, "Hello.", { delivery: "warm, curious" }),
  ).toEqual({ input: "[warm, curious] Hello." });
  expect(
    speechDelivery("google/gemini-3.8-flash-lite-tts", "Hello.", {
      delivery: "warm",
    }),
  ).toEqual({ input: "Hello.", instructions: "warm" });
  for (const id of [
    "future/voice",
    "elevenlabs/eleven-flash-v2.5",
    "qwen/qwen-audio-3.0-tts-flash",
  ])
    expect(speechDelivery(id, "Hello.", { delivery: "warm" })).toEqual({
      input: "Hello.",
    });
  expect(speechCapabilities("future/voice")).toEqual({
    expression: null,
    streaming: false,
  });
  for (const value of [null, 1, "a".repeat(301), "[warm]", "hello\nworld"])
    expect(validDelivery(value)).toBe(false);
});

test("stream delivers audio before EOF, preserves odd network boundaries and caps each playback packet", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const input = Buffer.alloc(14001, 7);
  const stream = streamSpeech(
    "secret",
    model(),
    "george",
    "Hello.",
    new AbortController().signal,
    { delivery: "warm", previousText: "Previous.", nextText: "Next." },
    async (_url, init) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        model: model().id,
        input: "[warm] Hello.",
        voice: "george",
        response_format: "pcm",
        provider: {
          options: {
            elevenlabs: {
              output_format: "pcm_24000",
              previous_text: "Previous.",
              next_text: "Next.",
            },
          },
        },
      });
      return new Response(
        new ReadableStream({
          start(c) {
            controller = c;
            c.enqueue(input);
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "Content-Type": "audio/pcm;rate=24000;channels=1" } },
      );
    },
  );
  const chunks: Buffer[] = [];
  for (let i = 0; i < 3; i++) {
    const next = await stream.next();
    expect(next.done).toBe(false);
    expect(next.value!.audio.length).toBeLessThanOrEqual(4800);
    chunks.push(next.value!.audio);
  }
  // EOF has not arrived, but all complete samples are already playable.
  expect(Buffer.concat(chunks)).toEqual(input.subarray(0, 14000));
  controller.enqueue(Buffer.from([9]));
  controller.close();
  for await (const chunk of stream) chunks.push(chunk.audio);
  expect(Buffer.concat(chunks)).toEqual(
    Buffer.concat([input, Buffer.from([9])]),
  );
  expect(cancelled).toBe(false); // reader already reached EOF
});

test("breaking playback cancels the upstream body", async () => {
  let cancelled = false;
  for await (const chunk of streamSpeech(
    "secret",
    model(),
    "george",
    "Hello.",
    new AbortController().signal,
    {},
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(Buffer.alloc(9600));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "Content-Type": "audio/pcm" } },
      ),
  )) {
    expect(chunk.audio.length).toBe(4800);
    break;
  }
  expect(cancelled).toBe(true);
});

test("rejects empty, odd, oversized and incompatible PCM responses", async () => {
  for (const [body, type] of [
    [Buffer.alloc(0), "audio/pcm"],
    [Buffer.alloc(13), "audio/pcm"],
    [Buffer.alloc(4 * 1024 * 1024 + 2), "audio/pcm"],
    [Buffer.from("RIFF0000WAVE"), "audio/pcm"],
    [Buffer.alloc(12), "audio/mpeg"],
    [Buffer.alloc(12), "audio/pcm;rate=48000;channels=1"],
    [Buffer.alloc(12), "audio/pcm;rate=24000;channels=2"],
  ] as const) {
    const collect = async () => {
      for await (const _ of streamSpeech(
        "secret",
        model(),
        "george",
        "Hello.",
        new AbortController().signal,
        {},
        async () => new Response(body, { headers: { "Content-Type": type } }),
      )) {
        /* consume */
      }
    };
    await expect(collect()).rejects.toThrow();
  }
});

test("buffered previews use identical model-specific expression", async () => {
  await synthesizeSpeech(
    "secret",
    model(),
    "george",
    "Hello.",
    new AbortController().signal,
    async (_url, init) => {
      expect(JSON.parse(String(init?.body)).input).toBe("[warm] Hello.");
      return new Response("mp3", { headers: { "Content-Type": "audio/mpeg" } });
    },
    { delivery: "warm" },
  );
});
