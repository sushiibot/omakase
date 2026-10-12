import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export class TranscriptionError extends Error {}
export const TRANSCRIPTION_MAX_BYTES = 50 * 1024 * 1024;
export const TRANSCRIPTION_MAX_SECONDS = 30 * 60;
const RATE = 16000;
const WINDOW = RATE / 10;
const SEGMENT_SAMPLES = 450 * RATE;

/** PCM chunks retain every sample. Prefer a quiet boundary in the last 15 seconds. */
export function segmentPcm(pcm: Buffer): Buffer[] {
  const chunks: Buffer[] = [];
  let start = 0;
  const samples = pcm.length / 2;
  while (start < samples) {
    let end = Math.min(start + SEGMENT_SAMPLES, samples);
    if (end < samples) {
      for (let at = end - WINDOW; at >= end - 15 * RATE; at -= WINDOW) {
        let quiet = true;
        for (let i = at; i < at + WINDOW; i++) {
          if (Math.abs(pcm.readInt16LE(i * 2)) > 32) { quiet = false; break; }
        }
        if (quiet) { end = at + WINDOW / 2; break; }
      }
    }
    chunks.push(pcm.subarray(start * 2, end * 2));
    start = end;
  }
  return chunks;
}

/** Only digital silence is rejected; low-volume speech and background noise pass through. */
export function isSilentPcm(pcm: Buffer): boolean {
  for (let at = 0; at < pcm.length; at += 2)
    if (Math.abs(pcm.readInt16LE(at)) > 1) return false;
  return true;
}

export function pcmWav(pcm: Buffer, sampleRate = RATE): ArrayBuffer {
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + pcm.length, 4);
  wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44);
  return wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer;
}

/** Decode locally under byte, duration and time limits, before any paid upload. */
export async function decodeTranscriptionAudio(data: ArrayBuffer, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted();
  if (!data.byteLength || data.byteLength > TRANSCRIPTION_MAX_BYTES)
    throw new TranscriptionError("audio is empty or exceeds the 50 MiB input limit");
  const dir = await mkdtemp(join(tmpdir(), "sushii-stt-"));
  try {
    const input = join(dir, "input");
    const output = join(dir, "audio.pcm");
    await writeFile(input, new Uint8Array(data));
    signal.throwIfAborted();
    const proc = Bun.spawn({
      cmd: ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file,pipe",
        "-format_whitelist", "wav,ogg,mp3,mov,matroska,webm,flac,aac", "-i", input,
        "-map", "0:a:0", "-vn", "-t", String(TRANSCRIPTION_MAX_SECONDS + 1), "-ac", "1", "-ar", String(RATE), "-f", "s16le", output],
      stdout: "ignore", stderr: "ignore",
    });
    const abort = () => proc.kill();
    signal.addEventListener("abort", abort, { once: true });
    try {
      if (signal.aborted) abort();
      const code = await proc.exited;
      signal.throwIfAborted();
      if (code !== 0) throw new TranscriptionError("couldn't decode audio for transcription");
    } finally { signal.removeEventListener("abort", abort); }
    const pcm = await readFile(output);
    if (pcm.length > TRANSCRIPTION_MAX_SECONDS * RATE * 2)
      throw new TranscriptionError("audio exceeds the 30-minute transcription limit");
    if (!pcm.length || pcm.length % 2) throw new TranscriptionError("audio contains no decodable samples");
    return pcm;
  } catch (err) {
    if (signal.aborted || err instanceof TranscriptionError) throw err;
    throw new TranscriptionError("couldn't prepare audio for transcription; check ffmpeg installation");
  } finally { await rm(dir, { recursive: true, force: true }); }
}
