import { z } from "zod";
import { OWNER_NAME_MAX, ownerName } from "../../orchestration/contracts.ts";
import { getLogger } from "../../logger.ts";
import { isJson, json, readJson } from "./http.ts";

const log = getLogger("web/settings");

export const OWNER_NAME_PATH = "/api/settings/owner-name";

export interface OwnerNameSource {
  get(): string | null;
  set(name: string | null): void;
}

export interface SettingsRoutes {
  /** Null for a path outside /api/settings. */
  handle(req: Request, path: string): Promise<Response | null>;
}

const body = z.object({ name: z.string().max(1000).nullable() });

/** Null, an empty string or whitespace clears the name; anything else must pass the `ownerName` contract. */
export function parseOwnerNameInput(raw: unknown): { ok: true; name: string | null } | { ok: false; error: string } {
  const parsed = body.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Send a name, or null to clear it." };
  const value = parsed.data.name?.trim() ?? "";
  if (!value) return { ok: true, name: null };
  if (value.length > OWNER_NAME_MAX) return { ok: false, error: `Use ${OWNER_NAME_MAX} characters or fewer.` };
  const name = ownerName.safeParse(value);
  return name.success ? { ok: true, name: name.data } : { ok: false, error: "Use one line, without control or invisible characters." };
}

/** GET and POST /api/settings/owner-name → {name}. A saved change goes to the workspace through `onChange`. */
export function createSettingsRoutes(deps: { ownerName: OwnerNameSource; onChange?: (name: string | null) => Promise<void> | void }): SettingsRoutes {
  return {
    async handle(req, path) {
      if (path !== OWNER_NAME_PATH) return null;
      if (req.method === "GET") return json({ name: deps.ownerName.get() });
      if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
      if (!isJson(req)) return json({ error: "content-type must be application/json" }, 415);
      const raw = await readJson(req);
      if (raw instanceof Response) return raw;
      const input = parseOwnerNameInput(raw);
      if (!input.ok) return json({ error: input.error }, 422);
      deps.ownerName.set(input.name);
      // Not awaited: the save is done, and the workspace reads the name again when it next registers.
      void Promise.resolve()
        .then(() => deps.onChange?.(input.name))
        .catch((err) => log.warn({ err }, "sending the owner name to the workspace failed"));
      return json({ name: input.name });
    },
  };
}
