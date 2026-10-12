import type { ServerWebSocket } from "bun";
import { transcribeAudio } from "../../../agent/transcribe.ts";
import { isSilentPcm, pcmWav } from "../../../agent/transcriptionAudio.ts";
import type { SurfaceActor } from "../../../orchestration/workspace/surface.ts";
import { type SpeechModel, SpeechError, synthesizeSpeech } from "./speech.ts";
import { getLogger } from "../../../logger.ts";
import {
  type AskAgent,
  type VoiceSocketData,
  VOICE_SESSION_MS,
  VOICE_BUFFER_MAX,
} from "./session.ts";

export class TurnVoiceSession {
  private client: ServerWebSocket<VoiceSocketData> | null = null;
  private chunks: Buffer[] = [];
  private bytes = 0;
  private busy = false;
  private closed = false;
  private abort = new AbortController();
  private deadline: ReturnType<typeof setTimeout> | null = null;
  private playback: (() => void) | null = null;
  constructor(
    private model: SpeechModel,
    private voice: string,
    private key: string,
    private actor: SurfaceActor,
    private conversation: string,
    private ask: AskAgent,
    private onclose: () => void,
    private transcribe = transcribeAudio,
    private speak = synthesizeSpeech,
  ) {}
  open(client: ServerWebSocket<VoiceSocketData>) {
    if (this.closed) return client.close(1000);
    this.client = client;
    this.deadline = setTimeout(
      () => this.fail("The 15-minute voice session ended. Start a new call."),
      VOICE_SESSION_MS,
    );
    this.emit({ type: "ready", inputRate: 16000 });
  }
  private emit(event: unknown) {
    if (this.closed || !this.client) return;
    if (this.client.getBufferedAmount() > VOICE_BUFFER_MAX) return this.close();
    this.client.send(JSON.stringify(event));
  }
  message(data: string | Buffer) {
    if (this.closed) return;
    if (data.length > 32000) return this.fail("Voice packet was too large.");
    try {
      const m = JSON.parse(data.toString());
      if (m.type === "playback_idle") {
        this.playback?.();
        return;
      }
      if (m.type === "interrupt") {
        // Accepted work remains in chat; interrupt only stops speech playback.
        this.playback?.();
        this.abort.abort();
        return;
      }
      if (m.type === "clear") {
        if (!this.busy) {
          this.chunks = [];
          this.bytes = 0;
        }
        return;
      }
      if (m.type === "commit") {
        if (!this.busy) void this.turn();
        return;
      }
      if (
        m.type !== "audio" ||
        typeof m.audio !== "string" ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(m.audio) ||
        m.audio.length % 4
      )
        return this.fail("Invalid voice audio packet.");
      if (this.busy) return;
      const pcm = Buffer.from(m.audio, "base64");
      if (!pcm.length || pcm.length % 2)
        return this.fail("Invalid voice audio packet.");
      this.bytes += pcm.length;
      if (this.bytes > 16000 * 2 * 5 * 60)
        return this.fail(
          "This voice turn reached five minutes. Start a new call.",
        );
      this.chunks.push(pcm);
    } catch {
      this.fail("Invalid voice audio packet.");
    }
  }
  private async turn() {
    const pcm = Buffer.concat(this.chunks);
    this.chunks = [];
    this.bytes = 0;
    this.busy = true;
    this.abort = new AbortController();
    const signal = this.abort.signal;
    let stage = "transcription";
    this.emit({ type: "agent", state: "working" });
    try {
      if (!pcm.length || isSilentPcm(pcm))
        throw new SpeechError(
          "No speech detected. Speak closer to the microphone and try again.",
        );
      const text = await this.transcribe(
        { data: pcmWav(pcm), mediaType: "audio/wav" },
        signal,
      );
      if (!text?.trim())
        throw new SpeechError("No words detected. Try speaking again.");
      if (this.closed) return;
      this.emit({
        type: "transcript",
        role: "user",
        text,
        final: true,
        replace: true,
      });
      stage = "agent";
      const result = await this.ask(
        text,
        this.actor,
        this.conversation,
        signal,
      );
      if (this.closed || signal.aborted) return;
      this.emit({
        type: "transcript",
        role: "assistant",
        text: result.slice(0, 24000),
        final: true,
        replace: true,
      });
      this.emit({ type: "agent", state: "done" });
      // Small utterances bound provider limits and avoid downloading a whole long reply before playback.
      const spoken = result.slice(0, 24000);
      stage = "speech";
      for (let at = 0; at < spoken.length;) {
        signal.throwIfAborted();
        let end = Math.min(at + 1000, spoken.length);
        if (end < spoken.length) {
          const boundary = spoken.lastIndexOf(" ", end);
          if (boundary > at + 500) end = boundary;
        }
        const audio = await this.speak(
          this.key,
          this.model,
          this.voice,
          spoken.slice(at, end),
          signal,
        );
        if (this.closed || signal.aborted) return;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            this.playback = null;
            resolve();
          }, 120_000);
          this.playback = () => {
            clearTimeout(timer);
            this.playback = null;
            resolve();
          };
          this.emit({ type: "audio_encoded", audio: audio.toString("base64") });
        });
        at = end;
      }
    } catch (error) {
      if (!this.closed && !signal.aborted) {
        getLogger("web/voice").warn(
          {
            stage,
            model: this.model.id,
            status: error instanceof SpeechError ? error.status : undefined,
          },
          "voice turn failed",
        );
        this.emit({
          type: "notice",
          message:
            error instanceof SpeechError
              ? error.message
              : stage === "speech"
                ? "OpenRouter speech couldn't finish. Your reply is in chat. Try another model or voice."
                : stage === "transcription"
                  ? "Couldn't transcribe your speech. Check the server's transcription API setup, or try again."
                  : "The agent couldn't finish this request. Check the conversation and try again.",
        });
      }
    } finally {
      this.busy = false;
      this.emit({ type: "agent", state: "done" });
      this.emit({ type: "turn_done" });
    }
  }
  private fail(message: string) {
    this.emit({ type: "error", message });
    this.close();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.abort.abort();
    this.playback?.();
    if (this.deadline) clearTimeout(this.deadline);
    this.chunks = [];
    this.bytes = 0;
    this.client?.close(1000, "Voice session ended");
    this.onclose();
  }
}
