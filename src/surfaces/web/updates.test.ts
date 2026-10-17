import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { androidRelease, createUpdates } from "./updates.ts";
const dirs: string[] = [];
const directory = () => { const dir = mkdtempSync(join(tmpdir(), "updates-")); dirs.push(dir); mkdirSync(join(dir, "_app")); return dir; };
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const release = (versionCode = 10) => ({ versionCode, versionName: `1.0.${versionCode - 1}`, sha256: "a".repeat(64), url: `https://github.com/sushiibot/omakase/releases/download/android-${versionCode}/omakase.apk` });

test("rejects mismatched versions, arbitrary download URLs and malformed hashes", () => {
  expect(androidRelease(release())).toEqual(release());
  for (const value of [null, {}, { ...release(), versionCode: 0 }, { ...release(), versionCode: 1.1 }, { ...release(), url: 'https://evil.example/a.apk' }, { ...release(), versionCode: 11 }, { ...release(), sha256: 'x' }]) expect(androidRelease(value)).toBeNull();
});

test("reads the deployed web build independently of Android; missing metadata does not break chat", () => {
  const dir = directory();
  const source = createUpdates(dir);
  expect(source.current()).toEqual({ web: null, android: null });
  writeFileSync(join(dir, '_app/version.json'), JSON.stringify({ version: 'web-a' }));
  expect(source.current()).toEqual({ web: 'web-a', android: null });
  writeFileSync(join(dir, '_app/version.json'), '{incomplete');
  expect(source.current().web).toBeNull();
});

test("shares release requests, broadcasts completion, keeps last release on failure and ignores stale versions", async () => {
  const dir = directory();
  let calls = 0;
  let answer: unknown = release();
  const source = createUpdates(dir, { intervalMs: 10, fetch: (async () => { calls++; await Bun.sleep(2); return Response.json(answer); }) as unknown as typeof fetch });
  const seen: unknown[] = [];
  const off = source.subscribe(v => seen.push(v.android));
  const off2 = source.subscribe(() => {});
  source.current(); source.current();
  await Bun.sleep(5);
  expect(calls).toBe(1);
  expect(seen).toContainEqual(release());
  answer = release(9);
  await Bun.sleep(25);
  expect(source.current().android).toEqual(release());
  answer = { invalid: true };
  await Bun.sleep(25);
  expect(source.current().android).toEqual(release());
  off(); off2();
  await Bun.sleep(5);
  const stoppedCalls = calls;
  await Bun.sleep(25);
  expect(calls).toBe(stoppedCalls);
});
