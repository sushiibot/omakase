import { json, readJson } from "../http.ts";
import type { RequestTimeouts } from "../server.ts";
import type { SurfaceActor } from "../../../orchestration/workspace/surface.ts";
import { publicModels, voiceConfigs } from "./providers.ts";
import { VoiceSession, type AskAgent } from "./session.ts";
import {
  createSpeechCatalog,
  synthesizeSpeech,
  SpeechError,
} from "./speech.ts";
import { speechCapabilities, validDelivery } from "./speechCapabilities.ts";
import { TurnVoiceSession } from "./turnSession.ts";
export function createVoiceRoutes(
  env: Record<string, string | undefined>,
  ask: AskAgent,
  connect?: ConstructorParameters<typeof VoiceSession>[5],
  catalog = createSpeechCatalog(),
  speak = synthesizeSpeech,
) {
  const configs = voiceConfigs(env);
  const speechKey =
    env.OPENROUTER_API_KEY?.trim() || env.OPENAI_API_KEY?.trim() || "";
  const sessions = new Set<VoiceSession | TurnVoiceSession>();
  let previewBusy = false;
  const previews = new Map<string, { audio: Buffer; expires: number }>();
  return {
    async handle(
      req: Request,
      path: string,
      actor: SurfaceActor,
      server?: RequestTimeouts,
    ): Promise<Response | null> {
      if (path === "/api/voice/models") {
        if (req.method !== "GET")
          return json({ error: "method not allowed" }, 405);
        const models = publicModels(configs);
        return json({
          models,
          defaultProvider: models.find((m) => m.configured)?.id ?? null,
        });
      }
      if (path === "/api/voice/speech-models") {
        if (req.method !== "GET")
          return json({ error: "method not allowed" }, 405);
        try {
          return json({ ...(await catalog()), configured: !!speechKey });
        } catch {
          return json(
            { error: "Couldn't load OpenRouter speech models. Try again." },
            503,
          );
        }
      }
      if (path === "/api/voice/preview") {
        if (req.method !== "POST")
          return json({ error: "method not allowed" }, 405);
        if (!speechKey)
          return json(
            { error: "OpenRouter speech credentials are not configured" },
            503,
          );
        if (sessions.size || previewBusy)
          return json(
            { error: "End the call or wait for the current preview." },
            409,
          );
        const body = await readJson(req, 4096);
        if (body instanceof Response) return body;
        if (
          !body ||
          typeof body !== "object" ||
          !("model" in body) ||
          typeof body.model !== "string" ||
          !("voice" in body) ||
          typeof body.voice !== "string"
        )
          return json({ error: "Choose a speech model and voice." }, 400);
        const delivery = "delivery" in body ? body.delivery : "";
        if (!validDelivery(delivery))
          return json(
            {
              error:
                "Use up to 300 characters without brackets or line breaks for voice delivery.",
            },
            400,
          );
        if (sessions.size || previewBusy)
          return json(
            { error: "End the call or wait for the current preview." },
            409,
          );
        previewBusy = true;
        try {
          const model = (await catalog()).models.find(
            (m) => m.id === body.model,
          );
          if (!model)
            return json({ error: "Unknown OpenRouter speech model" }, 400);
          if (body.voice && !model.voices.includes(body.voice))
            return json({ error: "Unknown speech voice" }, 400);
          if (delivery && !speechCapabilities(model.id).expression)
            return json(
              { error: "This model does not support delivery instructions." },
              400,
            );
          const id = JSON.stringify([model.id, body.voice, delivery]);
          const cached = previews.get(id);
          const audio =
            cached && cached.expires > Date.now()
              ? cached.audio
              : await speak(
                  speechKey,
                  model,
                  body.voice,
                  "Hi, I'm Sushii. What would you like to work on?",
                  req.signal,
                  undefined,
                  { delivery },
                );
          if (!cached || cached.expires <= Date.now()) {
            previews.delete(id);
            previews.set(id, { audio, expires: Date.now() + 5 * 60_000 });
            if (previews.size > 6)
              previews.delete(previews.keys().next().value!);
          }
          return new Response(new Uint8Array(audio), {
            headers: {
              "Content-Type": model.id.startsWith("google/gemini-")
                ? "audio/wav"
                : "audio/mpeg",
              "Cache-Control": "no-store",
            },
          });
        } catch (error) {
          return json(
            {
              error:
                error instanceof SpeechError
                  ? error.message
                  : "Couldn't preview this voice through OpenRouter. Try another voice.",
            },
            502,
          );
        } finally {
          previewBusy = false;
        }
      }
      if (path !== "/api/voice/connect") return null;
      if (
        req.method !== "GET" ||
        req.headers.get("Upgrade")?.toLowerCase() !== "websocket"
      )
        return json({ error: "websocket required" }, 400);
      // WebSocket upgrades don't use the POST CSRF check. Require the browser's exact Origin here.
      let origin: URL;
      try {
        origin = new URL(req.headers.get("Origin") ?? "");
      } catch {
        return json({ error: "forbidden" }, 403);
      }
      if (
        (req.headers.has("Sec-Fetch-Site") &&
          req.headers.get("Sec-Fetch-Site") !== "same-origin") ||
        origin.host !== new URL(req.url).host ||
        !["https:", "http:"].includes(origin.protocol)
      )
        return json({ error: "forbidden" }, 403);
      const url = new URL(req.url);
      const readOnly = url.searchParams.get("mode") === "read";
      const turnMode = readOnly || url.searchParams.get("mode") === "turns";
      if (
        url.searchParams.has("mode") &&
        !["turns", "live", "read"].includes(url.searchParams.get("mode")!)
      )
        return json({ error: "Unknown voice mode" }, 400);
      const provider = configs.find(
        (c) => c.id === url.searchParams.get("provider"),
      );
      if (!turnMode && !provider)
        return json({ error: "Unknown voice provider" }, 400);
      if (turnMode ? !speechKey : !provider!.configured)
        return json(
          { error: "Voice provider credentials are not configured" },
          503,
        );
      const conversation = url.searchParams.get("conversation") ?? "main";
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(conversation))
        return json({ error: "Invalid conversation" }, 400);
      if (sessions.size)
        return json(
          { error: "End the current voice call before starting another" },
          409,
        );
      let speechModel;
      const speechVoice = url.searchParams.get("voice") ?? "";
      const delivery = url.searchParams.get("delivery") ?? "";
      if (turnMode) {
        if (!validDelivery(delivery))
          return json({ error: "Invalid voice delivery instructions" }, 400);
        try {
          speechModel = (await catalog()).models.find(
            (m) => m.id === url.searchParams.get("model"),
          );
        } catch {
          return json({ error: "Speech catalog unavailable. Try again." }, 503);
        }
        if (!speechModel)
          return json({ error: "Unknown OpenRouter speech model" }, 400);
        if (delivery && !speechCapabilities(speechModel.id).expression)
          return json(
            { error: "This model does not support delivery instructions." },
            400,
          );
        if (speechVoice && !speechModel.voices.includes(speechVoice))
          return json({ error: "Unknown speech voice" }, 400);
        // Catalog fetch above can yield; recheck the single-session limit before reserving.
        if (sessions.size)
          return json(
            { error: "End the current voice call before starting another" },
            409,
          );
      }
      const session: VoiceSession | TurnVoiceSession = turnMode
        ? new TurnVoiceSession(
            speechModel!,
            speechVoice,
            speechKey,
            actor,
            conversation,
            ask,
            () => sessions.delete(session),
            undefined,
            speak,
            { delivery },
            undefined,
            readOnly,
          )
        : new VoiceSession(
            provider!,
            actor,
            conversation,
            ask,
            () => sessions.delete(session),
            connect,
          );
      sessions.add(session);
      if (!server?.upgrade?.(req, { voice: session })) {
        session.close();
        return json({ error: "Couldn't start voice connection" }, 503);
      }
      // The server's fetch wrapper discards this response after a successful upgrade.
      return new Response(null, { status: 204 });
    },
    close() {
      for (const session of sessions) session.close();
    },
  };
}
export type VoiceRoutes = ReturnType<typeof createVoiceRoutes>;
