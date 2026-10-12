import type { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq, like } from "drizzle-orm";
import { kv } from "./schema.ts";

export interface JsonState {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  /** Values under keys starting with `prefix` (no SQL wildcards). */
  list<T>(prefix: string): T[];
}

/** Coding agent records and event bookkeeping in the gateway's key-value table. */
export class KvJsonState implements JsonState {
  private readonly orm;

  constructor(db: Database) {
    this.orm = drizzle({ client: db, schema: { kv } });
  }

  get<T>(key: string): T | undefined {
    const raw = this.orm.select().from(kv).where(eq(kv.key, key)).get()?.value;
    if (raw === undefined) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  list<T>(prefix: string): T[] {
    const out: T[] = [];
    for (const row of this.orm.select().from(kv).where(like(kv.key, `${prefix}%`)).all()) {
      try {
        out.push(JSON.parse(row.value) as T);
      } catch {
        /* skip a corrupt row */
      }
    }
    return out;
  }

  set(key: string, value: unknown): void {
    const json = JSON.stringify(value);
    this.orm.insert(kv).values({ key, value: json }).onConflictDoUpdate({ target: kv.key, set: { value: json } }).run();
  }
}
