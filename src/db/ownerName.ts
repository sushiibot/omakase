import type { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import { kv } from "./schema.ts";
import { ownerName } from "../orchestration/contracts.ts";

export const OWNER_NAME_KEY = "owner:name";

/** The owner's display name, set in the app's Settings; null when none is set. */
export class OwnerNameStore {
  private readonly orm;

  constructor(db: Database) {
    this.orm = drizzle({ client: db, schema: { kv } });
  }

  get(): string | null {
    const raw = this.orm.select().from(kv).where(eq(kv.key, OWNER_NAME_KEY)).get()?.value;
    if (raw === undefined) return null;
    // It goes into prompts and the register result, so a value that no longer validates reads as unset.
    const parsed = ownerName.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  /** `name` must already have passed the `ownerName` contract; null clears it. */
  set(name: string | null): void {
    if (name === null) {
      this.orm.delete(kv).where(eq(kv.key, OWNER_NAME_KEY)).run();
      return;
    }
    this.orm.insert(kv).values({ key: OWNER_NAME_KEY, value: name }).onConflictDoUpdate({ target: kv.key, set: { value: name } }).run();
  }
}
