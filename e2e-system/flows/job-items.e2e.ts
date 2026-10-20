import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bubble, openChat } from "../lib/chat.ts";
import { expect, nonce, stack, test } from "../lib/harness.ts";

const JOB = "e2e-items";
const SAME_ORIGIN = { "Sec-Fetch-Site": "same-origin" };

test("a job's items take a tapped reply to Main with the item attached, the agent and the job's next run see it, and Not useful mutes the topic", async ({ page, request, watch }) => {
  test.setTimeout(180_000);
  const tag = nonce();
  // Disabled, so only this flow's request runs it.
  writeFileSync(join(stack.wsHome, "schedule.md"), `# Schedule\n\n## ${JOB}\nwhen: every 60 minutes\nenabled: false\n\nE2E-ITEMS key-${tag} check CI\n`);
  mkdirSync(join(stack.wsState, "requests"), { recursive: true });
  writeFileSync(join(stack.wsState, "requests", `${JOB}.request`), `${JSON.stringify({ requestedAt: new Date().toISOString() })}\n`);
  await stack.tickScheduler();

  type Inbox = Array<{ key: string; job: string; runId?: string; items?: Array<{ key: string; choices: string[]; answer?: string; rating?: unknown }> }>;
  const inbox = async () => ((await (await request.get("/api/home", { headers: SAME_ORIGIN })).json()) as { inbox: Inbox }).inbox.filter((m) => m.job === JOB);
  await expect.poll(async () => (await inbox()).length, { timeout: 90_000, intervals: [1000] }).toBe(1);
  const [message] = await inbox();
  expect(message!.items).toEqual([expect.objectContaining({ key: `e2e:ci:${tag}`, choices: ["Look into it", "Ignore it"] })]);

  await page.goto(`/inbox?item=msg:${encodeURIComponent(message!.key)}`);
  const item = page.getByRole("dialog").getByRole("region", { name: `E2E CI failing ${tag}` });
  await item.getByRole("button", { name: "Ignore it" }).click();
  await expect(item).toContainText("You replied: Ignore it");

  // The gateway recorded the item from its own copy, and the agent got the item quoted with the reply.
  const [user] = await stack.query<{ data: string }>("select data from web_events where type = 'user' and json_extract(data, '$.ref.item.key') = ?", `e2e:ci:${tag}`);
  expect(JSON.parse(user!.data)).toMatchObject({ text: "Ignore it", ref: { id: `msg:${message!.key}`, job: JOB, runId: message!.runId, choice: "Ignore it", item: { title: `E2E CI failing ${tag}` } } });
  await stack.waitForLlm((r) => r.userText.includes(`[re: scheduled job "${JOB}"`) && r.userText.includes(`(key e2e:ci:${tag})`) && r.userText.includes('tapped the reply "Ignore it"'));

  await openChat(page);
  const reply = bubble(page, `re-${tag}`);
  await expect(reply).toContainText(`Echo item-${tag}.`, { timeout: 45_000 });
  const card = page.getByRole("region", { name: `Replying to ${JOB}: E2E CI failing ${tag}` });
  await expect(card).toBeVisible();
  await expect(card.getByRole("link", { name: "View run" })).toHaveAttribute("href", `/runs/${message!.runId}`);

  // The job's later runs see the reply.
  const feedback = join(stack.wsState, "job-feedback.json");
  await expect.poll(() => existsSync(feedback) && readFileSync(feedback, "utf8")).toContain(`e2e:ci:${tag}`);
  expect(JSON.parse(readFileSync(feedback, "utf8"))).toContainEqual(expect.objectContaining({ job: JOB, answer: "Ignore it", tapped: true }));
  expect((await inbox())[0]!.items![0]!.answer).toBe("Ignore it");

  // Not useful mutes the item's topic in the workspace, so the job's later runs drop it.
  await page.goto(`/inbox?item=msg:${encodeURIComponent(message!.key)}`);
  await item.getByRole("button", { name: "Not useful" }).click();
  await expect(item.getByRole("status").filter({ hasText: "won't see" })).toContainText("You won't see “E2E CI failures” again.");
  await expect.poll(async () => (await inbox())[0]!.items![0]!.rating).toEqual({ value: "down", scope: "topic" });
  const attention = JSON.parse(readFileSync(join(stack.wsState, "attention.json"), "utf8")) as { mutes: Array<{ id: string; sources: string[] }> };
  expect(attention.mutes).toEqual([expect.objectContaining({ id: "topic:e2e ci failures", sources: [`e2e:ci:${tag}`] })]);
  expect(await watch.violations()).toEqual([]);
});
