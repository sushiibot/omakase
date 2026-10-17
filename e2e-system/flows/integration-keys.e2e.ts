import { bubble, openChat, send } from "../lib/chat.ts";
import { expect, nonce, stack, test } from "../lib/harness.ts";

test("agent guides setup; encrypted credentials survive gateway restart without reaching the model", async ({ page }) => {
  let seenSeq = 0;
  page.on("response", response => {
    if (new URL(response.url()).pathname === "/api/chat/seen" && response.ok()) {
      seenSeq = Math.max(seenSeq, (response.request().postDataJSON() as { seq: number }).seq);
    }
  });
  async function readReply(tag: string) {
    // Finish the turn and acknowledge it before navigating away. Otherwise its deferred push
    // can reach a subscription created by the next flow on this shared stack.
    let seq = 0;
    await expect.poll(async () => {
      const rows = await stack.query<{ seq: number }>("select seq from web_events where type = 'reply' and data like ? order by seq desc limit 1", `%re-${tag}%`);
      return seq = rows[0]?.seq ?? 0;
    }).toBeGreaterThan(0);
    await expect.poll(() => seenSeq).toBeGreaterThanOrEqual(seq);
  }
  await openChat(page);
  const tag = nonce();
  const text = `E2E-INTEGRATIONS check services #${tag}`;
  expect((await send(page, text)).status).toBe(202);
  const reply = bubble(page, `re-${tag}`);
  await expect(reply.getByRole("link", { name: "Set up API keys" })).toBeVisible({ timeout: 20_000 });
  const before = await stack.waitForLlm(l => l.userText.includes(text) && l.lastRole === "tool");
  expect(before.lastTool).toContain('"configured":false');
  await readReply(tag);
  await reply.getByRole("link", { name: "Set up API keys" }).click();
  await expect(page.getByText("Setup needed", { exact: true })).toBeVisible();
  const key = "e2e-google-credential-1234567890";
  await page.getByLabel("API key", { exact: true }).fill(key);
  await page.getByRole("button", { name: "Save and test" }).click();
  await expect(page.getByText("Key saved on server", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Replacement API key")).toHaveValue("");
  const records = await stack.query<{ value: string }>("select value from kv where key = ?", "integration-secret:google_maps");
  expect(records).toHaveLength(1);
  expect(records[0]!.value).not.toContain(key);
  expect(JSON.parse(records[0]!.value)).toHaveProperty("ciphertext");
  await stack.restartPersonal({ waitReady: true });
  await page.reload();
  await expect(page.getByText("Key saved on server", { exact: true })).toBeVisible();
  await openChat(page);
  const nextTag = nonce();
  const next = `E2E-INTEGRATIONS check saved service #${nextTag}`;
  expect((await send(page, next)).status).toBe(202);
  const after = await stack.waitForLlm(l => l.userText.includes(next) && l.lastRole === "tool");
  expect(after.lastTool).toContain('"configured":true');
  await readReply(nextTag);
  const searchTag = nonce();
  const search = `E2E-MAPS-SAVED search with the saved credential #${searchTag}`;
  expect((await send(page, search)).status).toBe(202);
  const searched = await stack.waitForLlm(l => l.userText.includes(search) && l.lastRole === "tool");
  expect(searched.lastTool).toContain("e2e-place");
  expect(JSON.stringify(await stack.llmLog())).not.toContain(key);
  await readReply(searchTag);
  await page.goto("/connectors/keys");
  await page.getByRole("button", { name: "Remove key", exact: true }).click();
  await page.getByRole("button", { name: "Confirm removal" }).click();
  await expect(page.getByText("Setup needed", { exact: true })).toBeVisible();
});
