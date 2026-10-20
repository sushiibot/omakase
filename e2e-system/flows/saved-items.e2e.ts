import { bubble, openChat, send } from "../lib/chat.ts";
import { expect, nonce, test } from "../lib/harness.ts";

type Item = { kind: string; id: string; title: string; sourceMessageId: string | null; pinned: boolean };

test("the agent's document and checklist are saved items with links back to their reply; pins reach Home", async ({ page, request, watch }) => {
  await openChat(page);
  const tag = nonce();
  expect((await send(page, `E2E-SAVED #${tag}`)).status).toBe(202);
  const reply = bubble(page, `re-${tag} saved`);
  await expect(reply.getByRole("link", { name: new RegExp(`Saved doc ${tag}`) })).toBeVisible({ timeout: 20_000 });
  const list = reply.getByRole("figure").filter({ hasText: `Saved list ${tag}` });
  await expect(list.getByRole("textbox", { name: "Add an item" })).toBeVisible({ timeout: 20_000 });

  // Both came from the same reply: the checklist by its key, the document by the link in it.
  const headers = { "Sec-Fetch-Site": "same-origin" };
  const listed = (await (await request.get(`/api/saved?status=all&q=${tag}`, { headers })).json()) as { items: Item[] };
  const doc = listed.items.find((i) => i.kind === "document")!;
  const checklist = listed.items.find((i) => i.kind === "checklist")!;
  expect(doc).toMatchObject({ title: `Saved doc ${tag}`, pinned: false });
  expect(checklist).toMatchObject({ title: `Saved list ${tag}`, pinned: false });
  expect(doc.sourceMessageId).toMatch(/^[0-9A-Za-z_-]{8,64}$/);
  expect(doc.sourceMessageId).toBe(checklist.sourceMessageId);
  const from = `/chat?m=${doc.sourceMessageId}`;

  // The library finds both, and each page's From link lands on the reply.
  await page.goto("/saved");
  await page.getByRole("searchbox").fill(tag);
  await expect(page.locator("[data-saved-row]")).toHaveCount(2);
  await page.getByRole("link", { name: new RegExp(`Saved doc ${tag}`) }).click();
  await expect(page.getByRole("heading", { name: `Notes ${tag}` })).toBeVisible();
  await expect(page.locator("[data-saved-provenance]").getByRole("link")).toHaveAttribute("href", from);
  // The owner pins the document.
  await page.getByRole("button", { name: "Pin", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pin", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.goto(`/saved/checklist/${checklist.id.replace(".", "~")}`);
  await expect(page.getByRole("figure").filter({ hasText: `Saved list ${tag}` }).getByRole("checkbox", { name: "tent" })).toBeVisible();
  await expect(page.locator("[data-saved-provenance]").getByRole("link")).toHaveAttribute("href", from);

  // The conversation's Saved tab lists both.
  await openChat(page);
  await page.getByRole("button", { name: /^Tasks/ }).first().click();
  await page.getByRole("tab", { name: "Saved" }).click();
  const panel = page.locator("[data-saved-panel]");
  await expect(panel.getByRole("link", { name: new RegExp(`Saved doc ${tag}`) })).toBeVisible();
  await expect(panel.getByRole("link", { name: new RegExp(`Saved list ${tag}`) })).toBeVisible();

  // Home shows the pinned document under In use.
  await page.goto("/assistant");
  const inUse = page.locator("[data-saved-in-use]");
  await expect(inUse.getByRole("link", { name: new RegExp(`Saved doc ${tag}`) })).toBeVisible({ timeout: 10_000 });

  // The agent pins the checklist with its own tool; Home updates without a reload.
  const pinTag = nonce();
  await openChat(page);
  expect((await send(page, `E2E-SAVED-PIN #${pinTag} target=${tag}`)).status).toBe(202);
  await expect(bubble(page, `re-${pinTag} Pinned: Saved list ${tag}`)).toBeVisible({ timeout: 20_000 });
  const pinned = (await (await request.get(`/api/saved?id=${encodeURIComponent(checklist.id)}`, { headers })).json()) as { items: Item[] };
  expect(pinned.items[0]).toMatchObject({ id: checklist.id, pinned: true });
  // In chat, the checklist's Pin control shows it pinned.
  await expect(list.getByRole("textbox", { name: "Add an item" })).toBeVisible();
  await expect(reply.getByRole("button", { name: "Pin", exact: true })).toHaveAttribute("aria-pressed", "true", { timeout: 10_000 });
  await page.goto("/assistant");
  await expect(inUse.getByRole("link", { name: new RegExp(`Saved list ${tag}`) })).toBeVisible({ timeout: 10_000 });
  expect(await watch.violations()).toEqual([]);
});
