import { expect, test } from "bun:test";
import {
  createSpeechCatalog,
  parseSpeechModels,
  synthesizeSpeech,
} from "./speech.ts";
import { createVoiceRoutes } from "./routes.ts";
import { mintWebActor } from "../actor.ts";
const row = (id = "hexgrad/kokoro-82m", prompt = "0.00000062") => ({
  id,
  name: id,
  architecture: { input_modalities: ["text"], output_modalities: ["speech"] },
  pricing: { prompt, completion: "0" },
  supported_voices: ["heart", "bella"],
});
test("speech discovery includes uncurated models, filters modalities and preserves free/unknown rates", () => {
  const models = parseSpeechModels({
    data: [
      row(),
      row("future/voice", "0"),
      row("broken/price", "NaN"),
      { ...row("text/only"), architecture: { output_modalities: ["text"] } },
    ],
  });
  expect(models).toHaveLength(3);
  expect(models[0]?.curated).toBeNull();
  expect(models[1]?.curated).toBeNull();
  expect(models[1]?.price.input).toBe(0);
  expect(models[2]?.price.input).toBeNull();
});
test("catalog coalesces concurrent requests, caches success and retries failures", async () => {
  let count = 0;
  const catalog = createSpeechCatalog((async () => {
    count++;
    return Response.json({ data: [row()] });
  }) as unknown as typeof fetch);
  await Promise.all([catalog(), catalog()]);
  await catalog();
  expect(count).toBe(1);
  const failed = createSpeechCatalog((async () => {
    count++;
    return new Response(null, { status: 503 });
  }) as unknown as typeof fetch);
  await expect(failed()).rejects.toThrow();
  await expect(failed()).rejects.toThrow();
  expect(count).toBe(3);
});
test("Qwen is recommended ahead of Gemini and Kokoro stays discoverable without a recommendation", () => {
  const models = parseSpeechModels({
    data: [
      row(),
      row("google/gemini-3.8-flash-lite-tts"),
      row("qwen/qwen-audio-3.0-tts-flash"),
    ],
  });
  expect(models.map((m) => m.id)).toEqual([
    "qwen/qwen-audio-3.0-tts-flash",
    "google/gemini-3.8-flash-lite-tts",
    "hexgrad/kokoro-82m",
  ]);
  expect(models[0]?.curated).toBe("Recommended");
  expect(models[2]?.curated).toBeNull();
});
test("OpenRouter failures report status and recovery without passing upstream error bodies to the browser", async () => {
  for (const status of [401, 402, 429, 502]) {
    try {
      await synthesizeSpeech(
        "secret",
        parseSpeechModels({ data: [row()] })[0]!,
        "bella",
        "Done.",
        new AbortController().signal,
        async () =>
          Response.json({ error: "secret provider payload" }, { status }),
      );
      throw new Error("Expected rejection");
    } catch (error) {
      expect(String(error)).toContain(`OpenRouter speech failed (${status})`);
      expect(String(error)).not.toContain("secret");
    }
  }
});
test("speech requests use selected IDs and voice, and reject provider errors without exposing credentials", async () => {
  const model = parseSpeechModels({ data: [row()] })[0]!;
  const fetcher = (async (url: string, init?: RequestInit) => {
    expect(url).toBe("https://openrouter.ai/api/v1/audio/speech");
    expect(JSON.parse(String(init?.body))).toEqual({
      model: model.id,
      voice: "bella",
      input: "Done.",
      response_format: "mp3",
    });
    return new Response("audio", { headers: { "Content-Type": "audio/mpeg" } });
  }) as unknown as typeof fetch;
  expect(
    (
      await synthesizeSpeech(
        "secret",
        model,
        "bella",
        "Done.",
        new AbortController().signal,
        fetcher,
      )
    ).toString(),
  ).toBe("audio");
});
test("Gemini requests PCM and returns a playable 24kHz WAV without changing PCM samples", async () => {
  const model = parseSpeechModels({
    data: [row("google/gemini-3.8-flash-lite-tts")],
  })[0]!;
  const pcm = Buffer.from([1, 0, 255, 127, 0, 128]);
  const audio = await synthesizeSpeech(
    "secret",
    model,
    "Kore",
    "Hello.",
    new AbortController().signal,
    async (_url, init) => {
      expect(JSON.parse(String(init?.body)).response_format).toBe("pcm");
      return new Response(pcm, { headers: { "Content-Type": "audio/pcm" } });
    },
  );
  expect(audio.toString("ascii", 0, 4)).toBe("RIFF");
  expect(audio.readUInt32LE(24)).toBe(24000);
  expect(audio.readUInt32LE(28)).toBe(48000);
  expect(audio.subarray(44)).toEqual(pcm);
});
test("turn-mode upgrades validate discovered models and voices and share the live session limit", async () => {
  const model = parseSpeechModels({ data: [row("future/new-speech")] })[0]!;
  const routes = createVoiceRoutes(
    { OPENAI_API_KEY: "secret" },
    async () => "Done.",
    undefined,
    async () => ({ models: [model], updatedAt: "2026-10-11T00:00:00Z" }),
  );
  const actor = mintWebActor("owner@example.com");
  const req = (modelId: string, voice = "bella") =>
    new Request(
      `https://agent.test/api/voice/connect?mode=turns&model=${modelId}&voice=${voice}`,
      { headers: { Origin: "https://agent.test", Upgrade: "websocket" } },
    );
  expect(
    (await routes.handle(req("missing/model"), "/api/voice/connect", actor))
      ?.status,
  ).toBe(400);
  expect(
    (await routes.handle(req(model.id, "unknown"), "/api/voice/connect", actor))
      ?.status,
  ).toBe(400);
  const server = {
    timeout() {},
    upgrade() {
      return true;
    },
  };
  expect(
    (await routes.handle(req(model.id), "/api/voice/connect", actor, server))
      ?.status,
  ).toBe(204);
  expect(
    (await routes.handle(req(model.id), "/api/voice/connect", actor, server))
      ?.status,
  ).toBe(409);
  routes.close();
});
test("voice previews validate models and voices, use a fixed sample and cache repeated auditions", async () => {
  const model = parseSpeechModels({ data: [row()] })[0]!;
  let generated = 0;
  const routes = createVoiceRoutes(
    { OPENROUTER_API_KEY: "secret" },
    async () => "",
    undefined,
    async () => ({ models: [model], updatedAt: new Date().toISOString() }),
    async (key, chosen, voice, text) => {
      expect(key).toBe("secret");
      expect(chosen.id).toBe(model.id);
      expect(voice).toBe("bella");
      expect(text).toBe("Hi, I'm Sushii. What would you like to work on?");
      generated++;
      return Buffer.from("sample");
    },
  );
  const actor = mintWebActor("owner@example.com");
  const preview = (id: string, voice: string) =>
    routes.handle(
      new Request("https://agent.test/api/voice/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: id, voice, input: "untrusted input" }),
      }),
      "/api/voice/preview",
      actor,
    );
  expect((await preview("unknown", "bella"))?.status).toBe(400);
  expect((await preview(model.id, "unknown"))?.status).toBe(400);
  expect(await (await preview(model.id, "bella"))?.text()).toBe("sample");
  expect(await (await preview(model.id, "bella"))?.text()).toBe("sample");
  expect(generated).toBe(1);
  routes.close();
});

test("preview delivery is validated, forwarded, and included in the cache key", async () => {
  const model = parseSpeechModels({
    data: [row("elevenlabs/eleven-v4-turbo")],
  })[0]!;
  const deliveries: string[] = [];
  const routes = createVoiceRoutes(
    { OPENROUTER_API_KEY: "secret" },
    async () => "",
    undefined,
    async () => ({ models: [model], updatedAt: new Date().toISOString() }),
    async (_key, _chosen, _voice, _text, _signal, _fetch, options) => {
      deliveries.push(options?.delivery ?? "");
      return Buffer.from("sample");
    },
  );
  const actor = mintWebActor("owner@example.com");
  const preview = (delivery: unknown) =>
    routes.handle(
      new Request("https://agent.test/api/voice/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: model.id, voice: "bella", delivery }),
      }),
      "/api/voice/preview",
      actor,
    );
  expect((await preview("warm"))?.status).toBe(200);
  expect((await preview("warm"))?.status).toBe(200);
  expect((await preview("curious"))?.status).toBe(200);
  expect(deliveries).toEqual(["warm", "curious"]);
  for (const bad of ["[warm]", "x".repeat(301), {}, null])
    expect((await preview(bad))?.status).toBe(400);
  routes.close();
});
