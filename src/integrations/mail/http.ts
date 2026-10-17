import { IntegrationError } from "./types.ts";
export type Fetch = typeof fetch;
export const MAX_ATTACHMENT = 1024 * 1024;
/** Never include provider responses, URLs with tokens, or transport errors in public errors. */
export async function providerFetch(fetcher: Fetch, url: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try { res = await fetcher(url, { ...init, redirect: "error", signal: AbortSignal.timeout(25_000) }); }
  catch { throw new IntegrationError("The mail provider did not respond. Check the account and try again.", 502); }
  if (!res.ok) {
    await res.body?.cancel();
    if (res.status === 401 || res.status === 403) throw new IntegrationError("Mail access was refused. Reconnect this account and check its permissions.", 401);
    throw new IntegrationError("The mail provider could not complete the request. Check the account and try again.", 502);
  }
  return res;
}
export async function bytes(res: Response, limit = 4 * MAX_ATTACHMENT): Promise<Buffer> {
  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  if (!reader) return Buffer.alloc(0);
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw new IntegrationError("This mail response is too large. Open it in your mail app."); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
export async function providerJson(fetcher: Fetch, url: string, init: RequestInit = {}): Promise<any> {
  const res = await providerFetch(fetcher, url, init);
  try { return JSON.parse((await bytes(res)).toString("utf8")); }
  catch (err) { if (err instanceof IntegrationError) throw err; throw new IntegrationError("The mail provider returned an invalid response.", 502); }
}
