import { expect, stack, test } from "../lib/harness.ts";

test("calendar responsibility crosses the gateway link, persists pause, and enforces owner decisions", async ({ page, request, watch }) => {
  const headers = { "Sec-Fetch-Site": "same-origin" };
  const response = await request.get("/api/maintenance", { headers });
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ view: { responsibility: { title: "Keep upcoming plans accurate", enabled: true }, proposals: [] } });
  const foreign = await request.post("/api/maintenance", { headers: { Origin: "https://other.example", "Sec-Fetch-Site": "cross-site" }, data: { action: "pause", paused: true } });
  expect(foreign.status()).toBe(403);
  await page.goto("/assistant?view=watching");
  const watching = page.getByRole("tabpanel", { name: "Watching" });
  await watching.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(watching.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
  await page.reload();
  await expect(watching.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
  const state = await stack.linkRequest("maintenance/manage", { request: { action: "list" } });
  // The HTTP and direct link both read the single workspace-owned record.
  expect(JSON.stringify(state)).toContain('"enabled":false');
  await watching.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(watching.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  expect(await watch.violations()).toEqual([]);
});
