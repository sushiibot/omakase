import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { JsonState } from "../db/jsonState.ts";

interface Sealed { iv: string; tag: string; ciphertext: string }
const prefix = "integration-secret:";

/** Gateway-only encryption key. The workspace must never mount this file or the gateway database.
 * Back up both together; database-only backups contain no plaintext credentials. */
export function secretEncryptionKey(path: string, hasSavedCredentials = false): Buffer {
  if (hasSavedCredentials && !existsSync(path)) throw new Error("Integration encryption key is missing. Restore it before starting the gateway.");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try { writeFileSync(path, randomBytes(32), { flag: "wx", mode: 0o600 }); }
  catch (err) { if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw new Error("Could not initialize integration secret storage."); }
  chmodSync(path, 0o600);
  const key = readFileSync(path);
  if (key.length !== 32) throw new Error("Invalid integration encryption key; restore the original key file.");
  return key;
}

export class IntegrationSecrets {
  constructor(private readonly state: JsonState, private readonly key: Buffer) {
    if (key.length !== 32) throw new Error("Invalid integration encryption key.");
  }
  has(id: string): boolean { return this.state.get(prefix + id) !== undefined; }
  set(id: string, value: string): void {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(prefix + id));
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    this.state.set(prefix + id, { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") } satisfies Sealed);
  }
  get(id: string): string | undefined {
    const sealed = this.state.get<Sealed>(prefix + id);
    if (!sealed) return undefined;
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(sealed.iv, "base64"));
      decipher.setAAD(Buffer.from(prefix + id));
      decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
      return Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, "base64")), decipher.final()]).toString("utf8");
    } catch { throw new Error("Saved credential could not be opened. Restore the original encryption key or replace the credential."); }
  }
  remove(id: string): void { this.state.delete(prefix + id); }
}
