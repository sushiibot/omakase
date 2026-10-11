import { bubble, openChat } from "../lib/chat.ts";
import { expect, stack, test, type Page } from "../lib/harness.ts";
import { BOT_SEED } from "../stack/bot-seed.ts";

const marker = async () => (await stack.query<{ value: string }>("select value from kv where key = 'personal:imported_from_bot'"))[0]?.value;
const botRows = () => stack.query<{ seq: number }>("select seq from web_events where key like 'e2e-botdb-%' order by seq");

async function chatHits(page: Page, q: string): Promise<{ role?: string }[]> {
  return page.evaluate(async (query) => {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    return ((await res.json()) as { hits: { source: string; role?: string }[] }).hits.filter((h) => h.source === "chat");
  }, q);
}

test("the gateway imports the bot database's personal tables once at boot", async ({ page, watch }) => {
  test.setTimeout(120_000);
  const first = await marker();
  expect(first).toBeDefined();
  const { counts } = JSON.parse(first!) as { counts: Record<string, number> };
  expect(counts).toMatchObject({ web_events: 2, workspace_outbox_seen: 1, kv: 0 });
  expect(await botRows()).toEqual([{ seq: 1 }, { seq: 2 }]);
  const [sequence] = await stack.query<{ seq: number }>("select seq from sqlite_sequence where name = 'web_events'");
  expect(sequence!.seq).toBeGreaterThanOrEqual(BOT_SEED.webEventsSeq);
  // Community rows and the bot's FTS bookkeeping stay behind.
  expect(await stack.query("select 1 from conversations")).toEqual([]);
  expect(await stack.query("select 1 from kv where key = 'buzz:e2e'")).toEqual([]);

  await openChat(page);
  await expect(bubble(page, BOT_SEED.question)).toHaveCount(1);
  await expect(bubble(page, BOT_SEED.answer)).toHaveCount(1);
  // The index rebuilds from zero, so imported chat is searchable.
  await expect.poll(async () => (await chatHits(page, "E2E-BOTDB")).map((h) => h.role).sort(), { timeout: 15_000 }).toEqual(["agent", "user"]);

  await stack.restartPersonal({ waitReady: true });
  expect(await marker()).toBe(first);
  expect(await botRows()).toEqual([{ seq: 1 }, { seq: 2 }]);
  await page.reload();
  await expect(bubble(page, BOT_SEED.answer)).toHaveCount(1);
  expect(await watch.violations()).toEqual([]);
});
