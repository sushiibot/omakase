// What stack/seed-bot-db.ts writes into the bot database; shared with the flows, so no bun:* imports.
export const BOT_SEED = {
  question: "E2E-BOTDB question kept from the bot",
  answer: "E2E-BOTDB answer kept from the bot",
  /** Ahead of max(seq), as after the bot pruned old events. */
  webEventsSeq: 500,
};
