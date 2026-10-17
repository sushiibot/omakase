import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AppVersions, AndroidRelease } from "./events.ts";

export const ANDROID_MANIFEST = "https://github.com/sushiibot/omakase/releases/download/android-latest/update.json";
const RELEASE_ROOT = "https://github.com/sushiibot/omakase/releases/download/";

export function androidRelease(value: unknown): AndroidRelease | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!Number.isSafeInteger(v.versionCode) || (v.versionCode as number) < 1 || (v.versionCode as number) > 2100000000 ||
      typeof v.versionName !== "string" || !v.versionName || v.versionName.length > 80 ||
      typeof v.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(v.sha256) ||
      v.url !== `${RELEASE_ROOT}android-${v.versionCode}/omakase.apk`) return null;
  return { versionCode: v.versionCode as number, versionName: v.versionName, sha256: v.sha256, url: v.url as string };
}

export interface UpdateSource {
  current(): AppVersions;
  subscribe(listener: (versions: AppVersions) => void): () => void;
}

/** One release check per gateway, shared by all open streams. Never blocks chat or startup. */
export function createUpdates(distDir: string, options: { fetch?: typeof fetch; intervalMs?: number } = {}): UpdateSource {
  let android: AndroidRelease | null = null;
  let busy = false;
  let lastCheck = -Infinity;
  let timer: ReturnType<typeof setInterval> | undefined;
  let fingerprint = "";
  const listeners = new Set<(versions: AppVersions) => void>();
  const interval = options.intervalMs ?? 60_000;
  const snapshot = (): AppVersions => {
    let web: string | null = null;
    try {
      const data = JSON.parse(readFileSync(join(distDir, "_app/version.json"), "utf8"));
      if (typeof data.version === "string" && data.version.length <= 200) web = data.version;
    } catch { /* Development and a temporarily incomplete deployment have no version to announce. */ }
    return { web, android };
  };
  const announce = () => {
    const versions = snapshot();
    const next = JSON.stringify(versions);
    if (next === fingerprint) return;
    fingerprint = next;
    for (const fn of listeners) fn(versions);
  };
  const refresh = async () => {
    announce();
    if (!options.fetch || busy || Date.now() - lastCheck < interval) return;
    busy = true;
    lastCheck = Date.now();
    try {
      const response = await options.fetch(ANDROID_MANIFEST, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) return;
      // A release pointer is tiny; do not buffer an unbounded response.
      const reader = response.body?.getReader();
      if (!reader) return;
      let text = "";
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
          if (text.length > 4096) return;
        }
        text += decoder.decode();
      } finally { await reader.cancel().catch(() => {}); }
      const release = androidRelease(JSON.parse(text));
      // A delayed CI job or a stale CDN response must not roll the advertised APK backwards.
      if (release && (!android || release.versionCode > android.versionCode)) android = release;
      announce();
    } catch { /* Keep the last verified release during a network failure. */ }
    finally { busy = false; }
  };
  return {
    current() { void refresh(); return snapshot(); },
    subscribe(listener) {
      listeners.add(listener);
      if (!timer) {
        timer = setInterval(() => void refresh(), interval);
        timer.unref?.();
      }
      void refresh();
      return () => {
        listeners.delete(listener);
        if (!listeners.size && timer) { clearInterval(timer); timer = undefined; }
      };
    },
  };
}
