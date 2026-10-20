import { bubble, openChat, send } from "../lib/chat.ts";
import { expect, nonce, test } from "../lib/harness.ts";

test("rich blocks render from a streamed reply, and an invalid block is repaired by the gateway check", async ({ page }) => {
  await openChat(page);
  const tag = nonce();
  expect((await send(page, `E2E-RICH #${tag}`)).status).toBe(202);
  const reply = bubble(page, `re-${tag}`);

  // The first reply has an invalid bars block; the gateway asks once, and the rewritten reply is
  // what the conversation keeps.
  const fixed = reply.getByRole("figure").filter({ hasText: `Spend fixed ${tag}` });
  await expect(fixed).toBeVisible({ timeout: 20_000 });
  await expect(fixed.getByRole("img", { name: /Food: \$412/ })).toBeVisible();
  await expect(reply.getByText(/Couldn't show this bars/)).toHaveCount(0);

  // The breakdown computes its own total and shares, and is announced as one image with its data.
  await expect(reply.getByRole("figure").filter({ hasText: "Daily calories" })).toBeVisible();
  await expect(reply.getByRole("img", { name: /Total: 281\.3 kcal\/day/ })).toBeVisible();
  await expect(reply.getByText("Weigh the food for a week first.")).toBeVisible();
  await expect(reply.getByText("Heads up", { exact: true })).toBeVisible();
  // Never raw YAML for a valid block.
  await expect(reply.getByText("segments:")).toHaveCount(0);

  await page.reload();
  const reloaded = bubble(page, `re-${tag}`);
  await expect(reloaded.getByRole("img", { name: /Total: 281\.3 kcal\/day/ })).toBeVisible();
  await expect(reloaded.getByRole("figure").filter({ hasText: `Spend fixed ${tag}` })).toBeVisible();
});
