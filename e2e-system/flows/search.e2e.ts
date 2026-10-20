import { bubble, openChat, send, textbox } from "../lib/chat.ts";
import { expect, nonce, stack, test, type Page } from "../lib/harness.ts";

type Search = {
  query: string;
  hits: { source: string; id: string; role?: string; conversationId?: string; message?: string; conversationTitle?: string; snippet: string; ranges: [number, number][] }[];
  truncated: boolean;
  unavailable: string[];
};

async function search(page: Page, q: string): Promise<{ status: number; body: Search }> {
  return page.evaluate(async (query) => {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    return { status: res.status, body: await res.json() };
  }, q);
}

test("search finds live and imported chat through the app API", async ({ page, watch }) => {
  await openChat(page);
  const tag = nonce();
  expect((await send(page, `E2E-ECHO searchable #${tag}`)).status).toBe(202);
  await expect(bubble(page, `re-${tag}`)).toContainText("Echo searchable.");

  await expect.poll(async () => (await search(page, tag)).body.hits.filter((h) => h.source === "chat").map((h) => h.role).sort(), { timeout: 15_000 }).toEqual(["agent", "user"]);
  // The run's history notes mention the tag too, once the workspace has written them.
  await expect.poll(async () => (await search(page, tag)).body.hits.some((h) => h.source === "notes"), { timeout: 15_000 }).toBe(true);
  const live = await search(page, tag);
  expect(live.status).toBe(200);
  expect(live.body.unavailable).toEqual([]);
  for (const h of live.body.hits) {
    const cps = [...h.snippet];
    expect(h.ranges.length).toBeGreaterThan(0);
    for (const [a, b] of h.ranges) expect(cps.slice(a, b).join("").toLowerCase()).toBe(tag);
  }

  const imported = await search(page, "E2E-PREWEB");
  expect(imported.body.hits.filter((h) => h.source === "chat" && Number(h.id) <= 0).length).toBe(2);

  const operators = await search(page, `${tag} OR zzzz`);
  expect(operators.status).toBe(200);
  expect(operators.body.hits.filter((h) => h.source === "chat")).toEqual([]);

  expect((await search(page, "x")).status).toBe(400);
  const runs = await page.evaluate(async () => (await fetch("/api/runs")).status);
  expect(runs).toBe(200);
  expect(await watch.violations()).toEqual([]);
});

test("search finds a topic message and links to it in its conversation", async ({ page, watch }) => {
  await openChat(page);
  const title = `Search topic ${nonce()}`;
  const created = await page.evaluate(async (t) => {
    const res = await fetch("/api/threads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageId: "", title: t }) });
    return { status: res.status, body: (await res.json()) as { id: string } };
  }, title);
  expect(created.status).toBe(201);
  const topic = created.body.id;
  await page.goto(`/chats/${topic}`);
  const tag = nonce();
  await textbox(page).fill(`Topic searchable #${tag}`);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(bubble(page, `re-${tag}`)).toBeVisible();
  const [user] = await stack.query<{ key: string }>("select key from web_events where conversation_id = ? and type = 'user' and data like ?", topic, `%#${tag}%`);
  expect(user?.key).toBeTruthy();

  await expect
    .poll(async () => (await search(page, tag)).body.hits.find((h) => h.source === "chat" && h.role === "user") ?? null, { timeout: 15_000 })
    .toMatchObject({ conversationId: topic, message: user!.key, conversationTitle: title });

  await page.goto(`/history/search?q=${tag}`);
  const row = page.getByRole("main").getByRole("listitem").filter({ hasText: `${title} · you` });
  await expect(row.getByRole("link")).toHaveAttribute("href", `/chats/${topic}?m=${encodeURIComponent(user!.key)}`);
  await expect(row.locator("mark")).toHaveText(tag);
  expect(await watch.violations()).toEqual([]);
});
