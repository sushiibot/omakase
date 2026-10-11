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
  expect(models[0]?.curated).toBe("Budget");
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
