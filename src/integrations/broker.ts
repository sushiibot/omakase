import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import { z } from "zod";
import type { JsonState } from "../db/jsonState.ts";
import type { IntegrationSecrets } from "./secrets.ts";

export class BrokerError extends Error {}
const id = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/);
const field = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const safeText = z.string().trim().min(1).max(500);
const origin = z
  .string()
  .max(253)
  .refine((value) => {
    try {
      const u = new URL(value);
      return (
        u.protocol === "https:" &&
        u.origin === value &&
        !u.port &&
        !isIP(u.hostname) &&
        /^[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(u.hostname)
      );
    } catch {
      return false;
    }
  });
export const definitionSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(80),
    capability: safeText,
    origin,
    docsUrl: z
      .string()
      .url()
      .max(500)
      .refine((v) => {
        const u = new URL(v);
        return u.protocol === "https:" && !u.username && !u.password;
      }),
    auth: z.discriminatedUnion("type", [
      z.object({ type: z.literal("bearer") }).strict(),
      z
        .object({
          type: z.literal("header"),
          name: field.refine(
            (n) =>
              !/^(host|cookie|connection|content-.*|transfer-encoding|proxy-.*|accept.*|forwarded|x-forwarded-.*)$/i.test(
                n,
              ),
          ),
        })
        .strict(),
    ]),
    operations: z
      .array(
        z
          .object({
            id,
            description: safeText,
            method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
            // Exact paths only. No URLs, encoded separators, traversal, fragments or templates.
            path: z
              .string()
              .max(300)
              .regex(/^\/(?:[A-Za-z0-9_~:@-]+\/?)*$/),
            query: z.array(field).max(20).default([]),
            body: z.boolean().default(false),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.id === "google_maps")
      ctx.addIssue({ code: "custom", message: "Reserved integration." });
    if (
      new Set(d.operations.map((o) => o.id)).size !== d.operations.length ||
      new Set(d.operations.map((o) => `${o.method} ${o.path}`)).size !==
        d.operations.length
    )
      ctx.addIssue({ code: "custom", message: "Operations must be unique." });
    if (d.operations.some((o) => o.method === "GET" && o.body))
      ctx.addIssue({ code: "custom", message: "GET cannot have a body." });
  });
export type Definition = z.infer<typeof definitionSchema>;
export const brokerRequestSchema = z
  .object({
    integration: id,
    operation: id,
    query: z.record(z.string().max(4000)).default({}),
    body: z.unknown().optional(),
  })
  .strict();
export type BrokerRequest = z.infer<typeof brokerRequestSchema>;
interface Record {
  definition: Definition;
  revision: string;
  approved: boolean;
}
export interface BrokerResponse {
  status: number;
  body: unknown;
}
export type Transport = (
  url: URL,
  method: string,
  headers: { [key: string]: string },
  body?: string,
) => Promise<BrokerResponse>;
const blocked = new BlockList();
for (const [a, p] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const)
  blocked.addSubnet(a, p, "ipv4");
const global6 = new BlockList();
global6.addSubnet("2000::", 3, "ipv6");
for (const [a, p] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  blocked.addSubnet(a, p, "ipv6");
export function publicAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4
    ? !blocked.check(address, "ipv4")
    : family === 6 &&
        global6.check(address, "ipv6") &&
        !blocked.check(address, "ipv6");
}

/** Resolve once, then connect to the vetted numeric address with the original TLS identity.
 * No ambient HTTP proxies, redirects, cookies, connection pooling, or automatic retries. */
export const sendPublic: Transport = async (url, method, headers, body) => {
  const addresses = await Promise.race([
    lookup(url.hostname, { all: true }),
    new Promise<never>((_, reject) => {
      const t = setTimeout(
        () => reject(new BrokerError("DNS lookup timed out.")),
        5000,
      );
      t.unref();
    }),
  ]);
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new BrokerError(
      "API destination must resolve only to public addresses.",
    );
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: addresses[0]!.address,
        family: addresses[0]!.family,
        servername: url.hostname,
        port: 443,
        path: url.pathname + url.search,
        method,
        agent: false,
        rejectUnauthorized: true,
        headers: {
          ...headers,
          host: url.hostname,
          "accept-encoding": "identity",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > 1_048_576) res.destroy(new Error("size"));
          else chunks.push(Buffer.from(chunk));
        });
        res.on("error", () =>
          reject(new BrokerError("API response failed or exceeded 1 MiB.")),
        );
        res.on("end", () => {
          const status = res.statusCode ?? 502;
          // Never return upstream error bodies or headers (which can echo credentials).
          if (status >= 300) {
            resolve({
              status,
              body: {
                error:
                  status < 400
                    ? "Redirect blocked."
                    : "Provider rejected the request.",
              },
            });
            return;
          }
          try {
            resolve({
              status,
              body: size
                ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
                : null,
            });
          } catch {
            reject(new BrokerError("Only JSON API responses are supported."));
          }
        });
      },
    );
    const timer = setTimeout(() => req.destroy(new Error("timeout")), 15000);
    req.on("close", () => clearTimeout(timer));
    req.on("error", () =>
      reject(
        new BrokerError("API connection failed. No automatic retry was made."),
      ),
    );
    req.end(body);
  });
};

function redact(value: unknown, key: string): unknown {
  if (typeof value === "string") return value.split(key).join("[redacted]");
  if (Array.isArray(value)) return value.map((v) => redact(v, key));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k.split(key).join("[redacted]"),
        redact(v, key),
      ]),
    );
  return value;
}

export class IntegrationBroker {
  private active = 0;
  constructor(
    private state: JsonState,
    private secrets: IntegrationSecrets,
    private transport: Transport = sendPublic,
  ) {}
  list() {
    return this.state.list<Record>("integration-definition:").map((r) => ({
      ...r.definition,
      revision: r.revision,
      approved: r.approved,
      configured: r.approved && this.secrets.has(r.definition.id),
      status:
        r.approved && this.secrets.has(r.definition.id)
          ? "ready"
          : "setup_required",
      source: this.secrets.has(r.definition.id) ? "saved" : null,
      setupUrl: "/connectors/keys",
      execution: ["request", "cli_proxy"],
      links: [
        {
          label: "Provider documentation (agent supplied)",
          url: r.definition.docsUrl,
        },
      ],
      steps: [
        "Review the API destination and every operation below. These details were proposed by the agent.",
        "Create a restricted key with the provider. Saving grants ongoing access to the listed operations, including writes.",
        "Enter the key here. No API request is sent during setup; credentials are checked on first use.",
      ],
      lastRequest:
        this.state.get(`integration-activity:${r.definition.id}`) ?? null,
    }));
  }
  propose(raw: unknown) {
    const parsed = definitionSchema.safeParse(raw);
    if (!parsed.success)
      throw new BrokerError(
        "Invalid integration definition. Use HTTPS, exact paths, header or Bearer authentication, and unique operations.",
      );
    const d = parsed.data;
    const existing = this.state.get<Record>(`integration-definition:${d.id}`);
    if (existing) {
      if (JSON.stringify(existing.definition) === JSON.stringify(d))
        return this.list().find((i) => i.id === d.id);
      throw new BrokerError(
        "This integration already exists. Remove it in setup before changing its approved destination or operations.",
      );
    }
    if (this.list().length >= 30)
      throw new BrokerError(
        "Integration limit reached. Remove an unused integration first.",
      );
    this.state.set(`integration-definition:${d.id}`, {
      definition: d,
      revision: randomUUID(),
      approved: false,
    });
    return this.list().find((i) => i.id === d.id);
  }
  save(id: string, raw: unknown) {
    const p = z
      .object({
        key: z
          .string()
          .min(8)
          .max(4096)
          .regex(/^[\x21-\x7e]+$/),
        revision: z.string(),
        approved: z.literal(true),
      })
      .strict()
      .safeParse(raw);
    const r = this.state.get<Record>(`integration-definition:${id}`);
    if (!p.success || !r || r.revision !== p.data.revision)
      throw new BrokerError(
        "Review the current integration details and approve access before saving.",
      );
    this.secrets.set(id, p.data.key);
    this.state.set(`integration-definition:${id}`, { ...r, approved: true });
  }
  remove(id: string) {
    this.secrets.remove(id);
    this.state.delete(`integration-definition:${id}`);
    this.state.delete(`integration-activity:${id}`);
    // Usage remains until its rolling day expires; deletion cannot reset limits.
  }
  async execute(raw: unknown): Promise<BrokerResponse> {
    if (Buffer.byteLength(JSON.stringify(raw) ?? "") > 32768)
      throw new BrokerError("Request exceeds 32 KiB.");
    const p = brokerRequestSchema.safeParse(raw);
    if (!p.success) throw new BrokerError("Invalid integration request.");
    const a = p.data;
    const r = this.state.get<Record>(`integration-definition:${a.integration}`);
    if (!r?.approved)
      throw new BrokerError(
        "Setup required. Open /connectors/keys to approve this integration.",
      );
    const op = r.definition.operations.find((o) => o.id === a.operation);
    if (
      !op ||
      Object.keys(a.query).some((k) => !op.query.includes(k)) ||
      (a.body !== undefined && !op.body)
    )
      throw new BrokerError("Request is outside the approved operation.");
    const key = this.secrets.get(a.integration);
    if (!key)
      throw new BrokerError("Credential missing. Open /connectors/keys.");
    if (this.active >= 4)
      throw new BrokerError(
        "Too many API requests are running. Try again later.",
      );
    const now = Date.now();
    const usageKey = `integration-usage:${a.integration}`;
    const usage = (this.state.get<number[]>(usageKey) ?? []).filter(
      (t) => t > now - 86400000,
    );
    if (
      usage.length >= 1000 ||
      usage.filter((t) => t > now - 60000).length >= 30
    )
      throw new BrokerError(
        "Integration request limit reached (30/minute, 1000/day).",
      );
    this.state.set(usageKey, [...usage, now]);
    const url = new URL(op.path, r.definition.origin);
    for (const [k, v] of Object.entries(a.query)) url.searchParams.set(k, v);
    const auth = r.definition.auth;
    const headers = {
      "content-type": "application/json",
      accept: "application/json",
      [auth.type === "bearer" ? "authorization" : auth.name.toLowerCase()]:
        auth.type === "bearer" ? `Bearer ${key}` : key,
    };
    this.active++;
    try {
      const response = await this.transport(
        url,
        op.method,
        headers,
        a.body === undefined ? undefined : JSON.stringify(a.body),
      );
      this.state.set(`integration-activity:${a.integration}`, {
        at: now,
        operation: op.id,
        status: response.status,
      });
      // Defense in depth, not a substitute for trusting the approved provider.
      return redact(response, key) as BrokerResponse;
    } catch {
      this.state.set(`integration-activity:${a.integration}`, {
        at: now,
        operation: op.id,
        status: "failed",
      });
      throw new BrokerError(
        "API request failed. Check the provider and operation. No automatic retry was made.",
      );
    } finally {
      this.active--;
    }
  }
}
