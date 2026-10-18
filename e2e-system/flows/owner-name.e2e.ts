// The name set in Settings is saved by the gateway, reaches the live workspace and lands in the system prompt.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { bubble, openChat, send } from "../lib/chat.ts";
import { expect, nonce, stack, test } from "../lib/harness.ts";

async function workspaceName(): Promise<string | null | undefined> {
  try {
    return (JSON.parse(await readFile(join(stack.wsState, "owner.json"), "utf8")) as { name: string | null }).name;
  } catch {
    return undefined;
  }
}

test("a name saved in Settings reaches the agent's next turn, and clearing it removes it", async ({ page, watch }) => {
  const tag = nonce();
  const name = `Tester ${tag}`;
  await page.goto("/settings/preferences");
  await page.getByRole("button", { name: "Edit your name" }).click();
  const field = page.getByRole("textbox", { name: "Your name", exact: true });
  await expect(field).toBeEnabled();
  await field.fill(name);
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  expect(await stack.query("SELECT value FROM kv WHERE key = 'owner:name'")).toEqual([{ value: name }]);
  await expect.poll(workspaceName).toBe(name);

  await openChat(page);
  const text = `Who am I #${tag}`;
  await send(page, text);
  await expect(bubble(page, `re-${tag}`)).toContainText("Done.");
  const named = await stack.waitForLlm((r) => r.userText.includes(text));
  expect(named.ownerName).toBe(name);

  await page.goto("/settings/preferences");
  await page.getByRole("button", { name: "Edit your name" }).click();
  await page.getByRole("button", { name: "Clear name" }).click();
  await expect(page.getByText("Cleared.", { exact: false })).toBeVisible();
  expect(await stack.query("SELECT value FROM kv WHERE key = 'owner:name'")).toEqual([]);
  await expect.poll(workspaceName).toBeNull();

  await openChat(page);
  const after = nonce();
  const again = `Still there #${after}`;
  await send(page, again);
  await expect(bubble(page, `re-${after}`)).toContainText("Done.");
  expect((await stack.waitForLlm((r) => r.userText.includes(again))).ownerName).toBeUndefined();
  expect(await watch.violations()).toEqual([]);
});
