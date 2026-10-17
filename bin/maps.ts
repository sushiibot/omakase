#!/usr/bin/env bun
import { runMaps } from "../src/workspace/maps.ts";

process.exitCode = await runMaps(process.argv.slice(2), {
  env: process.env,
  out: line => process.stdout.write(`${line}\n`),
  err: line => process.stderr.write(`${line}\n`),
});
