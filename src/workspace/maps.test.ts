import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GoogleMaps } from "../orchestration/workspace/maps.ts";
import { mapsSocket, parseMapsArgs, runMaps, startMapsBridge } from "./maps.ts";

test("CLI calls the private bridge without a key and reports gateway failures", async () => {
  const state = mkdtempSync(join(tmpdir(), "maps-cli-"));
  const runs: (string | undefined)[] = [];
  const maps = new GoogleMaps(() => "gateway-only", async () => Response.json({ places: [{ id: "abc", displayName: { text: "Cafe" } }] }));
  const bridge = await startMapsBridge(state, async (args, run) => {
    runs.push(run);
    if (args.action === "place") throw new Error("Google quota exceeded");
    return maps.action(args);
  });
  const out: string[] = [], err: string[] = [];
  const cli = (argv: string[]) => runMaps(argv, { env: { WORKSPACE_STATE_DIR: state, WS_RUN_ID: "run-1" }, out: s => out.push(s), err: s => err.push(s) });
  try {
    expect(statSync(mapsSocket(state)).mode & 0o777).toBe(0o600);
    expect(await cli(["search", "coffee in Amsterdam", "--limit", "3"])).toBe(0);
    expect(JSON.parse(out[0]!)).toMatchObject({ places: [{ id: "abc" }] });
    expect(out[0]).not.toContain("gateway-only");
    expect(await cli(["place", "abc"])).toBe(1);
    expect(err[0]).toContain("quota");
    expect(runs).toEqual(["run-1", "run-1"]);
  } finally { await bridge.close(); rmSync(state, { force: true, recursive: true }); }
  expect(await cli(["search", "x"])).toBe(1);
  expect(err.at(-1)).toContain("workspace is running");
});

test("help works offline and invalid arguments never call the gateway", async () => {
  let calls = 0;
  const io = { env: {}, out: (_s: string) => {}, err: (_s: string) => {}, call: async () => { calls++; return {}; } };
  expect(await runMaps(["--help"], io)).toBe(0);
  for (const args of [[], ["search"], ["search", "x", "--reviews"], ["search", "x", "--limit", "-1"], ["search", "x", "--near", ",4"], ["search", "x", "--near", "91,4"], ["search", "x", "--radius", "300"], ["search", "x", "--limit", "2", "--limit", "3"], ["place", "../abc"], ["directions", "a", "b", "--mode", "transit"]])
    expect(await runMaps(args, io)).toBe(2);
  expect(calls).toBe(0);
  expect(parseMapsArgs(["search", "coffee", "--near", "52,-4", "--open-now", "--page-token", "abc"])).toMatchObject({ near: { latitude: 52, longitude: -4 }, openNow: true, pageToken: "abc", limit: 5 });
});
