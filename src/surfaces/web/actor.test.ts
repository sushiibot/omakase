import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { join } from "node:path";
import { resolveOwnerPrincipals } from "../../config.ts";
import { isVerifiedWebActor, mintWebActor, normalizeLogin, WEB_SURFACE } from "./actor.ts";

describe("web actor", () => {
  test("only the minted object is verified: not a copy, not a look-alike", () => {
    const actor = mintWebActor("  Owner@GitHub ", "Owner");
    expect(actor).toEqual({ surface: "web", userId: "owner@github", name: "Owner" });
    expect(isVerifiedWebActor(actor)).toBe(true);
    expect(isVerifiedWebActor({ ...actor })).toBe(false);
    expect(isVerifiedWebActor({ surface: "web", userId: "owner@github", name: "Owner" })).toBe(false);
    expect(Object.isFrozen(actor)).toBe(true);
  });

  test("only the web gateway mints actors, after its login check", async () => {
    const callers: string[] = [];
    const src = join(import.meta.dir, "../..");
    for await (const file of new Glob("**/*.ts").scan(src)) {
      if (file.endsWith(".test.ts") || file === join("surfaces", "web", "actor.ts")) continue;
      if ((await Bun.file(join(src, file)).text()).includes("mintWebActor")) callers.push(file);
    }
    expect(callers).toEqual([join("surfaces", "web", "server.ts")]);
  });
});

test("principals.json web identities are normalized the way web actors are", () => {
  const login = "  MixedCase@GitHub ";
  const out = resolveOwnerPrincipals({ me: { owner: true, identities: { [WEB_SURFACE]: login } } }, undefined, () => {});
  expect(out.me!.identities[WEB_SURFACE]).toBe(normalizeLogin(login));
});
