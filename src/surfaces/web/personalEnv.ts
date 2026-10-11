// Imported first by src/personal.ts, before config.ts reads the env, so a dev run without DATABASE_PATH
// never opens the bot's ./data/sushii-agent.db.
process.env["DATABASE_PATH"] ||= "./data/personal.db";
