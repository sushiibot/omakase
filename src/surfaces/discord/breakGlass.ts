import { Events, type Client, type MessageCreateOptions } from "discord.js";
import { config } from "../../config.ts";
import { APPROVAL_TIMEOUT_MS } from "../../orchestration/workspace/tools.ts";
import { getLogger } from "../../logger.ts";

const log = getLogger("surfaces/discord/breakGlass");

export const BREAK_GLASS_APPROVAL = "An approval is pending. Open the app to decide.";
/** For an approval held because the web app is down, where "open the app" would lead nowhere. */
export const BREAK_GLASS_HELD = "An approval is waiting but the web app is unavailable. It will be denied automatically.";

/** Why the owner is being woken: a push that reached no device, or an approval held with no web surface. */
export type BreakGlassReason = "unreached" | "held";

export interface OwnerChannelPort {
  send(options: MessageCreateOptions): Promise<unknown>;
}

export const BREAK_GLASS_MIN_GAP_MS = 5 * 60_000;
// Longer than any approval can stay pending, so a nonce is never forgotten while it could still be reported.
const BREAK_GLASS_NONCE_TTL_MS = 2 * APPROVAL_TIMEOUT_MS;

/** Wakes the owner when an approval can't reach them in the app: non-silent, buttonless and fixed-text, so
 *  Discord never decides it and nothing the workspace controls reaches it. False when not sent. */
export async function sendBreakGlassDm(
  ownerChannel: () => Promise<OwnerChannelPort | null>,
  logger: Pick<typeof log, "warn"> = log,
  content: string = BREAK_GLASS_APPROVAL,
): Promise<boolean> {
  try {
    const channel = await ownerChannel();
    if (!channel) {
      logger.warn("break-glass owner DM not sent: the owner's Discord DM channel could not be resolved");
      return false;
    }
    await channel.send({ content, allowedMentions: { parse: [] } });
    return true;
  } catch (err) {
    logger.warn({ err }, "failed to send the break-glass owner DM");
    return false;
  }
}

/** Break-glass per approval push that reached no device. The workspace decides how many approvals exist,
 *  so each nonce is tried once and at most one attempt goes out per BREAK_GLASS_MIN_GAP_MS. */
export function createBreakGlass(
  ownerChannel: () => Promise<OwnerChannelPort | null>,
  opts: { now?: () => number } = {},
): (nonce: string, reason?: BreakGlassReason) => Promise<boolean> {
  const now = opts.now ?? Date.now;
  const seen = new Map<string, number>();
  let lastAttempt = -Infinity;
  return async (nonce, reason = "unreached") => {
    const t = now();
    for (const [n, at] of seen) if (t - at > BREAK_GLASS_NONCE_TTL_MS) seen.delete(n);
    if (seen.has(nonce)) return false;
    seen.set(nonce, t);
    if (t - lastAttempt < BREAK_GLASS_MIN_GAP_MS) return false;
    lastAttempt = t;
    return sendBreakGlassDm(ownerChannel, log, reason === "held" ? BREAK_GLASS_HELD : BREAK_GLASS_APPROVAL);
  };
}

/** Break-glass over the bot's Discord client. Send-only: the bot never reads DMs. */
export function createDiscordBreakGlass(client: Client): (nonce: string, reason?: BreakGlassReason) => Promise<boolean> {
  // Built before login, so a held approval at boot waits for the client instead of failing.
  const clientReady = client.isReady()
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        client.once(Events.ClientReady, () => resolve());
        setTimeout(resolve, 60_000).unref?.();
      });
  return createBreakGlass(async () => {
    if (!config.ownerDiscordId) return null;
    await clientReady;
    const user = await client.users.fetch(config.ownerDiscordId).catch(() => null);
    return user ? await user.createDM() : null;
  });
}
