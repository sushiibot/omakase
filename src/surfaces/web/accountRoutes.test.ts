import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { Accounts } from "../../accounts/service.ts";
import { AccountRoutes } from "./accountRoutes.ts";
import { createWebHandler } from "./server.ts";
import { createPeerMatcher } from "./peers.ts";

test("account endpoints enforce owner, trusted peer, and same-origin before dispatch", async () => {
  const db = new Database(":memory:");
  try {
    db.run("CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    const accounts = new Accounts(db, Buffer.alloc(32, 4), "owner");
    const result = accounts.action({ action: "prepare", name: "Example", username: "owner", origin: "https://example.com", requestId: "prepare-1" });
    if (!("account" in result)) throw new Error("Missing account");
    const id = result.account.id;
    const handler = createWebHandler({
      config: { port: 0, bindAddr: "127.0.0.1", ownerLogin: "owner@example.com", distDir: "/tmp/nonexistent-accounts-dist", devLogin: undefined, trustedPeers: ["127.0.0.1"], push: undefined },
      peers: createPeerMatcher(["127.0.0.1"]),
      accounts: new AccountRoutes(accounts),
    });
    for (const [path, method, body] of [
      ["/api/accounts", "GET", undefined],
      [`/api/accounts/${id}/audit`, "GET", undefined],
      [`/api/accounts/${id}/reveal`, "POST", { purpose: "copy" }],
      [`/api/accounts/${id}/archive`, "POST", { expectedVersion: 1 }],
    ] as const) {
      const request = (site: string, owner = "owner@example.com") => new Request(`https://app.example${path}`, { method, headers: { "Tailscale-User-Login": owner, "Sec-Fetch-Site": site, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      for (const site of ["cross-site", "same-site", "none"]) expect((await handler(request(site), "127.0.0.1")).status).toBe(403);
      expect((await handler(request("same-origin", "other@example.com"), "127.0.0.1")).status).toBe(403);
      expect((await handler(request("same-origin"), "127.0.0.2")).status).toBe(403);
      const response = await handler(request("same-origin"), "127.0.0.1");
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
    expect(accounts.audit(id).map(event => event.action)).toEqual(["prepare", "copy", "archive"]);
  } finally { db.close(); }
});
