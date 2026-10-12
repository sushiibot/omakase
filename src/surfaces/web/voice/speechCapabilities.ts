// Capabilities of our OpenRouter route, not every feature of the upstream model.
// Sources: openrouter.ai/docs/guides/overview/multimodal/tts and
// openrouter.ai/blog/announcements/elevenlabs-on-openrouter (2026-10-12).
export function speechCapabilities(id: string) {
  const eleven = id.startsWith("elevenlabs/eleven-");
  const gemini = id.startsWith("google/gemini-") && id.includes("tts");
  const tags = /^elevenlabs\/eleven-v[34](?:-turbo|-conversational)?$/.test(id);
  return {
    expression: tags
      ? ("tags" as const)
      : gemini || id.startsWith("openai/gpt-4o-mini-tts")
        ? ("instructions" as const)
        : null,
    // Only enable raw playback where the output rate and PCM16 mono format are documented.
    streaming: eleven || gemini,
  };
}

export interface SpeechOptions {
  delivery?: string;
  previousText?: string;
  nextText?: string;
}

export function validDelivery(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 300 &&
    !/[\[\]\x00-\x1f]/.test(value)
  );
}

export function speechDelivery(
  id: string,
  text: string,
  options: SpeechOptions,
) {
  const expression = speechCapabilities(id).expression;
  const delivery = options.delivery?.trim() ?? "";
  if (!validDelivery(delivery))
    throw new Error("Invalid speech delivery instructions");
  return {
    input: expression === "tags" && delivery ? `[${delivery}] ${text}` : text,
    ...(expression === "instructions" && delivery
      ? { instructions: delivery }
      : {}),
  };
}
