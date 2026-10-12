import { describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveOwnerPrincipals, resolveTeamsConfig } from "./config.ts";
import type { PrincipalConfig } from "./orchestration/principals.ts";
import type { TeamConfig } from "./orchestration/teams.ts";

function fakeReadFile(files: Record<string, string>): (filePath: string) => string {
  return (filePath) => {
    const content = files[filePath];
    if (content === undefined) throw new Error(`ENOENT: no such file, open '${filePath}'`);
    return content;
  };
}

describe("resolveOwnerPrincipals", () => {
  test("missing/empty registry + OWNER_DISCORD_ID set synthesizes a single owner principal", () => {
    const warn = mock();
    expect(resolveOwnerPrincipals({}, "100000000000000000", warn)).toEqual({
      owner: { owner: true, identities: { discord: "100000000000000000" } },
    });
    expect(warn).not.toHaveBeenCalled();
  });

  test("neither set stays empty — nobody is owner, no warning", () => {
    const warn = mock();
    expect(resolveOwnerPrincipals({}, undefined, warn)).toEqual({});
    expect(warn).not.toHaveBeenCalled();
  });

  test("a non-empty registry is used as-is, never merged with OWNER_DISCORD_ID", () => {
    const raw: Record<string, PrincipalConfig> = {
      drk: { owner: true, identities: { discord: "100000000000000000", slack: "U1" } },
      alice: { identities: { discord: "200000000000000000" } },
    };
    expect(resolveOwnerPrincipals(raw, "999999999999999999")).toBe(raw);
  });

  test("a registry with members but no declared owner is used as-is, not synthesized over, no warning", () => {
    const warn = mock();
    const raw: Record<string, PrincipalConfig> = { alice: { identities: { discord: "200000000000000000" } } };
    expect(resolveOwnerPrincipals(raw, "100000000000000000", warn)).toBe(raw);
    expect(warn).not.toHaveBeenCalled();
  });

  test("a matching file owner + OWNER_DISCORD_ID logs no warning and returns the file as-is", () => {
    const warn = mock();
    const raw: Record<string, PrincipalConfig> = { drk: { owner: true, identities: { discord: "100000000000000000" } } };
    expect(resolveOwnerPrincipals(raw, "100000000000000000", warn)).toBe(raw);
    expect(warn).not.toHaveBeenCalled();
  });

  test("a mismatched file owner + OWNER_DISCORD_ID warns once and still returns the file as-is (file wins)", () => {
    const warn = mock();
    const raw: Record<string, PrincipalConfig> = { drk: { owner: true, identities: { discord: "100000000000000000" } } };
    expect(resolveOwnerPrincipals(raw, "999999999999999999", warn)).toBe(raw);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toEqual({
      principalId: "drk",
      fileOwnerDiscord: "100000000000000000",
      ownerDiscordId: "999999999999999999",
    });
  });
});

describe("resolveTeamsConfig", () => {
  test("loads teams.json from the default path when TEAMS_PATH is unset", () => {
    const readFile = fakeReadFile({ "./teams.json": JSON.stringify({ a: { spaces: [] } }) });
    expect(resolveTeamsConfig(undefined, readFile)).toEqual({
      a: { spaces: [], wiki: undefined, linear: undefined, members: undefined, trustSpaceMembers: undefined },
    });
  });

  test("loads teams.json from an explicit TEAMS_PATH", () => {
    const readFile = fakeReadFile({ "/custom/teams.json": JSON.stringify({ a: { spaces: [] } }) });
    expect(resolveTeamsConfig("/custom/teams.json", readFile)).toEqual({
      a: { spaces: [], wiki: undefined, linear: undefined, members: undefined, trustSpaceMembers: undefined },
    });
  });

  test("an explicit TEAMS_PATH that can't be read throws", () => {
    const readFile = fakeReadFile({});
    expect(() => resolveTeamsConfig("/custom/teams.json", readFile)).toThrow(/Failed to load teams from \/custom\/teams\.json/);
  });

  test("TEAMS_PATH unset + default teams.json missing → empty, no error", () => {
    const readFile = fakeReadFile({});
    expect(resolveTeamsConfig(undefined, readFile)).toEqual({});
  });

  test("TEAMS_PATH unset + default teams.json present but invalid JSON still throws (not swallowed as 'no teams')", () => {
    const readFile = fakeReadFile({ "./teams.json": "not json" });
    expect(() => resolveTeamsConfig(undefined, readFile)).toThrow(/Invalid teams JSON in \.\/teams\.json/);
  });

  test("TEAMS_PATH unset + default teams.json present but shape-invalid still throws", () => {
    const readFile = fakeReadFile({ "./teams.json": JSON.stringify({ a: { spaces: "not an array" } }) });
    expect(() => resolveTeamsConfig(undefined, readFile)).toThrow(/teams: "a"\.spaces must be an array/);
  });
});

describe("principals web logins", () => {
  test("a mixed-case web identity is lowercased at load, other surfaces are left alone", () => {
    const out = resolveOwnerPrincipals({ drk: { owner: true, identities: { discord: "AbC1", web: " DrkLee3@GitHub " } } }, undefined, () => {});
    expect(out.drk!.identities).toEqual({ discord: "AbC1", web: "drklee3@github" });
  });
});

test("config imports with only OPENAI_API_KEY set", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "cfg-import-"));
  try {
    const script = `const m = await import(${JSON.stringify(join(import.meta.dir, "config.ts"))}); console.log(m.config.databasePath);`;
    const proc = Bun.spawn([process.execPath, "-e", script], {
      cwd,
      env: { PATH: process.env["PATH"] ?? "", OPENAI_API_KEY: "x" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    expect({ code, err: code === 0 ? "" : err }).toEqual({ code: 0, err: "" });
    expect(out.trim()).toBe("./data/personal.db");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
