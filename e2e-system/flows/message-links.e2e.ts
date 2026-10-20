import { bubble, openChat, send } from "../lib/chat.ts";
import { expect, nonce, stack, test } from "../lib/harness.ts";

// A message link (web/docs/message-links.md) to a reply older than the first history page loads the
// page around it from the real gateway and lands on it.
test("a link to a reply beyond the first history page lands on it, highlighted", async ({ page, watch }) => {
  test.setTimeout(180_000);
  await openChat(page);
  const tag = nonce();
  expect((await send(page, `E2E-ECHO linked #${tag}`)).status).toBe(202);
  await expect(bubble(page, `re-${tag}`)).toContainText("Echo linked.");
  const [row] = (await stack.query("select key from web_events where type = 'reply' and data like ?", `%re-${tag}%`)) as { key: string }[];
  expect(row?.key).toMatch(/^[0-9A-Za-z_-]{8,64}$/);

  // 21 more exchanges push it past the newest 40 history items.
  for (let i = 0; i < 21; i++) {
    const fill = nonce();
    expect((await send(page, `E2E-FILL-${i} #${fill}`)).status).toBe(202);
    await expect(bubble(page, `re-${fill}`)).toBeVisible();
  }
  const newest = await page.evaluate(async () => (await (await fetch("/api/chat/history?limit=40")).json()) as { items: { outboxId?: string }[] });
  expect(newest.items.some((i) => i.outboxId === row!.key)).toBe(false);

  const fresh = await page.context().newPage();
  await fresh.goto(`/chat?m=${encodeURIComponent(row!.key)}`);
  const linked = fresh.locator(`[data-message-key="${row!.key}"]`);
  await expect(linked).toBeFocused();
  await expect(linked).toContainText(`re-${tag}`);
  await expect(linked).toHaveAttribute("data-landed", /tint|fade|outline/);
  await expect(linked).toBeInViewport();
  const bar = fresh.locator("[data-detached-bar]");
  await expect(bar).toContainText("Earlier messages");
  await bar.getByRole("button", { name: "Jump to latest" }).click();
  await expect(bar).toHaveCount(0);
  await expect(fresh).toHaveURL(/\/chat$/);
  await fresh.close();
  expect(await watch.violations()).toEqual([]);
});
