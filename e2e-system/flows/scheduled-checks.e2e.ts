import { bubble, openChat, send } from "../lib/chat.ts";
import { expect, nonce, stack, test } from "../lib/harness.ts";

async function checkResult(reply: ReturnType<typeof bubble>) {
  let parsed: any;
  await expect.poll(async () => {
    const text = await reply.innerText();
    try {
      parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
      return true;
    } catch {
      return false;
    }
  }).toBe(true);
  return parsed;
}

// The clock is frozen; slow CI cannot make a check due before pending assertions.
test.beforeEach(async () => { await stack.tickWakeups(); });
test.afterEach(async () => { await stack.tickWakeups(); });

test("agent schedules one follow-up, dedupes it, and wakes in the same conversation after restart", async ({
  page,
  watch,
}) => {
  test.setTimeout(90_000);
  await openChat(page);
  const tag = nonce();
  await send(page, `E2E-SCHEDULE key-${tag} #${tag}`);
  await expect(bubble(page, `re-${tag}`)).toContainText("Tool finished.");
  const again = nonce();
  await send(page, `E2E-SCHEDULE key-${tag} #${again}`);
  await expect(bubble(page, `re-${again}`)).toContainText("Tool finished.");
  const checks = async () => {
    const query = nonce();
    await send(page, `E2E-LIST-CHECKS #${query}`);
    await expect(bubble(page, `re-${query}`)).toContainText('"checks"');
    const parsed = await checkResult(bubble(page, `re-${query}`));
    return parsed.checks.filter((c: { key: string }) => c.key === `e2e-${tag}`);
  };
  const pending = await checks();
  expect(pending).toHaveLength(1);
  expect(pending[0]).toMatchObject({
    status: "pending",
    origin: { surface: "web", conversationId: "main" },
  });
  await stack.restartWorkspace();
  await page.reload();
  expect(await checks()).toEqual(pending);
  await expect(bubble(page, `re-w${tag}`)).toHaveCount(0);
  await stack.tickWakeups(pending[0].at);
  await expect(bubble(page, `re-w${tag}`)).toContainText(
    `Echo checked-${tag}.`,
    { timeout: 45_000 },
  );
  await stack.tickWakeups(pending[0].at);
  await expect(bubble(page, `re-w${tag}`)).toHaveCount(1);
  const finished = await checks();
  expect(finished).toHaveLength(1);
  expect(finished[0].status).toBe("consumed");
  await stack.tickWakeups(pending[0].at);
  expect(await checks()).toEqual(finished);
  expect((await stack.llmLog()).filter((r) => r.userText.includes(`checked-${tag}`))).toHaveLength(1);
  const request = await stack.waitForLlm((r) =>
    r.userText.includes(`checked-${tag}`),
  );
  expect(request.tools).toContain("schedule_check");
  expect(await watch.violations()).toEqual([]);
});

test("a scheduled check prepares an unstarted task and delivers into its work conversation", async ({
  page,
  watch,
}) => {
  test.setTimeout(90_000);
  await openChat(page);
  const tag = nonce();
  const task = await page.evaluate(async (title) => {
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", title }),
    });
    return (await response.json()).tasks[0];
  }, `Scheduled task ${tag}`);
  expect(task.workConversationId).toBeUndefined();
  await send(page, `E2E-SCHEDULE key-${tag} taskId:${task.id} #${tag}`);
  await expect(bubble(page, `re-${tag}`)).toContainText("Tool finished.");
  const scheduled = await checkResult(bubble(page, `re-${tag}`));
  expect(scheduled.check.status).toBe("pending");
  await expect(bubble(page, `re-w${tag}`)).toHaveCount(0);
  const beforeDue = await page.evaluate(
    async (id) => (await (await fetch("/api/tasks")).json()).tasks.find(
      (t: { id: string }) => t.id === id,
    ),
    task.id,
  );
  expect(beforeDue.workConversationId).toBeUndefined();
  await stack.tickWakeups(scheduled.check.at);
  await expect
    .poll(
      async () =>
        page.evaluate(async (id) => {
          const tasks = (await (await fetch("/api/tasks")).json()).tasks;
          return tasks.find((t: { id: string }) => t.id === id)
            ?.workConversationId;
        }, task.id),
      { timeout: 45_000 },
    )
    .toBe(`task-${task.id}`);
  await page.goto(`/tasks/${task.id}`);
  await page.getByRole("tab", { name: "Conversation", exact: true }).click();
  await expect(bubble(page, `re-w${tag}`)).toContainText(
    `Echo checked-${tag}.`,
    { timeout: 15_000 },
  );
  const updated = await page.evaluate(
    async (id) =>
      (await (await fetch("/api/tasks")).json()).tasks.find(
        (t: { id: string }) => t.id === id,
      ),
    task.id,
  );
  expect(updated.runIds).toHaveLength(1);
  const main = await page.request.get("/api/chat/history");
  expect(JSON.stringify(await main.json())).not.toContain(`re-w${tag}`);
  expect(await watch.violations()).toEqual([]);
});
