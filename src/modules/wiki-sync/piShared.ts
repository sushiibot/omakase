import { getLogger } from "../../logger.ts";

const log = getLogger("wiki-sync:pi:model");

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const MODEL_METADATA_TIMEOUT_MS = 5000;

interface CatalogModel {
  id: string;
  contextWindow: number;
  image: boolean;
}

type RawCatalogEntry = {
  id: string;
  context_length?: number;
  architecture?: { input_modalities?: string[] };
};

const CATALOG_TTL_MS = 10 * 60_000;
/** An unreadable catalog is remembered this long, so an outage doesn't cost every caller a timeout. */
const CATALOG_FAILURE_TTL_MS = 60_000;
let catalogCache: { at: number; models: CatalogModel[] } | null = null;
let catalogFailure: { at: number; error: Error } | null = null;
let catalogInFlight: Promise<CatalogModel[]> | null = null;

/** OpenRouter's model catalog, cached for ten minutes; throws when it can't be read. */
export async function openRouterCatalog(now = Date.now()): Promise<CatalogModel[]> {
  if (catalogCache && now - catalogCache.at < CATALOG_TTL_MS) return catalogCache.models;
  if (catalogFailure && now - catalogFailure.at < CATALOG_FAILURE_TTL_MS) throw catalogFailure.error;
  catalogInFlight ??= fetchCatalog(now)
    .catch((err: unknown) => {
      catalogFailure = { at: now, error: err instanceof Error ? err : new Error(String(err)) };
      throw catalogFailure.error;
    })
    .finally(() => {
      catalogInFlight = null;
    });
  return catalogInFlight;
}

async function fetchCatalog(now: number): Promise<CatalogModel[]> {
  const res = await fetch(OPENROUTER_MODELS_URL, { signal: AbortSignal.timeout(MODEL_METADATA_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`OpenRouter models catalog returned ${res.status}`);
  const payload = (await res.json()) as { data?: RawCatalogEntry[] };
  const models = (payload.data ?? [])
    .filter((m) => typeof m.id === "string" && (m.context_length ?? 0) > 0)
    .map((m) => ({
      id: m.id,
      contextWindow: m.context_length!,
      image: m.architecture?.input_modalities?.includes("image") === true,
    }));
  catalogCache = { at: now, models };
  catalogFailure = null;
  return models;
}

/** Test seam: forget the cached catalog and any remembered failure. */
export function clearOpenRouterCatalog(): void {
  catalogCache = null;
  catalogFailure = null;
  catalogInFlight = null;
}

/**
 * The model's real context window from OpenRouter's catalog: a max_tokens equal to the full window makes
 * every prompt overflow. Falls back to `fallback` when the catalog can't be read; an unknown window throws.
 */
export async function resolveModelInfo(modelId: string, fallback: number): Promise<{ contextWindow: number; image: boolean; resolved: boolean }> {
  try {
    const entry = (await openRouterCatalog()).find((m) => m.id === modelId);
    if (!entry) throw new Error(`model ${modelId} missing from the catalog`);
    log.info({ modelId, contextWindow: entry.contextWindow, image: entry.image }, "resolved model metadata from OpenRouter");
    return { contextWindow: entry.contextWindow, image: entry.image, resolved: true };
  } catch (err) {
    if (!Number.isFinite(fallback) || fallback <= 0) {
      log.error({ modelId, err }, "cannot determine model context window; refusing to run without auto-compaction");
      throw new Error(`Cannot determine context window for ${modelId}`, { cause: err });
    }
    log.warn({ modelId, err, fallback }, "failed to resolve context window from OpenRouter catalog; using known fallback window");
    return { contextWindow: fallback, image: false, resolved: false };
  }
}

/** Pi triggers compaction at `contextWindow - reserveTokens`; the trigger is capped at this share of the window. */
export const COMPACT_MAX_FILL = 0.75;

/** reserveTokens that puts Pi's compaction trigger at `compactTokens`, at most COMPACT_MAX_FILL of the window. */
export function reserveTokensFor(contextWindow: number, compactTokens: number): number {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) throw new Error(`Cannot auto-compact: unknown model context window (${contextWindow})`);
  return contextWindow - Math.min(compactTokens, Math.floor(contextWindow * COMPACT_MAX_FILL));
}

export function autoCompactionSettings(models: readonly { provider: string; id: string; contextWindow: number }[]) {
  if (!models.length) throw new Error("Cannot auto-compact without a model");
  const modelOverrides = Object.fromEntries(
    models.map((m) => [
      `${m.provider}/${m.id}`,
      {
        reserveTokens: reserveTokensFor(m.contextWindow, Infinity),
        keepRecentTokens: Math.min(20_000, Math.floor(m.contextWindow * 0.1)),
      },
    ]),
  );
  return {
    enabled: true,
    ...modelOverrides[`${models[0]!.provider}/${models[0]!.id}`]!,
    modelOverrides,
  };
}

type ToolSetSession = { getAllTools(): ReadonlyArray<{ name: string }>; getActiveToolNames(): string[]; dispose(): void };

/**
 * Throws (disposing the session) unless the session registered and activated exactly `expected`. Pi ships
 * codemode, tool_search and MCP as built-in extensions; this keeps any of them from reaching the model unnoticed.
 */
export function assertExactTools(session: ToolSetSession, expected: readonly string[], label: string): void {
  const want = [...expected].sort();
  const registered = session.getAllTools().map((t) => t.name).sort();
  const active = [...session.getActiveToolNames()].sort();
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((n, i) => n === b[i]);
  if (same(registered, want) && same(active, want)) return;
  session.dispose();
  throw new Error(`${label}: unexpected pi tool set (registered ${registered.join(",")}; active ${active.join(",")}; want ${want.join(",")})`);
}
