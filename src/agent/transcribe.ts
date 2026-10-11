import { config } from "../config.ts";
import { getLogger } from "../logger.ts";
import { decodeTranscriptionAudio, isSilentPcm, pcmWav, segmentPcm, TranscriptionError } from "./transcriptionAudio.ts";
export { TranscriptionError } from "./transcriptionAudio.ts";

const logger = getLogger("agent/transcribe");

export interface TranscribableAudio {
  data: ArrayBuffer;
  mediaType: string; // e.g. "audio/ogg"
  filename?: string;
}

/** Speech-to-text via OpenRouter's dedicated Whisper transcription endpoint (`/audio/transcriptions`,
 *  OpenAI-compatible multipart form), reusing the bot's OpenRouter key. A real ASR model, not an LLM —
 *  cheaper per second and more accurate than routing audio through a chat model. The transcript; null
 *  when the audio held no words. Throws TranscriptionError when the request failed, so a caller can tell
 *  "nothing said" from "try again". */
export async function transcribeAudio(audio: TranscribableAudio, signal?: AbortSignal): Promise<string | null> {
  try {
    return await transcribeRecording(audio, {
      signal,
      skipSilence: ["1", "true", "yes"].includes((process.env.TRANSCRIPTION_SKIP_SILENCE ?? "").toLowerCase()),
      upload: uploadAudio,
    });
  } catch (err) {
    if (err instanceof TranscriptionError) throw err;
    throw new TranscriptionError("transcription was cancelled or timed out");
  }
}

/** A failed segment rejects the entire take; callers never receive an incomplete transcript. */
export async function transcribeRecording(audio: TranscribableAudio, deps: {
  signal?: AbortSignal;
  skipSilence?: boolean;
  upload: (audio: TranscribableAudio, signal: AbortSignal) => Promise<string | null>;
}): Promise<string | null> {
  const signal = AbortSignal.any([...(deps.signal ? [deps.signal] : []), AbortSignal.timeout(5 * 60_000)]);
  const pcm = await decodeTranscriptionAudio(audio.data, AbortSignal.any([signal, AbortSignal.timeout(30_000)]));
  if (deps.skipSilence && isSilentPcm(pcm)) return null;
  const chunks = segmentPcm(pcm);
  // Keep compact browser/Discord recordings intact when they already fit.
  if (chunks.length === 1 && audio.data.byteLength < 24_000_000) {
    signal.throwIfAborted();
    const text = await deps.upload(audio, signal);
    signal.throwIfAborted();
    return text?.trim() || null;
  }
  const texts: string[] = [];
  for (const chunk of chunks) {
    signal.throwIfAborted();
    const text = await deps.upload({ data: pcmWav(chunk), mediaType: "audio/wav", filename: "voice-segment.wav" }, signal);
    signal.throwIfAborted();
    if (text?.trim()) texts.push(text.trim());
  }
  return texts.length ? texts.join("\n") : null;
}

async function uploadAudio(audio: TranscribableAudio, signal: AbortSignal): Promise<string | null> {
  const form = new FormData();
  form.append("file", new Blob([audio.data], { type: audio.mediaType }), audio.filename ?? "voice-message.ogg");
  form.append("model", config.transcriptionModel);
  let res: Response;
  try {
    res = await fetch(`${config.openaiBaseUrl.replace(/\/$/, "")}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.openaiApiKey}` },
      body: form,
      ...(signal ? { signal } : {}),
    });
  } catch (err) {
    throw new TranscriptionError(`transcription request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) {
    logger.warn({ status: res.status, body: (await res.text().catch(() => "")).slice(0, 300) }, "transcription request failed");
    throw new TranscriptionError(`transcription request failed: ${res.status}`);
  }
  const json = (await res.json().catch(() => null)) as { text?: unknown } | null;
  if (!json || typeof json.text !== "string") throw new TranscriptionError("transcription answer had no text field");
  const text = json.text.trim();
  return text ? text : null;
}
