import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";

const BASE_MS = 5_000;
const MAX_MS = 5 * 60_000;
const RESET_AFTER_MS = 10 * 60_000;

interface CrashState {
  count: number;
  at: number;
}

export function nextCrashDelay(prev: CrashState | null, now: number): { delayMs: number; state: CrashState } {
  const count = prev && now - prev.at < RESET_AFTER_MS ? prev.count + 1 : 1;
  return { delayMs: Math.min(BASE_MS * 2 ** (count - 1), MAX_MS), state: { count, at: now } };
}

// State lives in the container's writable layer: survives docker restarts, resets on redeploy.
export async function exitAfterBackoff(name: string, code = 1): Promise<never> {
  const file = join(tmpdir(), `crash-backoff-${name}.json`);
  let prev: CrashState | null = null;
  try {
    prev = JSON.parse(readFileSync(file, "utf8")) as CrashState;
  } catch {}
  const { delayMs, state } = nextCrashDelay(prev, Date.now());
  try {
    writeFileSync(file, JSON.stringify(state));
  } catch {}
  console.error(`crash #${state.count}; waiting ${delayMs / 1000}s before exit`);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  process.exit(code);
}
