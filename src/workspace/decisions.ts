import { z } from "zod";
import { getLogger } from "../logger.ts";

const log = getLogger("workspace.decisions");

/**
 * Decisions API models, tried in order. Providers retire pinned checkpoints without notice
 * (pplx-decider-v1.1-27b lost every endpoint when v1.2 shipped), so one pin is never the only option:
 * the `~…-latest` aliases follow their family, and other providers cover a family-wide outage.
 * Large-context models come first because the memory review state carries whole files.
 * Every fallback receives the same private review evidence through OpenRouter.
 */
export const DEFAULT_DECISION_MODELS = [
  "perplexity/pplx-decider-v1.2",
  "~perplexity/pplx-decider-latest",
  "~typesafe/jev-latest",
  "upstage/solar-decide",
  "cloudflare/clef-omni",
  "microsoft/microsoft-decision-1",
] as const;

/** Configured models first, then every default not already listed, so a stale pin can't strand review. */
export function decisionModels(configured: string | undefined): string[] {
  const listed = (configured ?? "").split(",").map(m => m.trim()).filter(Boolean);
  return [...new Set([...listed, ...DEFAULT_DECISION_MODELS])];
}

export type DecisionRequest = (url: URL, init: RequestInit) => Promise<Response>;

/**
 * Why a call returned no answers, safe to log and store: an HTTP status, `timeout`, `aborted`, `network`,
 * `invalid_json`, `schema_mismatch`, `missing_answers`, or `internal`. Never a provider body or private text.
 */
export type DecisionErrorClass = `http_${number}` | "timeout" | "aborted" | "network" | "invalid_json" | "schema_mismatch" | "missing_answers" | "internal";
export type DecisionAttempt = { model: string; errorClass: DecisionErrorClass };

/** Every model in the chain failed. `errorClass` is the last failure; `attempts` lists each one. */
export class DecisionsUnavailableError extends Error {
  constructor(readonly errorClass: DecisionErrorClass, readonly attempts: DecisionAttempt[]) {
    super(`decisions unavailable (${describeAttempts(attempts)})`);
    this.name = "DecisionsUnavailableError";
  }
}

export function describeAttempts(attempts: DecisionAttempt[]): string {
  return attempts.map(a => `${a.model} ${a.errorClass}`).join(", ") || "no attempts";
}

const responseSchema = z.object({
  model: z.string().min(1),
  answers: z.record(z.object({ type: z.literal("noul"), noul: z.number().finite().min(0).max(1) })),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    cost: z.number().finite().nonnegative().optional(),
  }).optional(),
});
export type DecisionResult = z.infer<typeof responseSchema> & { attempts: DecisionAttempt[] };

class AttemptError extends Error {
  constructor(readonly errorClass: DecisionErrorClass) { super(errorClass); }
}

/** No other model can fix the account: a bad key, no credits or a forbidden route. */
const FATAL = new Set(["http_401", "http_402", "http_403"]);
/** Worth one more try on the same model before moving on. */
const transient = (c: DecisionErrorClass) => c === "timeout" || c === "network" || c === "http_408" || c === "http_429" || /^http_5\d\d$/.test(c);

const ATTEMPT_TIMEOUT_MS = 60_000;
/** The whole chain must finish well inside the scheduler's interval. */
const BUDGET_MS = 180_000;
const RETRY_DELAY_MS = 2_000;

export type DecisionOptions = { request?: DecisionRequest; sleep?: (ms: number) => Promise<void>; now?: () => number };

/**
 * POSTs `{model, state, questions}` to OpenRouter's Decisions route and walks the model chain until one returns
 * a complete typed answer set: a retired model (404), a provider error or a malformed answer moves to the next.
 * Only `noul` questions are supported, and only the host-assigned failure class is ever recorded.
 */
export async function requestDecisions(
  config: { apiKey: string; baseUrl: string },
  models: readonly string[],
  state: unknown,
  questions: Record<string, { type: "noul"; instructions: string }>,
  opts: DecisionOptions = {},
): Promise<DecisionResult> {
  const request = opts.request ?? fetch;
  const sleep = opts.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const now = opts.now ?? Date.now;
  // Preserve a configured gateway's origin and prefix; never silently send its key elsewhere.
  const endpoint = new URL(config.baseUrl.replace(/\/$/, "") + "/");
  if (!endpoint.pathname.endsWith("/v1/")) throw new Error("Decisions API requires a base URL ending in /v1");
  endpoint.pathname = endpoint.pathname.replace(/v1\/$/, "alpha/decisions");
  const deadline = now() + BUDGET_MS;
  const attempts: DecisionAttempt[] = [];
  for (const model of models) {
    for (let tries = 0; tries < 2; tries++) {
      const remaining = deadline - now();
      if (remaining <= 0) throw new DecisionsUnavailableError(attempts.at(-1)?.errorClass ?? "timeout", attempts);
      try {
        const result = await attempt(request, endpoint, config.apiKey, model, state, questions, Math.min(ATTEMPT_TIMEOUT_MS, remaining));
        if (attempts.length) log.warn({ model, failed: describeAttempts(attempts) }, "decisions answered by a fallback model");
        return { ...result, attempts };
      } catch (error) {
        const errorClass = error instanceof AttemptError ? error.errorClass : abortClass(error) ?? "internal";
        attempts.push({ model, errorClass });
        log.warn({ model, errorClass }, "decisions attempt failed");
        if (FATAL.has(errorClass)) throw new DecisionsUnavailableError(errorClass, attempts);
        if (!transient(errorClass)) break;
        if (tries === 0) await sleep(RETRY_DELAY_MS);
      }
    }
  }
  throw new DecisionsUnavailableError(attempts.at(-1)?.errorClass ?? "internal", attempts);
}

async function attempt(request: DecisionRequest, endpoint: URL, apiKey: string, model: string, state: unknown,
  questions: Record<string, unknown>, timeoutMs: number): Promise<z.infer<typeof responseSchema>> {
  let response: Response;
  try {
    response = await request(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, state, questions }),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
  } catch (error) {
    throw new AttemptError(abortClass(error) ?? "network");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new AttemptError(`http_${response.status}`);
  }
  let body: unknown;
  try { body = await response.json(); }
  catch (error) { throw new AttemptError(abortClass(error) ?? "invalid_json"); }
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) throw new AttemptError("schema_mismatch");
  const keys = Object.keys(parsed.data.answers);
  if (keys.length !== Object.keys(questions).length || keys.some(key => !Object.hasOwn(questions, key))) throw new AttemptError("missing_answers");
  return parsed.data;
}

function abortClass(error: unknown): "timeout" | "aborted" | undefined {
  const name = error instanceof Error || error instanceof DOMException ? error.name : "";
  return name === "TimeoutError" ? "timeout" : name === "AbortError" ? "aborted" : undefined;
}
