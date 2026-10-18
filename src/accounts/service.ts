import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomInt,
} from "node:crypto";
import type { Database } from "bun:sqlite";
import type { ConnectionInfo } from "../orchestration/transport/server.ts";
import {
  accountMetadata,
  accountRequest,
  internalRequest,
  type AccountMetadata,
  type AuditEvent,
  type PasswordPolicy,
} from "./contracts.ts";

export class AccountError extends Error {
  constructor(
    readonly status = 409,
    message:
      | "Account operation could not be completed."
      | "Password requirements conflict. Adjust the length limits or allowed symbols." = "Account operation could not be completed.",
  ) {
    super(message);
  }
}
const PREFIX = "accounts:v1:";
interface Sealed {
  iv: string;
  tag: string;
  ciphertext: string;
}
interface Record {
  metadata: AccountMetadata;
  passwords: Sealed[];
  events: AuditEvent[];
  passwordPolicy?: PasswordPolicy;
}
interface Receipt {
  accountId: string;
  version: number;
  origin: string;
  engine: string;
  runId?: string;
  at: number;
  outcome?: string;
}
export function accountOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      (url.protocol === "http:" &&
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error();
    return url.origin;
  } catch {
    throw new AccountError(422);
  }
}
export function generatePassword(policy: PasswordPolicy = {}): string {
  const min = policy.minLength ?? 12,
    max = policy.maxLength ?? 128;
  if (min > max)
    throw new AccountError(
      422,
      "Password requirements conflict. Adjust the length limits or allowed symbols.",
    );
  const symbols = policy.allowedSymbols ?? "!#$%&()*+,-.:;<=>?@[]^_{|}~";
  const groups = [
    [policy.requireUppercase ?? true, "ABCDEFGHIJKLMNOPQRSTUVWXYZ"],
    [policy.requireLowercase ?? true, "abcdefghijklmnopqrstuvwxyz"],
    [policy.requireDigits ?? true, "0123456789"],
    [policy.requireSymbols ?? true, symbols],
  ] as const;
  const required = groups
    .filter(([required]) => required)
    .map(([, chars]) => chars);
  if (required.some((chars) => !chars.length))
    throw new AccountError(
      422,
      "Password requirements conflict. Adjust the length limits or allowed symbols.",
    );
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789" + symbols;
  const length = Math.min(max, Math.max(min, 20));
  // Rejection sampling preserves uniformity over valid passwords.
  for (;;) {
    const value = Array.from(
      { length },
      () => alphabet[randomInt(alphabet.length)],
    ).join("");
    if (required.every((chars) => [...value].some((c) => chars.includes(c))))
      return value;
  }
}
export class Accounts {
  private readonly receipts = new WeakMap<
    ConnectionInfo,
    Map<string, Receipt>
  >();
  constructor(
    private readonly db: Database,
    private readonly key: Buffer,
    private readonly principalId: string,
  ) {
    if (key.length !== 32) throw new AccountError(503);
    for (const r of this.records())
      for (let v = 1; v <= r.passwords.length; v++) this.open(r, v);
  }
  private read<T>(key: string): T | undefined {
    const row = this.db
      .query<{ value: string }, [string]>("SELECT value FROM kv WHERE key = ?")
      .get(PREFIX + key);
    if (!row) return;
    try {
      return JSON.parse(row.value);
    } catch {
      throw new AccountError(503);
    }
  }
  private write(key: string, value: unknown) {
    this.db
      .query(
        "INSERT INTO kv (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(PREFIX + key, JSON.stringify(value));
  }
  private records(): Record[] {
    return this.db
      .query<{ value: string }, []>(
        "SELECT value FROM kv WHERE key LIKE 'accounts:v1:record:%'",
      )
      .all()
      .map((row) => {
        try {
          const r = JSON.parse(row.value) as Record;
          accountMetadata.parse(r.metadata);
          if (
            !Array.isArray(r.passwords) ||
            r.passwords.length !== r.metadata.version ||
            !Array.isArray(r.events)
          )
            throw new Error();
          return r;
        } catch {
          throw new AccountError(503);
        }
      });
  }
  private record(id: string): Record {
    const record = this.records().find((r) => r.metadata.id === id);
    if (!record) throw new AccountError(404);
    return record;
  }
  private seal(id: string, version: number, password: string): Sealed {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(`${id}:${version}`));
    const ciphertext = Buffer.concat([
      cipher.update(password, "utf8"),
      cipher.final(),
    ]);
    return {
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
  }
  private open(r: Record, version: number): string {
    try {
      const sealed = r.passwords[version - 1]!;
      const cipher = createDecipheriv(
        "aes-256-gcm",
        this.key,
        Buffer.from(sealed.iv, "base64"),
      );
      cipher.setAAD(Buffer.from(`${r.metadata.id}:${version}`));
      cipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
      const value = Buffer.concat([
        cipher.update(Buffer.from(sealed.ciphertext, "base64")),
        cipher.final(),
      ]).toString("utf8");
      if (!value) throw new Error();
      return value;
    } catch {
      throw new AccountError(503);
    }
  }
  private event(
    r: Record,
    action: string,
    actor: string,
    extra: Partial<AuditEvent> = {},
  ) {
    r.events.push({
      id: crypto.randomUUID(),
      accountId: r.metadata.id,
      version: r.metadata.version,
      action,
      actor,
      at: Date.now(),
      ...extra,
    });
    this.write("record:" + r.metadata.id, r);
  }
  list(): AccountMetadata[] {
    return this.records()
      .map((r) => r.metadata)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }
  audit(id: string): AuditEvent[] {
    return this.record(id).events;
  }
  action(
    raw: unknown,
    actor = "agent",
  ): { accounts: AccountMetadata[] } | { account: AccountMetadata } {
    const parsed = accountRequest.safeParse(raw);
    if (!parsed.success) throw new AccountError(422);
    const p = parsed.data;
    return this.db.transaction(() => {
      if (p.action === "list") return { accounts: this.list() };
      if (p.action === "prepare" || p.action === "revise") {
        const fingerprint = JSON.stringify(p);
        const prior = this.read<{
          fingerprint: string;
          account: AccountMetadata;
        }>("request:" + p.requestId);
        if (prior) {
          if (prior.fingerprint !== fingerprint) throw new AccountError();
          return { account: prior.account };
        }
        const password = generatePassword(p.passwordPolicy);
        let r: Record;
        if (p.action === "prepare") {
          const now = Date.now();
          r = {
            metadata: {
              id: crypto.randomUUID(),
              name: p.name,
              origin: accountOrigin(p.origin),
              username: p.username,
              status: "pending",
              version: 1,
              createdAt: now,
              updatedAt: now,
            },
            passwords: [],
            events: [],
          };
        } else {
          r = this.record(p.accountId);
          this.check(r, p.expectedVersion);
          r.metadata.version++;
          r.metadata.status = "pending";
          r.metadata.updatedAt = Date.now();
        }
        r.passwordPolicy = p.passwordPolicy ?? {};
        r.passwords.push(
          this.seal(r.metadata.id, r.metadata.version, password),
        );
        this.event(r, p.action, actor);
        this.write("request:" + p.requestId, {
          fingerprint,
          account: r.metadata,
        });
        return { account: r.metadata };
      }
      const r = this.record(p.accountId);
      if (
        p.action === "archive" &&
        r.metadata.status === "archived" &&
        p.expectedVersion === r.metadata.version
      )
        return { account: r.metadata };
      this.check(r, p.expectedVersion);
      if (p.action === "confirm") {
        r.metadata.confirmedVersion = r.metadata.version;
        r.metadata.status = "active";
      } else r.metadata.status = "archived";
      r.metadata.updatedAt = Date.now();
      this.event(r, p.action, actor);
      return { account: r.metadata };
    })();
  }
  private check(r: Record, version: number) {
    if (r.metadata.version !== version || r.metadata.status === "archived")
      throw new AccountError();
  }
  reveal(id: string, version: number | undefined, purpose: "reveal" | "copy") {
    return this.db.transaction(() => {
      const r = this.record(id);
      const v = version ?? r.metadata.version;
      if (v < 1 || v > r.metadata.version) throw new AccountError(404);
      const password = this.open(r, v);
      this.event(r, purpose, "owner", { version: v });
      return { password, version: v };
    })();
  }
  internal(conn: ConnectionInfo, raw: unknown): unknown {
    const parsed = internalRequest.safeParse(raw);
    if (
      !parsed.success ||
      conn.role !== "workspace" ||
      conn.principalId !== this.principalId ||
      parsed.data.principalId !== this.principalId
    )
      throw new AccountError(403);
    const p = parsed.data;
    if (p.operation === "redact")
      return { payload: this.redact(p.payload, p.runId) };
    if (p.operation === "fill_result") {
      const receipt = this.receipts.get(conn)?.get(p.receiptId);
      if (
        !receipt ||
        Date.now() - receipt.at > 600_000 ||
        (receipt.outcome && receipt.outcome !== p.outcome)
      )
        throw new AccountError();
      if (!receipt.outcome) {
        this.db.transaction(() =>
          this.event(
            this.record(receipt.accountId),
            "fill_result",
            "workspace",
            {
              version: receipt.version,
              origin: receipt.origin,
              engine: receipt.engine,
              runId: receipt.runId,
              outcome: p.outcome,
            },
          ),
        )();
        receipt.outcome = p.outcome;
      }
      return { ok: true };
    }
    return this.db.transaction(() => {
      const r = this.record(p.accountId),
        origin = accountOrigin(p.origin),
        version = p.version ?? r.metadata.version;
      if (
        r.metadata.status === "archived" ||
        origin !== r.metadata.origin ||
        (version !== r.metadata.version &&
          version !== r.metadata.confirmedVersion)
      )
        throw new AccountError(403);
      const password = this.open(r, version),
        receiptId = crypto.randomUUID();
      let receipts = this.receipts.get(conn);
      if (!receipts) {
        receipts = new Map();
        this.receipts.set(conn, receipts);
      }
      for (const [id, v] of receipts)
        if (Date.now() - v.at > 600_000) receipts.delete(id);
      if (receipts.size >= 1000) throw new AccountError(429);
      const receipt = {
        accountId: r.metadata.id,
        version,
        origin,
        engine: p.engine,
        runId: p.runId,
        at: Date.now(),
      };
      this.event(r, "fill_requested", "workspace", receipt);
      receipts.set(receiptId, receipt);
      return { password, username: r.metadata.username, version, receiptId };
    })();
  }
  redact(payload: unknown, runId?: string): unknown {
    const needles = new Set<string>();
    const owners = new Map<
      string,
      Array<{ record: Record; version: number }>
    >();
    for (const r of this.records())
      for (let v = 1; v <= r.passwords.length; v++) {
        const value = this.open(r, v);
        for (const form of [
          value,
          encodeURIComponent(value),
          encodeURI(value),
          Buffer.from(value).toString("base64"),
          Buffer.from(value).toString("base64url"),
          JSON.stringify(value).slice(1, -1),
          [...value].map((c) => `&#${c.charCodeAt(0)};`).join(""),
          value.replace(
            /[&<>"']/g,
            (c) =>
              ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
              })[c]!,
          ),
        ]) {
          needles.add(form);
          const entries = owners.get(form) ?? [];
          entries.push({ record: r, version: v });
          owners.set(form, entries);
        }
      }
    const matched = new Map<string, { record: Record; version: number }>();
    const ordered = [...needles].sort((a, b) => b.length - a.length);
    const scrub = (s: string) => {
      for (const value of ordered)
        if (s.includes(value)) {
          for (const owner of owners.get(value)!)
            matched.set(`${owner.record.metadata.id}:${owner.version}`, owner);
          s = s.split(value).join("[REDACTED_ACCOUNT_PASSWORD]");
        }
      return s;
    };
    const walk = (value: unknown, depth = 0): unknown => {
      if (depth > 100) throw new AccountError(503);
      if (typeof value === "string") return scrub(value);
      if (
        value === null ||
        typeof value === "number" ||
        typeof value === "boolean"
      )
        return value;
      if (Array.isArray(value)) return value.map((v) => walk(v, depth + 1));
      if (
        typeof value === "object" &&
        value &&
        Object.getPrototypeOf(value) === Object.prototype
      )
        return Object.fromEntries(
          Object.entries(value).map(([k, v]) => [scrub(k), walk(v, depth + 1)]),
        );
      throw new AccountError(503);
    };
    const result = walk(payload);
    this.db.transaction(() => {
      for (const { record, version } of matched.values())
        this.event(record, "llm_redacted", "workspace", {
          version,
          ...(runId ? { runId } : {}),
        });
    })();
    return result;
  }
}
