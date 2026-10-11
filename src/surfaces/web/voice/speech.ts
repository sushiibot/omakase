import { readBodyCapped } from "../http.ts";
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
  price: {
    unit: "characters" | "tokens" | "seconds";
    input: number | null;
    output: number | null;
  };
}
const curated: Record<string, string> = {
  "hexgrad/kokoro-82m": "Budget",
  "google/gemini-3.8-flash-lite-tts": "Value candidate",
  "qwen/qwen-audio-3.0-tts-flash": "Fast candidate",
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

/** MP3 lets the browser decode each provider's sample rate correctly. */
export async function synthesizeSpeech(
  key: string,
  model: SpeechModel,
  voice: string,
  text: string,
  signal: AbortSignal,
  fetcher: SpeechFetch = fetch,
): Promise<Buffer> {
  const res = await fetcher("https://openrouter.ai/api/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model.id,
      input: text,
      ...(voice ? { voice } : {}),
      response_format: "mp3",
    }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
  });
  if (!res.ok || !res.headers.get("Content-Type")?.startsWith("audio/"))
    throw new Error("Speech generation failed");
  const bytes = await readBodyCapped(
    new Request("https://speech.local", { method: "POST", body: res.body }),
    4 * 1024 * 1024,
  );
  if (!bytes?.length) throw new Error("Speech audio unavailable");
  return Buffer.from(bytes);
}
