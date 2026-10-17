import { bubble, openChat, send } from "../lib/chat.ts";
import { expect, nonce, stack, test } from "../lib/harness.ts";

test("edit and delete rewind the real workspace and persist after reload", async ({ page, watch }) => {
  await openChat(page);
  const tag = nonce();
  const original = `E2E-ECHO original #${tag}`;
  expect((await send(page, original)).status).toBe(202);
  await expect(bubble(page, `re-${tag}`)).toContainText("Echo original.");
  await expect(page.getByRole("button", { name: "Stop generating" })).toHaveCount(0);
  await bubble(page, original).getByRole("button", { name: "Edit and resend", exact: true }).click();
  const revised = `E2E-ECHO revised #${tag}`;
  await page.getByRole("textbox", { name: "Edit message", exact: true }).fill(revised);
  await page.getByRole("button", { name: "Save and resend" }).click();
  await expect(bubble(page, `re-${tag}`)).toContainText("Echo revised.");
  await expect(page.getByText(original, { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(bubble(page, revised)).toBeVisible();
  await bubble(page, revised).getByRole("button", { name: "Delete from here", exact: true }).click();
  await page.getByRole("form", { name: "Change conversation history" }).getByRole("button", { name: "Delete from here", exact: true }).click();
  await expect(page.getByText(revised, { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeVisible();
  await expect(page.getByText(revised, { exact: true })).toHaveCount(0);
  expect((await stack.query("SELECT seq FROM web_events WHERE type = 'user' AND data LIKE ?", `%${tag}%`)).length).toBe(0);
  expect(await watch.violations()).toEqual([]);
});
