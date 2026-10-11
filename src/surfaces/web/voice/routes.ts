import { json } from "../http.ts";
import type { RequestTimeouts } from "../server.ts";
import type { SurfaceActor } from "../../../orchestration/workspace/surface.ts";
import { publicModels, voiceConfigs } from "./providers.ts";
import { VoiceSession, type AskAgent } from "./session.ts";
import { createSpeechCatalog } from "./speech.ts";
import { TurnVoiceSession } from "./turnSession.ts";
export function createVoiceRoutes(
  env: Record<string, string | undefined>,
  ask: AskAgent,
  connect?: ConstructorParameters<typeof VoiceSession>[5],
  catalog = createSpeechCatalog(),
) {
  const configs = voiceConfigs(env);
  const speechKey =
    env.OPENROUTER_API_KEY?.trim() || env.OPENAI_API_KEY?.trim() || "";
  const sessions = new Set<VoiceSession | TurnVoiceSession>();
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
      const turnMode = url.searchParams.get("mode") === "turns";
      if (
        url.searchParams.has("mode") &&
        !["turns", "live"].includes(url.searchParams.get("mode")!)
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
      if (turnMode) {
        try {
          speechModel = (await catalog()).models.find(
            (m) => m.id === url.searchParams.get("model"),
          );
        } catch {
          return json({ error: "Speech catalog unavailable. Try again." }, 503);
        }
        if (!speechModel)
          return json({ error: "Unknown OpenRouter speech model" }, 400);
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
