import { join } from "node:path";
import { ownerName, ownerUpdateParams, RPC_METHODS, type WorkspaceRegisterResult } from "../orchestration/contracts.ts";
import type { WorkspaceConfig } from "./config.ts";
import { readJson, writeFileAtomic } from "./files.ts";

// Kept across restarts, so sessions built at boot, before the bot's register result, already have it.
const OWNER_FILE = "owner.json";

/** Reads the name the bot last sent into `config`. */
export function loadOwnerName(config: WorkspaceConfig): void {
  const saved = ownerName.safeParse(readJson<{ name?: unknown }>(join(config.stateDir, OWNER_FILE))?.name);
  if (saved.success) config.ownerName = saved.data;
}

/** Returns whether the name changed. */
function setOwnerName(config: WorkspaceConfig, name: string | null): boolean {
  if ((config.ownerName ?? null) === name) return false;
  if (name) config.ownerName = name;
  else delete config.ownerName;
  writeFileAtomic(join(config.stateDir, OWNER_FILE), JSON.stringify({ name }));
  return true;
}

/** A register result without the field comes from an older bot, so the name already held stays. */
export function applyRegisteredOwnerName(config: WorkspaceConfig, result: Pick<WorkspaceRegisterResult, "ownerName">, onChange?: () => void): void {
  if (result.ownerName !== undefined && setOwnerName(config, result.ownerName)) onChange?.();
}

/** `owner/update`: the owner changed their name in the app. */
export function ownerHandlers(config: WorkspaceConfig, onChange?: () => void): Record<string, (params: unknown) => Promise<unknown>> {
  return {
    [RPC_METHODS.ownerUpdate]: async (p: unknown) => {
      const q = ownerUpdateParams.parse(p);
      if (q.principalId !== config.principalId) throw new Error("principal mismatch");
      if (setOwnerName(config, q.name)) onChange?.();
      return { ok: true };
    },
  };
}
