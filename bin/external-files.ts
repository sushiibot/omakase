#!/usr/bin/env bun
import { runExternalFiles } from "../src/workspace/externalFiles.ts";

process.exitCode = await runExternalFiles(process.argv.slice(2), {
  env: process.env,
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
});
