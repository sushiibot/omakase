import { bubble, openChat, send } from "../lib/chat.ts";
import { expect, nonce, test } from "../lib/harness.ts";

test("a checklist is stored: ticks persist, sync live across devices, and the agent reads and changes it", async ({ page, context }) => {
  await openChat(page);
  const tag = nonce();
  expect((await send(page, `E2E-LIVE #${tag}`)).status).toBe(202);
  const list = bubble(page, `re-${tag} live list`).getByRole("figure").filter({ hasText: `Groceries ${tag}` });
  // Bound to the stored block: only a live checklist offers to add items.
  await expect(list.getByRole("textbox", { name: "Add an item" })).toBeVisible({ timeout: 20_000 });
  await list.getByRole("checkbox", { name: "milk" }).click();
  await expect(list.getByText("1 of 2 done")).toBeVisible();

  // A second device sees the stored tick, and its own change reaches the first without a reload.
  const other = await context.newPage();
  await openChat(other);
  const otherList = bubble(other, `re-${tag} live list`).getByRole("figure").filter({ hasText: `Groceries ${tag}` });
  await expect(otherList.getByRole("checkbox", { name: "milk" })).toBeChecked({ timeout: 20_000 });
  await otherList.getByRole("textbox", { name: "Add an item" }).fill("butter");
  await otherList.getByRole("button", { name: "Add", exact: true }).click();
  await expect(list.getByText("butter")).toBeVisible({ timeout: 10_000 });
  await other.close();

  // The agent finds the list with list_blocks and changes it with update_block; the owner sees it live.
  const agentTag = nonce();
  expect((await send(page, `E2E-LIVE-AGENT #${agentTag}`)).status).toBe(202);
  await expect(bubble(page, `re-${agentTag} Updated:`)).toBeVisible({ timeout: 20_000 });
  await expect(list.getByText("rice")).toBeVisible();
  await expect(list.getByRole("checkbox", { name: "eggs" })).toBeChecked();
  await expect(list.getByText("2 of 4 done")).toBeVisible();

  await page.reload();
  const reloaded = bubble(page, `re-${tag} live list`).getByRole("figure").filter({ hasText: `Groceries ${tag}` });
  await expect(reloaded.getByText("2 of 4 done")).toBeVisible({ timeout: 20_000 });
});
