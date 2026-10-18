#!/usr/bin/env bun
import { runIntegrations } from "../src/workspace/integrations.ts";
try {
  process.exitCode = await runIntegrations(process.argv.slice(2));
} catch (e) {
  console.error(e instanceof Error ? e.message : "Integration failed.");
  process.exitCode = 1;
}
