import { bubble, openChat, send } from "../lib/chat.ts";
import { expect, nonce, test } from "../lib/harness.ts";

test("agent saves a report, chat shows its document link, and the library recovers it", async ({ page, request }) => {
  await openChat(page);
  const tag = nonce();
  expect((await send(page, `E2E-ARTIFACT #${tag}`)).status).toBe(202);
  const reply = bubble(page, `re-${tag}`);
  const link = reply.getByRole("link", { name: new RegExp(`Report ${tag}`) });
  await expect(link).toBeVisible({ timeout: 20_000 });
  const href = await link.getAttribute("href");
  expect(href).toMatch(/^\/artifacts\/[0-9a-f-]+$/);
  await link.click();
  await expect(page.getByRole("heading", { name: `Findings ${tag}` })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: `Findings ${tag}` })).toBeVisible();
  await page.goto("/artifacts");
  await page.getByRole("searchbox").fill(`evidence ${tag}`);
  await expect(page.getByRole("link", { name: new RegExp(`Report ${tag}`) })).toBeVisible();
  const response = await request.get(`/api/artifacts/${href!.split('/').at(-1)}`, { headers: { "Sec-Fetch-Site": "same-origin" } });
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ title: `Report ${tag}`, version: 1, conversationId: "main" });
});
