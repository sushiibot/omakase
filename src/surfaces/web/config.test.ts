import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePersonalConfig, parseWebConfig } from "./config.ts";

describe("parsePersonalConfig", () => {
  test("defaults: uploads next to the database, transport on 8788, workspace off", () => {
    expect(parsePersonalConfig({ DATABASE_PATH: "/data/personal.db" })).toEqual({
      webUploadsDir: "/data/web-uploads",
      orchPort: 8788,
      orchSecret: undefined,
      dmWorkspaceEnabled: false,
    });
  });

  test("reads the personal service env", () => {
    expect(
      parsePersonalConfig({ WEB_UPLOADS_DIR: "/bot-data/web-uploads", ORCH_PORT: "9000", ORCH_SECRET: " s ", DM_WORKSPACE_ENABLED: "True" }),
    ).toEqual({ webUploadsDir: "/bot-data/web-uploads", orchPort: 9000, orchSecret: "s", dmWorkspaceEnabled: true });
    expect(() => parsePersonalConfig({ ORCH_PORT: "70000" })).toThrow("ORCH_PORT");
  });
});

describe("parseWebConfig", () => {
  const vapid = { VAPID_PUBLIC_KEY: "BPubKey_-", VAPID_PRIVATE_KEY: "privKey-_", VAPID_SUBJECT: "mailto:me@example.com" };

  test("disabled when WEB_OWNER_LOGIN is unset or blank, even with other web vars invalid", () => {
    expect(parseWebConfig({})).toBeUndefined();
    expect(parseWebConfig({ WEB_OWNER_LOGIN: "  ", WEB_PORT: "nope", VAPID_PUBLIC_KEY: "x" })).toBeUndefined();
  });

  test("defaults, with push off when the VAPID keys are absent", () => {
    expect(parseWebConfig({ WEB_OWNER_LOGIN: "me@example.com" })).toEqual({
      port: 8790,
      bindAddr: "127.0.0.1",
      ownerLogin: "me@example.com",
      distDir: "/app/web/build",
      devLogin: undefined,
      trustedPeers: ["127.0.0.1"],
      push: undefined,
    });
  });

  test("push on with both keys and a subject", () => {
    const web = parseWebConfig({ WEB_OWNER_LOGIN: "me@example.com", ...vapid, WEB_TRUSTED_PEERS: "127.0.0.1, 172.31.250.1", WEB_BIND_ADDR: "172.31.250.2" });
    expect(web?.push).toEqual({ publicKey: "BPubKey_-", privateKey: "privKey-_", subject: "mailto:me@example.com" });
    expect(web?.trustedPeers).toEqual(["127.0.0.1", "172.31.250.1"]);
    expect(web?.bindAddr).toBe("172.31.250.2");
  });

  test("a half-configured VAPID pair or a missing subject turns push off with a reason", () => {
    const half = parseWebConfig({ WEB_OWNER_LOGIN: "me", VAPID_PUBLIC_KEY: "abc" });
    expect(half?.push).toBeUndefined();
    expect(half?.pushDisabledReason).toContain("set together");
    const noSubject = parseWebConfig({ WEB_OWNER_LOGIN: "me", VAPID_PUBLIC_KEY: "abc", VAPID_PRIVATE_KEY: "def" });
    expect(noSubject?.push).toBeUndefined();
    expect(noSubject?.pushDisabledReason).toContain("VAPID_SUBJECT");
    expect(parseWebConfig({ WEB_OWNER_LOGIN: "me", ...vapid, VAPID_PRIVATE_KEY: "padded==" })?.push?.privateKey).toBe("padded==");
    expect(() => parseWebConfig({ WEB_OWNER_LOGIN: "me", WEB_PORT: "70000" })).toThrow();
  });

  test("importing the config never parses the web env, so a bad web setup cannot crash the process", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cfg-import-"));
    try {
      const proc = Bun.spawn([process.execPath, "-e", `await import(${JSON.stringify(join(import.meta.dir, "config.ts"))}); console.log("imported")`], {
        cwd,
        // An explicit env, not the parent's, so a local .env cannot fill in the missing VAPID half.
        env: {
          PATH: process.env["PATH"] ?? "",
          WEB_OWNER_LOGIN: "me@example.com",
          VAPID_PUBLIC_KEY: "BAAA",
          WEB_PORT: "nope",
          WEB_TRUSTED_PEERS: "10.0.0.0/8",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      expect({ code, err: code === 0 ? "" : err }).toEqual({ code: 0, err: "" });
      expect(out).toContain("imported");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("trusted peers are exact IPs and the bind address must be an IP", () => {
    expect(() => parseWebConfig({ WEB_OWNER_LOGIN: "me", WEB_TRUSTED_PEERS: "172.31.250.0/24" })).toThrow("exact IPs");
    expect(() => parseWebConfig({ WEB_OWNER_LOGIN: "me", WEB_TRUSTED_PEERS: " , " })).toThrow();
    expect(() => parseWebConfig({ WEB_OWNER_LOGIN: "me", WEB_BIND_ADDR: "0.0.0.0/0" })).toThrow();
    expect(() => parseWebConfig({ WEB_OWNER_LOGIN: "me", WEB_BIND_ADDR: "localhost" })).toThrow();
  });

  test("WEB_DEV_LOGIN is honoured only on a loopback bind outside production", () => {
    expect(parseWebConfig({ WEB_OWNER_LOGIN: "me", WEB_DEV_LOGIN: "me" })?.devLogin).toBe("me");
    expect(parseWebConfig({ WEB_OWNER_LOGIN: "me", WEB_DEV_LOGIN: "me", WEB_BIND_ADDR: "::1" })?.devLogin).toBe("me");
    expect(parseWebConfig({ WEB_OWNER_LOGIN: "me", WEB_DEV_LOGIN: "me", NODE_ENV: "production" })?.devLogin).toBeUndefined();
    expect(parseWebConfig({ WEB_OWNER_LOGIN: "me", WEB_DEV_LOGIN: "me", NODE_ENV: "PRODUCTION" })?.devLogin).toBeUndefined();
    expect(parseWebConfig({ WEB_OWNER_LOGIN: "me", WEB_DEV_LOGIN: "me", WEB_BIND_ADDR: "172.31.250.2" })?.devLogin).toBeUndefined();
    expect(parseWebConfig({ WEB_OWNER_LOGIN: "me", WEB_DEV_LOGIN: "me", WEB_BIND_ADDR: "0.0.0.0" })?.devLogin).toBeUndefined();
  });
});

