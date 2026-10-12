import { bubble, openChat, send, textbox } from "../lib/chat.ts";
import { expect, nonce, stack, test, type Page } from "../lib/harness.ts";

interface Channel {
  id: string;
  pending: { asks: number; approvals: number; total: number };
  attention: { kind: string; id: string }[];
}
async function channels(page: Page): Promise<Channel[]> {
  const response = await page.request.get("/api/channels");
  expect(response.ok()).toBe(true);
  return (await response.json()).channels;
}
async function question(page: Page, key: string): Promise<string> {
  await expect.poll(async () => (await channels(page)).find(c => c.id === "main")?.pending.asks).toBe(1);
  const rows = await stack.query<{ askId: string }>(
    "SELECT json_extract(data, '$.askId') AS askId FROM web_events WHERE conversation_id = 'main' AND type = 'ask' AND json_extract(data, '$.question') = ? ORDER BY seq DESC LIMIT 1",
    `Choose day for ${key}`,
  );
  expect(rows).toHaveLength(1);
  return rows[0]!.askId;
}
async function replyJson(page: Page, tag: string) {
  await expect(bubble(page, `re-${tag}`)).toContainText("{");
  const text = await bubble(page, `re-${tag}`).innerText();
  return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
}

test("an abrupt workspace restart withdraws a pending decision without replaying permission", async ({ page, watch }) => {
  test.setTimeout(90_000);
  await openChat(page);
  const key = nonce();
  await send(page, `E2E-OWNER-DECISION key-${key} #${key}`);
  const askId = await question(page, key);
  await expect(page.getByRole("button", { name: "Monday", exact: true })).toBeVisible();
  await stack.restartWorkspace({ crash: true });
  await expect.poll(async () => (await channels(page)).find(c => c.id === "main")?.pending.total).toBe(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Monday", exact: true })).toHaveCount(0);
  const terminal = await stack.query<{ data: string }>("SELECT data FROM web_events WHERE conversation_id = 'main' AND type = 'ask_resolved' AND key = ?", askId);
  expect(terminal).toHaveLength(1);
  expect(JSON.parse(terminal[0]!.data)).toEqual({ askId, answer: null });
  const stale = await page.request.post(`/api/chat/asks/${askId}`, { data: { index: 0, label: "Monday" } });
  expect((await stale.json()).status).toBe("duplicate");
  const unchanged = await stack.query<{ data: string }>("SELECT data FROM web_events WHERE conversation_id = 'main' AND type = 'ask_resolved' AND key = ?", askId);
  expect(JSON.parse(unchanged[0]!.data).answer).toBeNull();
  expect((await stack.llmLog()).filter(r => r.userText.includes(`key-${key}`))).toHaveLength(1);
  const continued = nonce();
  await send(page, `E2E-ECHO after-restart #${continued}`);
  await expect(bubble(page, `re-${continued}`)).toContainText("Echo after-restart.");
  expect(await watch.violations()).toEqual([]);
});

test("parallel channels reuse one canonical decision and answering clears navigator attention", async ({ page, context, watch }) => {
  test.setTimeout(90_000);
  await openChat(page);
  const key = nonce();
  await send(page, `E2E-OWNER-DECISION key-${key} #${key}`);
  const askId = await question(page, key);
  const created = await page.request.post("/api/threads", { data: { messageId: "", title: `Request coordination ${key}` } });
  expect(created.status()).toBe(201);
  const topicId = (await created.json()).id;
  const topic = await context.newPage();
  await topic.goto(`/chats/${topicId}`);
  await expect(textbox(topic)).toBeVisible();
  const duplicate = nonce();
  await textbox(topic).fill(`E2E-OWNER-DECISION key-${key} #${duplicate}`);
  await topic.getByRole("button", { name: "Send message", exact: true }).click();
  expect(await replyJson(topic, duplicate)).toMatchObject({ status: "already_pending", request: { requestId: askId, conversationId: "main", origin: { surface: "web", conversationId: "main" } } });
  let catalog = await channels(page);
  expect(catalog.find(c => c.id === "main")?.attention).toContainEqual(expect.objectContaining({ kind: "ask", id: askId }));
  expect(catalog.find(c => c.id === topicId)?.pending.total).toBe(0);
  const duplicateAsks = await stack.query("SELECT seq FROM web_events WHERE type = 'ask' AND json_extract(data, '$.question') = ?", `Choose day for ${key}`);
  expect(duplicateAsks).toHaveLength(1);
  const listing = nonce();
  await textbox(topic).fill(`E2E-CHANNEL-REQUESTS #${listing}`);
  await topic.getByRole("button", { name: "Send message", exact: true }).click();
  const discovered = await replyJson(topic, listing);
  expect(discovered.requests).toContainEqual(expect.objectContaining({ id: askId, kind: "ask", conversationId: "main" }));
  await page.getByRole("button", { name: "Monday", exact: true }).click();
  expect(await replyJson(page, key)).toMatchObject({ status: "answered", answer: "Monday", request: { requestId: askId, status: "answered" } });
  await expect.poll(async () => (await channels(page)).find(c => c.id === "main")?.pending.total).toBe(0);
  catalog = await channels(page);
  expect(catalog.find(c => c.id === topicId)?.pending.total).toBe(0);
  const modelRequest = await stack.waitForLlm(r => r.userText.includes(`key-${key}`));
  expect(modelRequest.tools).toContain("request_owner_decision");
  expect(modelRequest.tools).toContain("list_owner_requests");
  expect(modelRequest.tools).toContain("list_channel_requests");
  expect(await watch.violations()).toEqual([]);
});
