import { bubble, openChat, textbox } from "../lib/chat.ts";
import { expect, nonce, stack, test } from "../lib/harness.ts";

test("manual tasks persist, execute in their own conversation, and accept follow-ups", async ({
  page,
  context,
  watch,
}) => {
  await openChat(page);
  const main = await context.newPage();
  await openChat(main);
  await textbox(main).fill("Keep this main draft");
  await page.goto("/tasks");
  const tag = nonce();
  await page.getByRole("textbox", { name: "New task" }).fill(`Task ${tag}`);
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await page.getByRole("button", { name: `Task ${tag}`, exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\/t-/);
  const taskUrl = page.url();
  const id = new URL(taskUrl).pathname.split("/").at(-1)!;
  await page
    .getByRole("textbox", { name: "New checklist step" })
    .fill("Verify the result");
  await page.getByRole("button", { name: "Add checklist step" }).click();
  await expect(
    page.getByRole("checkbox", { name: "Verify the result" }),
  ).not.toBeChecked();
  let task = await page.evaluate(
    async (id) =>
      (await (await fetch("/api/tasks")).json()).tasks.find(
        (t: { id: string }) => t.id === id,
      ),
    id,
  );
  expect(task.status).toBe("todo");
  expect(task.runIds).toEqual([]);
  await page
    .getByRole("textbox", { name: "Brief", exact: true })
    .fill(`Task question #${tag}`);
  await page
    .getByRole("button", { name: "Ask Sushii to work on this", exact: true })
    .click();
  await expect(bubble(page, `re-${tag}`)).toContainText("Done.");
  await expect(bubble(main, `re-${tag}`)).toHaveCount(0);
  await expect(textbox(main)).toHaveValue("Keep this main draft");
  const followup = nonce();
  await textbox(page).fill(`Task follow-up #${followup}`);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(bubble(page, `re-${followup}`)).toContainText("Done.");
  await stack.restartWorkspace();
  await page.reload();
  await page.getByRole("tab", { name: "Conversation", exact: true }).click();
  await expect(bubble(page, `re-${followup}`)).toContainText("Done.");
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Verify the result" }),
  ).not.toBeChecked();
  task = await page.evaluate(
    async (id) =>
      (await (await fetch("/api/tasks")).json()).tasks.find(
        (t: { id: string }) => t.id === id,
      ),
    id,
  );
  expect(task.workConversationId).toBe(`task-${id}`);
  expect(task.runIds.length).toBeGreaterThanOrEqual(2);
  expect(task.status).toBe("needs-you");
  await page.getByRole("button", { name: "Mark done", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reopen task" })).toBeVisible();
  await page.getByRole("tab", { name: "Conversation", exact: true }).click();
  const acknowledgement = nonce();
  await textbox(page).fill(`Thanks for finishing #${acknowledgement}`);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(bubble(page, `re-${acknowledgement}`)).toContainText("Done.");
  await stack.restartWorkspace();
  await page.goto("/tasks");
  await expect(page.getByRole("checkbox", { name: `Mark Task ${tag} to do`, exact: true })).toBeHidden();
  await page.getByRole("button", { name: /^Done \d+$/ }).click();
  const completed = page.getByRole("checkbox", { name: `Mark Task ${tag} to do`, exact: true });
  await expect(completed).toBeChecked();
  await completed.uncheck();
  await expect(page.getByRole("region", { name: "To do", exact: true }).getByRole("checkbox", { name: `Mark Task ${tag} done`, exact: true })).toBeVisible();
  const conversations = await page.evaluate(
    async () => await (await fetch("/api/chats")).json(),
  );
  expect(
    conversations.threads.some((t: { id: string }) => t.id === `task-${id}`),
  ).toBe(false);
  expect(await watch.violations()).toEqual([]);
});
