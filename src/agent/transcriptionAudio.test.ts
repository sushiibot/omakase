import { expect, test } from "bun:test";
import { decodeTranscriptionAudio, isSilentPcm, pcmWav, segmentPcm, TRANSCRIPTION_MAX_BYTES, TranscriptionError } from "./transcriptionAudio.ts";
import { transcribeRecording } from "./transcribe.ts";

function tone(seconds: number) {
  const pcm = Buffer.alloc(seconds * 16000 * 2);
  for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(Math.round(1000 * Math.sin(i / 5)), i * 2);
  return pcm;
}

test("chunks keep all audio, split at a pause and stay under provider byte/duration caps", () => {
  const pcm = tone(920);
  pcm.fill(0, 440 * 16000 * 2, 442 * 16000 * 2);
  const chunks = segmentPcm(pcm);
  expect(chunks).toHaveLength(3);
  expect(chunks[0]!.length / 32000).toBeGreaterThan(440);
  expect(chunks[0]!.length / 32000).toBeLessThan(442);
  expect(Buffer.compare(Buffer.concat(chunks), pcm)).toBe(0);
  for (const chunk of chunks) {
    expect(chunk.length).toBeLessThanOrEqual(450 * 32000);
    expect(pcmWav(chunk).byteLength).toBeLessThan(25 * 1024 * 1024);
  }
});

test("digital silence gate preserves even very quiet signals", () => {
  expect(isSilentPcm(Buffer.alloc(32000))).toBe(true);
  const pcm = Buffer.alloc(32000);
  pcm.writeInt16LE(2, 100);
  expect(isSilentPcm(pcm)).toBe(false);
});

test("real ffmpeg decodes WAV without dropping samples", async () => {
  const pcm = tone(1);
  const decoded = await decodeTranscriptionAudio(pcmWav(pcm), AbortSignal.timeout(5000));
  expect(Buffer.compare(decoded, pcm)).toBe(0);
});

test("browser WebM, Discord Ogg and Safari MP4 containers decode with the restricted demuxers", async () => {
  for (const [format, codec, extra] of [
    ["webm", "libopus", []], ["ogg", "libopus", []], ["mp4", "aac", ["-movflags", "frag_keyframe+empty_moov"]],
  ] as const) {
    const proc = Bun.spawn({
      cmd: ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", "pipe:0", "-c:a", codec, ...extra, "-f", format, "pipe:1"],
      stdin: "pipe", stdout: "pipe", stderr: "ignore",
    });
    proc.stdin.write(new Uint8Array(pcmWav(tone(1))));
    proc.stdin.end();
    const encoded = await new Response(proc.stdout).arrayBuffer();
    expect(await proc.exited).toBe(0);
    const pcm = await decodeTranscriptionAudio(encoded, AbortSignal.timeout(5000));
    expect(pcm.length).toBeGreaterThan(30000);
    expect(isSilentPcm(pcm)).toBe(false);
  }
});

test("short recordings keep their original container and filename", async () => {
  const audio = { data: pcmWav(tone(1)), mediaType: "audio/wav", filename: "original.wav" };
  expect(await transcribeRecording(audio, { upload: async (uploaded) => {
    expect(uploaded).toBe(audio);
    return "  hello  ";
  } })).toBe("hello");
});

test("silent take skips paid upload only when enabled", async () => {
  let calls = 0;
  const audio = { data: pcmWav(Buffer.alloc(32000)), mediaType: "audio/wav" };
  const upload = async () => { calls++; return "hallucinated text"; };
  expect(await transcribeRecording(audio, { upload, skipSilence: true })).toBeNull();
  expect(calls).toBe(0);
  expect(await transcribeRecording(audio, { upload })).toBe("hallucinated text");
  expect(calls).toBe(1);
});

test("long takes upload in order; a failed segment never returns a partial transcript", async () => {
  const audio = { data: pcmWav(tone(451)), mediaType: "audio/wav" };
  let calls = 0;
  expect(await transcribeRecording(audio, { upload: async (chunk) => {
    expect(chunk.mediaType).toBe("audio/wav");
    expect(chunk.data.byteLength).toBeLessThan(25 * 1024 * 1024);
    return `part ${++calls}`;
  } })).toBe("part 1\npart 2");
  calls = 0;
  await expect(transcribeRecording(audio, { upload: async () => {
    if (++calls === 2) throw new TranscriptionError("provider failed");
    return "incomplete";
  } })).rejects.toThrow("provider failed");
});

test("invalid, oversized and cancelled audio never reach paid upload", async () => {
  let calls = 0;
  const upload = async () => { calls++; return "text"; };
  await expect(transcribeRecording({ data: new ArrayBuffer(3), mediaType: "audio/wav" }, { upload })).rejects.toThrow(TranscriptionError);
  await expect(transcribeRecording({ data: new ArrayBuffer(TRANSCRIPTION_MAX_BYTES + 1), mediaType: "audio/wav" }, { upload })).rejects.toThrow("input limit");
  await expect(transcribeRecording({ data: pcmWav(tone(1)), mediaType: "audio/wav" }, { upload, signal: AbortSignal.abort() })).rejects.toThrow();
  expect(calls).toBe(0);
});

test("audio over the duration limit is rejected instead of silently truncated", async () => {
  // 8 kHz input fits the byte limit but decodes past the duration limit.
  const wav = Buffer.from(pcmWav(Buffer.alloc(1801 * 8000 * 2)));
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  await expect(decodeTranscriptionAudio(wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer, AbortSignal.timeout(10000))).rejects.toThrow("30-minute");
});

test("cancellation between chunks stops subsequent paid uploads", async () => {
  const controller = new AbortController();
  let calls = 0;
  await expect(transcribeRecording({ data: pcmWav(tone(451)), mediaType: "audio/wav" }, {
    signal: controller.signal,
    upload: async () => { calls++; controller.abort(); return "first"; },
  })).rejects.toThrow();
  expect(calls).toBe(1);
});
