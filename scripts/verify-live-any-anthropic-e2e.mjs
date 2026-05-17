#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const checks = [
  {
    name: "direct Anthropic Messages API",
    script: "verify-live-anthropic-api-e2e.mjs",
    shouldTry: Boolean(process.env.ANTHROPIC_API_KEY),
    skipReason: "ANTHROPIC_API_KEY is not set"
  },
  {
    name: "Claude Platform on AWS",
    script: "verify-live-anthropic-e2e.mjs",
    shouldTry: true
  },
  {
    name: "Bedrock Anthropic",
    script: "verify-live-bedrock-anthropic-e2e.mjs",
    shouldTry: true
  }
];

const failures = [];

for (const check of checks) {
  if (!check.shouldTry) {
    const message = `${check.name}: skipped (${check.skipReason}).`;
    console.log(message);
    failures.push(message);
    continue;
  }

  console.log(`\n=== Trying ${check.name} ===`);
  const result = spawnSync(process.execPath, [new URL(check.script, import.meta.url).pathname], {
    env: process.env,
    stdio: "inherit"
  });
  if (result.status === 0) {
    console.log(`\nLive Anthropic E2E completed through ${check.name}.`);
    process.exit(0);
  }
  failures.push(`${check.name}: exited with ${result.status ?? "unknown"}`);
}

console.error("\nNo Anthropic live E2E route is currently available.");
for (const failure of failures) console.error(`- ${failure}`);
process.exit(1);
