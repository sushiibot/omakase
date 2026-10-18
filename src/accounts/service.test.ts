import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Accounts, generatePassword } from "./service.ts";
import type { ConnectionInfo } from "../orchestration/transport/server.ts";
import { AccountRoutes } from "../surfaces/web/accountRoutes.ts";
const databases: Database[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
function setup() {
  const db = new Database(":memory:");
  databases.push(db);
  db.run("CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const key = Buffer.alloc(32, 7);
  return { db, key, accounts: new Accounts(db, key, "owner") };
}
const prepare = {
  action: "prepare",
  name: "Example",
  origin: "https://example.com",
  username: "user@example.com",
  requestId: "request-1",
};
function create(accounts: Accounts) {
  const result = accounts.action(prepare);
  if (!("account" in result)) throw Error();
  return result.account;
}
const connection = (): ConnectionInfo => ({
  role: "workspace",
  principalId: "owner",
  runnerId: "workspace",
  protocolVersion: 1,
  state: "idle",
});
describe("account lifecycle", () => {
  test("encrypted versions, idempotent prepare/revise, optimistic concurrency, audit and archived retention", () => {
    const { accounts, db, key } = setup();
    const a = create(accounts),
      first = accounts.reveal(a.id, undefined, "reveal").password;
    expect(accounts.action(prepare)).toEqual({ account: a });
    expect(() => accounts.action({ ...prepare, username: "other" })).toThrow();
    accounts.action({ action: "confirm", accountId: a.id, expectedVersion: 1 });
    const revision = {
      action: "revise",
      accountId: a.id,
      expectedVersion: 1,
      passwordPolicy: { maxLength: 16, allowedSymbols: "!" },
      requestId: "revision-1",
    };
    const revised = accounts.action(revision);
    expect(accounts.action(revision)).toEqual(revised);
    expect(() =>
      accounts.action({ ...revision, requestId: "revision-2" }),
    ).toThrow();
    const second = accounts.reveal(a.id, 2, "copy").password;
    expect(second).toHaveLength(16);
    expect(second).not.toBe(first);
    expect(accounts.list()[0]?.confirmedVersion).toBe(1);
    accounts.action({ action: "archive", accountId: a.id, expectedVersion: 2 });
    expect(() =>
      accounts.internal(connection(), {
        principalId: "owner",
        operation: "fill",
        accountId: a.id,
        origin: a.origin,
        engine: "chromium",
      }),
    ).toThrow();
    expect(JSON.stringify(accounts.redact([first, second]))).not.toContain(
      first,
    );
    expect(accounts.audit(a.id).map((e) => e.action)).toEqual([
      "prepare",
      "reveal",
      "confirm",
      "revise",
      "copy",
      "archive",
      "llm_redacted",
      "llm_redacted",
    ]);
    const disk = JSON.stringify(db.query("SELECT * FROM kv").all());
    expect(disk).not.toContain(first);
    expect(disk).not.toContain(second);
    expect(
      new Accounts(db, key, "owner").reveal(a.id, 1, "copy").password,
    ).toBe(first);
    expect(() => new Accounts(db, Buffer.alloc(32, 8), "owner")).toThrow();
  });
  test("origin and principal binding, no implicit submit, connection bound result receipts", () => {
    const { accounts } = setup();
    const a = create(accounts),
      conn = connection();
    const input = {
      principalId: "owner",
      operation: "fill",
      accountId: a.id,
      origin: a.origin,
      engine: "camoufox",
    };
    for (const override of [
      { origin: "https://evil.example" },
      { origin: "https://example.com.evil.example" },
      { principalId: "other" },
      { origin: "https://example.com/path" },
    ])
      expect(() =>
        accounts.internal(conn, { ...input, ...override }),
      ).toThrow();
    expect(() =>
      accounts.internal({ ...conn, role: "machine" } as unknown as ConnectionInfo, input),
    ).toThrow();
    const result = accounts.internal(conn, input) as {
      receiptId: string;
      password: string;
    };
    expect(result.password).toHaveLength(20);
    const finish = {
      principalId: "owner",
      operation: "fill_result",
      receiptId: result.receiptId,
      outcome: "filled",
    };
    expect(() => accounts.internal(connection(), finish)).toThrow();
    expect(accounts.internal(conn, finish)).toEqual({ ok: true });
    expect(accounts.internal(conn, finish)).toEqual({ ok: true });
    expect(() =>
      accounts.internal(conn, { ...finish, outcome: "failed" }),
    ).toThrow();
    expect(
      accounts.audit(a.id).filter((e) => e.action === "fill_result"),
    ).toHaveLength(1);
  });
  test("redacts nested values, keys, encodings, old versions; corruption fails closed", () => {
    const { accounts, db } = setup();
    const a = create(accounts),
      password = accounts.reveal(a.id, 1, "reveal").password;
    const value = {
      [password]: [
        password,
        encodeURIComponent(password),
        Buffer.from(password).toString("base64"),
        { text: `prefix ${password} suffix` },
      ],
    };
    const result = accounts.redact(value);
    expect(JSON.stringify(result)).not.toContain(password);
    expect(Object.keys(result as object)).toEqual([
      "[REDACTED_ACCOUNT_PASSWORD]",
    ]);
    db.run("UPDATE kv SET value='bad' WHERE key LIKE 'accounts:v1:record:%'");
    expect(() => accounts.redact({ safe: true })).toThrow();
  });
  test("rejects unsupported policy and contradictory constraints", () => {
    const { accounts } = setup();
    expect(() =>
      accounts.action({ ...prepare, passwordPolicy: { minLength: 10 } }),
    ).toThrow();
    expect(() =>
      accounts.action({
        ...prepare,
        passwordPolicy: { minLength: 30, maxLength: 20 },
      }),
    ).toThrow();
    expect(() =>
      accounts.action({
        ...prepare,
        passwordPolicy: { requireSymbols: true, allowedSymbols: "" },
      }),
    ).toThrow();
    for (let i = 0; i < 30; i++) {
      const value = generatePassword();
      expect(value).toMatch(/[A-Z]/);
      expect(value).toMatch(/[a-z]/);
      expect(value).toMatch(/[0-9]/);
      expect(value).toMatch(/[^A-Za-z0-9]/);
    }
  });
  test("HTTP reveals are explicit POST, bounded and no-store", async () => {
    const { accounts } = setup();
    const a = create(accounts),
      routes = new AccountRoutes(accounts);
    const path = `/api/accounts/${a.id}/reveal`;
    const get = await routes.handle(
      new Request("https://app.test" + path),
      path,
    );
    expect(get?.status).toBe(405);
    const post = await routes.handle(
      new Request("https://app.test" + path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ purpose: "copy" }),
      }),
      path,
    );
    expect(post?.status).toBe(200);
    expect(post?.headers.get("cache-control")).toBe("no-store");
    expect((await post?.json()).password).toBeString();
  });
  test("transaction rolls back if audit write fails", () => {
    const { accounts, db } = setup();
    db.run(
      "CREATE TRIGGER fail_write BEFORE INSERT ON kv BEGIN SELECT RAISE(ABORT, 'no'); END",
    );
    expect(() => create(accounts)).toThrow();
    expect(accounts.list()).toEqual([]);
  });
});
