import { expect, test } from "bun:test";
import type { DecisionRequest } from "./decisions.ts";
import { restrictionCheck } from "./toolRestrictionDecisions.ts";

const config = { apiKey: "secret", baseUrl: "https://gateway.example/v1" };
const input = { rules: "Never read bank email", call: { tool: "mcp_call_tool", input: { tool: "search_email", arguments: { q: "lease" } } }, metadata: { name: "search_email" } };
const reply = (answer: object, model = "decider"): DecisionRequest => async () => Response.json({ model, answers: { verdict: { type: "choice", ...answer } } });

test("asks one typed choice question with the rules, call and tool as state", async () => {
  let body: { model: string; state: Record<string, unknown>; questions: Record<string, { type: string; criteria: Record<string, string> }> } | undefined;
  const check = restrictionCheck(config, { request: async (_url, init) => { body = JSON.parse(init.body as string); return reply({ choice: "allow", probabilities: { allow: 0.97, ask: 0.02, deny: 0.01 } })(_url, init); } });
  expect(await check(input)).toBe("allow");
  expect(body!.state).toEqual({ rules: input.rules, call: input.call, tool: input.metadata });
  expect(body!.questions.verdict!.type).toBe("choice");
  expect(Object.keys(body!.questions.verdict!.criteria)).toEqual(["allow", "ask", "deny"]);
});

test("an unsure allow asks; ask and deny pass through", async () => {
  expect(await restrictionCheck(config, { request: reply({ choice: "allow", probabilities: { allow: 0.6, ask: 0.3, deny: 0.1 } }) })(input)).toBe("ask");
  expect(await restrictionCheck(config, { request: reply({ choice: "ask" }) })(input)).toBe("ask");
  expect(await restrictionCheck(config, { request: reply({ choice: "deny" }) })(input)).toBe("deny");
});

test("an answer outside the options or of the wrong type moves down the chain, then throws", async () => {
  const seen: string[] = [];
  const request: DecisionRequest = async (_url, init) => {
    seen.push(JSON.parse(init.body as string).model);
    return seen.length === 1 ? Response.json({ model: "a", answers: { verdict: { type: "choice", choice: "maybe" } } })
      : Response.json({ model: "b", answers: { verdict: { type: "noul", noul: 1 } } });
  };
  await expect(restrictionCheck(config, { request, sleep: async () => {} })(input)).rejects.toThrow("schema_mismatch");
  expect(new Set(seen).size).toBeGreaterThan(1);
});
