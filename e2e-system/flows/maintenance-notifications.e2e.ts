import { createDecipheriv, createECDH, hkdfSync, randomBytes, randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { expect, nonce, stack, test, type CapturedPush } from "../lib/harness.ts";

/** RFC 8291 aes128gcm, decrypted with the subscription's own keys. */
function decrypt(push: CapturedPush, ua: ReturnType<typeof createECDH>, auth: Buffer): unknown {
  const body = Buffer.from(push.body, "base64");
  const salt = body.subarray(0, 16);
  const idlen = body[20]!;
  const asPublic = body.subarray(21, 21 + idlen);
  const cipher = body.subarray(21 + idlen);
  const shared = ua.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), ua.getPublicKey(), asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, auth, keyInfo, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const iv = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const decipher = createDecipheriv("aes-128-gcm", cek, iv);
  decipher.setAuthTag(cipher.subarray(cipher.length - 16));
  const padded = Buffer.concat([decipher.update(cipher.subarray(0, cipher.length - 16)), decipher.final()]);
  let end = padded.length - 1;
  while (end > 0 && padded[end] === 0) end--;
  // The last record's padding delimiter is 0x02.
  expect(padded[end]).toBe(2);
  return JSON.parse(padded.subarray(0, end).toString("utf8"));
}


test("a durable proposal delivery pushes its review link once across workspace restarts", async ({ request, watch }) => {
  const headers = { "Sec-Fetch-Site": "same-origin" };
  const ua = createECDH("prime256v1"); ua.generateKeys();
  const auth = randomBytes(16);
  const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-${nonce()}`;
  const keys = { p256dh: ua.getPublicKey().toString("base64url"), auth: auth.toString("base64url") };
  expect((await request.post("/api/push/subscribe", { headers, data: { endpoint, keys } })).status()).toBe(200);
  const id = randomUUID();
  const entry = { outboxId: `maintenance-${id}`, principalId: "owner", kind: "proactive", text: `Review update: /assistant/updates/${id}`, maintenance: { id, title: "Friday show" } };
  const enqueue = () => appendFileSync(join(stack.wsState, "outbox.jsonl"), JSON.stringify({ type: "entry", entry }) + "\n");
  const ours = async () => (await stack.pushes()).filter(p => p.endpoint === endpoint);
  try {
    // Seed the durable queue, then exercise the real workspace, gateway, and encrypted web push.
    enqueue();
    await stack.restartWorkspace({ crash: true });
    await expect.poll(async () => (await ours()).length).toBe(1);
    expect(decrypt((await ours())[0]!, ua, auth)).toMatchObject({ title: "Calendar update ready", url: `/assistant/updates/${id}`, tag: `maintenance:${id}`, renotify: false });
    // Simulate a crash after gateway acceptance but before the proposal recorded enqueue success.
    enqueue();
    await stack.restartWorkspace({ crash: true });
    const rows = await stack.query("select seq from web_events where type = 'proactive' and json_extract(data, '$.key') = ?", entry.outboxId);
    expect(rows).toHaveLength(1);
    expect(await ours()).toHaveLength(1);
    expect(await watch.violations()).toEqual([]);
  } finally {
    await request.post("/api/push/unsubscribe", { headers, data: { endpoint } });
  }
});
