import { randomUUID } from "node:crypto";
import type { DraftInput } from "./types.ts";
const wrap = (text: string) => text.match(/.{1,76}/g)?.join("\r\n") ?? "";
const encoded = (text: string) => [...text].reduce<string[]>((parts, char) => {
  const last = parts.length - 1;
  if (last < 0 || Buffer.byteLength(parts[last]! + char) > 42) parts.push(char); else parts[last] += char;
  return parts;
}, []).map(s => `=?UTF-8?B?${Buffer.from(s).toString("base64")}?=`).join("\r\n ");
export function draftMime(from: string, input: DraftInput, replyId?: string): string {
  const boundary = `omakase-${randomUUID()}`;
  const headers = [`From: ${from}`, `To: ${input.to.join(", ")}`, `Subject: ${encoded(input.subject)}`, "MIME-Version: 1.0"];
  if (input.cc.length) headers.push(`Cc: ${input.cc.join(", ")}`);
  if (input.bcc.length) headers.push(`Bcc: ${input.bcc.join(", ")}`);
  if (replyId && /^<[^<>\r\n]+>$/.test(replyId)) headers.push(`In-Reply-To: ${replyId}`, `References: ${replyId}`);
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  const parts = [`--${boundary}`, 'Content-Type: text/plain; charset="utf-8"', "Content-Transfer-Encoding: base64", "", wrap(Buffer.from(input.body).toString("base64"))];
  for (const attachment of input.attachments) parts.push(`--${boundary}`, `Content-Type: ${attachment.type}`, `Content-Disposition: attachment; filename*=UTF-8''${encodeURIComponent(attachment.name)}`, "Content-Transfer-Encoding: base64", "", wrap(attachment.data));
  parts.push(`--${boundary}--`, "");
  return [...headers, "", ...parts].join("\r\n");
}
