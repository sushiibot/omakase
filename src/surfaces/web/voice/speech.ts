import {
  speechCapabilities,
  speechDelivery,
  type SpeechOptions,
} from "./speechCapabilities.ts";
import { readBodyCapped } from "../http.ts";
import { pcmWav } from "../../../agent/transcriptionAudio.ts";
export type SpeechFetch = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

export interface SpeechModel {
  id: string;
  name: string;
  description: string;
  voices: string[];
  curated: string | null;
  capabilities?: ReturnType<typeof speechCapabilities>;
  price: {
    unit: "characters" | "tokens" | "seconds";
    input: number | null;
    output: number | null;
  };
}
const curated: Record<string, string> = {
  "qwen/qwen-audio-3.0-tts-flash": "Recommended",
  "google/gemini-3.8-flash-lite-tts": "Value candidate",
  "qwen/qwen-audio-3.0-tts-plus": "Quality alternative",
  "elevenlabs/eleven-v4-turbo": "Premium",
};
const rate = (value: unknown): number | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
export function parseSpeechModels(data: unknown): SpeechModel[] {
  if (
    !data ||
    typeof data !== "object" ||
    !("data" in data) ||
    !Array.isArray(data.data)
  )
    throw new Error("Invalid speech catalog");
  const models = data.data.flatMap((m): SpeechModel[] => {
    if (
      !m ||
      typeof m.id !== "string" ||
      typeof m.name !== "string" ||
      !m.architecture?.input_modalities?.includes("text") ||
      !m.architecture?.output_modalities?.includes("speech")
    )
      return [];
    const input = rate(m.pricing?.prompt);
    const output = rate(m.pricing?.completion);
    const unit =
      (m.architecture?.tokenizer && m.architecture.tokenizer !== "Other") ||
      (input !== null && input > 0 && output !== null && output > 0)
        ? "tokens"
        : input === 0 && output !== null && output > 0
          ? "seconds"
          : "characters";
    return [
      {
        id: m.id,
        name: m.name,
        description: typeof m.description === "string" ? m.description : "",
        voices: Array.isArray(m.supported_voices)
          ? m.supported_voices.filter((v: unknown) => typeof v === "string")
          : [],
        curated: curated[m.id] ?? null,
        capabilities: speechCapabilities(m.id),
        price: { unit, input, output },
      },
    ];
  });
  const order = Object.keys(curated);
  return models.sort((a, b) => {
    const rank = (id: string) =>
      order.includes(id) ? order.indexOf(id) : order.length;
    return rank(a.id) - rank(b.id);
  });
}
export function createSpeechCatalog(fetcher: SpeechFetch = fetch) {
  type Catalog = { models: SpeechModel[]; updatedAt: string };
  let cached: Catalog | null = null;
  let pending: Promise<Catalog> | null = null;
  return async () => {
    if (cached && Date.now() - Date.parse(cached.updatedAt) < 5 * 60_000)
      return cached;
    if (pending) return pending;
    pending = (async () => {
      const res = await fetcher(
        "https://openrouter.ai/api/v1/models?output_modalities=speech",
        { signal: AbortSignal.timeout(10_000) },
      );
      if (!res.ok) throw new Error("Speech catalog unavailable");
      const bytes = await readBodyCapped(
        new Request("https://catalog.local", {
          method: "POST",
          body: res.body,
        }),
        2 * 1024 * 1024,
      );
      if (!bytes) throw new Error("Speech catalog too large");
      const models = parseSpeechModels(
        JSON.parse(new TextDecoder().decode(bytes)),
      );
      if (!models.length) throw new Error("Speech catalog empty");
      cached = { models, updatedAt: new Date().toISOString() };
      return cached;
    })();
    try {
      return await pending;
    } finally {
      pending = null;
    }
  };
}

async function requestSpeech(
  key: string,
  model: SpeechModel,
  voice: string,
  text: string,
  signal: AbortSignal,
  fetcher: SpeechFetch,
  pcm: boolean,
  options: SpeechOptions,
): Promise<Response> {
  const eleven = model.id.startsWith("elevenlabs/eleven-");
  const res = await fetcher("https://openrouter.ai/api/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model.id,
      ...speechDelivery(model.id, text, options),
      ...(voice ? { voice } : {}),
      response_format: pcm ? "pcm" : "mp3",
      ...(eleven
        ? {
            provider: {
              options: {
                elevenlabs: {
                  ...(pcm ? { output_format: "pcm_24000" } : {}),
                  ...(options.previousText
                    ? { previous_text: options.previousText.slice(-500) }
                    : {}),
                  ...(options.nextText
                    ? { next_text: options.nextText.slice(0, 500) }
                    : {}),
                },
              },
            },
          }
        : {}),
    }),
    signal,
  });
  if (!res.ok) {
    const recovery =
      res.status === 401 || res.status === 403
        ? "Check the server's OpenRouter API key and model access."
        : res.status === 402
          ? "Add OpenRouter credits or check the spending limit."
          : res.status === 429
            ? "OpenRouter is rate limiting speech. Try again shortly."
            : "Try another speech model or voice.";
    throw new SpeechError(
      `OpenRouter speech failed (${res.status}). ${recovery}`,
      res.status,
    );
  }
  if (!res.headers.get("Content-Type")?.startsWith("audio/"))
    throw new SpeechError(
      "OpenRouter returned no playable speech. Try another model or voice.",
    );
  return res;
}

/** Buffered files remain useful for previews and models without a known PCM format. */
export async function synthesizeSpeech(
  key: string,
  model: SpeechModel,
  voice: string,
  text: string,
  signal: AbortSignal,
  fetcher: SpeechFetch = fetch,
  options: SpeechOptions = {},
): Promise<Buffer> {
  const pcm = model.id.startsWith("google/gemini-");
  const res = await requestSpeech(
    key,
    model,
    voice,
    text,
    AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
    fetcher,
    pcm,
    options,
  );
  const bytes = await readBodyCapped(
    new Request("https://speech.local", { method: "POST", body: res.body }),
    4 * 1024 * 1024,
  );
  if (!bytes?.length)
    throw new SpeechError(
      "OpenRouter speech audio was empty or too large. Try another model.",
    );
  const audio = Buffer.from(bytes);
  if (!pcm) return audio;
  // Accept WAV if a provider starts returning a container instead of raw PCM.
  if (
    audio.toString("ascii", 0, 4) === "RIFF" &&
    audio.toString("ascii", 8, 12) === "WAVE"
  )
    return audio;
  if (audio.length % 2)
    throw new SpeechError(
      "OpenRouter returned invalid Gemini PCM audio. Try again.",
    );
  return Buffer.from(pcmWav(audio, 24000));
}
export type SpeechChunk = { audio: Buffer; sampleRate: number };

/** PCM is framed on sample boundaries; network chunks need not contain whole samples. */
export async function* streamSpeech(
  key: string,
  model: SpeechModel,
  voice: string,
  text: string,
  signal: AbortSignal,
  options: SpeechOptions = {},
  fetcher: SpeechFetch = fetch,
): AsyncGenerator<SpeechChunk> {
  if (!speechCapabilities(model.id).streaming)
    throw new SpeechError("This model has no supported streaming format.");
  const cancel = new AbortController();
  const combined = AbortSignal.any([
    signal,
    cancel.signal,
    AbortSignal.timeout(60_000),
  ]);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const res = await requestSpeech(
      key,
      model,
      voice,
      text,
      combined,
      fetcher,
      true,
      options,
    );
    const contentType = res.headers.get("content-type") ?? "";
    // Never play WAV headers, MP3 bytes, or a different PCM layout as raw samples.
    if (!/^audio\/pcm(?:;|$)/i.test(contentType) || !res.body)
      throw new SpeechError(
        "OpenRouter returned an unsupported streaming format. Try another model.",
      );
    const rate = /(?:^|;)\s*rate=(\d+)/i.exec(contentType)?.[1];
    const channels = /(?:^|;)\s*channels=(\d+)/i.exec(contentType)?.[1];
    if ((rate && rate !== "24000") || (channels && channels !== "1"))
      throw new SpeechError(
        "OpenRouter returned an unexpected PCM format. Try another model.",
      );
    reader = res.body.getReader();
    let pending = Buffer.alloc(0);
    let total = 0;
    let first = true;
    while (true) {
      combined.throwIfAborted();
      const { value, done } = await reader.read();
      combined.throwIfAborted();
      if (done) break;
      total += value.length;
      if (total > 4 * 1024 * 1024)
        throw new SpeechError(
          "Speech audio exceeded the streaming limit. Try a shorter reply.",
        );
      pending = Buffer.concat([pending, value]);
      if (first) {
        if (pending.length < 12) continue;
        first = false;
        if (pending.toString("ascii", 0, 4) === "RIFF")
          throw new SpeechError(
            "OpenRouter returned a WAV file instead of streaming PCM. Try another model.",
          );
      }
      // At most 100 ms per packet, allowing bounded playback credits in the relay.
      while (pending.length >= 2) {
        const size = Math.min(4800, pending.length - (pending.length % 2));
        const audio = Buffer.from(pending.subarray(0, size));
        pending = pending.subarray(size);
        yield { audio, sampleRate: 24000 };
        combined.throwIfAborted();
      }
    }
    if (!total || pending.length % 2)
      throw new SpeechError(
        "OpenRouter returned empty or incomplete PCM audio. Try again.",
      );
    if (pending.length) yield { audio: pending, sampleRate: 24000 };
  } finally {
    cancel.abort();
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
  }
}

export class SpeechError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "SpeechError";
  }
}
