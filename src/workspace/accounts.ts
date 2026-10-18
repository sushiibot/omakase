import { z } from "zod";

export const accountFill = z.object({
  accountId: z.string().uuid(), version: z.number().int().positive().optional(),
  fields: z.object({ password: z.string().min(1).max(1000), confirmPassword: z.string().min(1).max(1000).optional(), username: z.string().min(1).max(1000).optional() }).strict(),
}).strict();
export type AccountFill = z.infer<typeof accountFill>;
export type FillSecret = { password: string; username: string; version: number; receiptId: string };
export class AccountsClient {
  constructor(private readonly principalId: string, private readonly request: (params: unknown) => Promise<unknown>) {}
  private call(params: Record<string, unknown>) { return this.request({ principalId: this.principalId, ...params }); }
  async fill(input: AccountFill, origin: string, engine: "chromium" | "camoufox", runId?: string): Promise<FillSecret> {
    try {
      return z.object({ password: z.string().min(1), username: z.string(), version: z.number().int().positive(), receiptId: z.string().min(1) }).parse(await this.call({ operation: "fill", accountId: input.accountId, version: input.version, origin, engine, runId }));
    } catch { throw new Error("Account fill unavailable."); }
  }
  async result(receiptId: string, outcome: "filled" | "failed") {
    try { z.object({ ok: z.literal(true) }).parse(await this.call({ operation: "fill_result", receiptId, outcome })); }
    catch { throw new Error("Account fill audit unavailable."); }
  }
  async redact(payload: unknown, provider?: string): Promise<unknown> {
    try {
      const result = await this.call({ operation: "redact", payload, provider });
      if (!result || typeof result !== "object" || !Object.hasOwn(result, "payload") || (result as { payload?: unknown }).payload === undefined) throw new Error();
      return (result as { payload: unknown }).payload;
    } catch { throw new Error("Credential scan failed; model request blocked."); }
  }
}
