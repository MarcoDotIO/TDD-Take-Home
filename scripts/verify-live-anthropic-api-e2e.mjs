#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const env = process.env;
const region = required("AWS_REGION");
const profile = env.AWS_PROFILE;
const functionName = env.LAMBDA_FUNCTION_NAME ?? "cola-demo-api";
const apiBaseUrl = (env.DEPLOYED_API_CLOUDFRONT_URL || env.DEPLOYED_API_URL || "").replace(/\/$/, "");
const apiKey = required("ANTHROPIC_API_KEY");
const modelId = env.ANTHROPIC_MODEL_ID || "claude-opus-4-7";

if (!apiBaseUrl) {
  fail("DEPLOYED_API_CLOUDFRONT_URL or DEPLOYED_API_URL must be set.");
}

console.log(`Checking direct Anthropic Messages API model ${modelId}.`);
await probeAnthropicApi();
configureLambda();
verifyHealth();
await submitAndVerify();

async function probeAnthropicApi() {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: 8,
      messages: [{ role: "user", content: "Return exactly: OK" }]
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    fail(`Direct Anthropic API probe failed with HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
  console.log("Direct Anthropic API probe succeeded.");
}

function configureLambda() {
  aws(["lambda", "wait", "function-updated", "--region", region, "--function-name", functionName]);
  const rawVars = aws([
    "lambda",
    "get-function-configuration",
    "--region",
    region,
    "--function-name",
    functionName,
    "--query",
    "Environment.Variables",
    "--output",
    "json"
  ]);
  const variables = parseJson(rawVars, "Lambda environment") || {};
  variables.AI_REVIEW_PROVIDER = "anthropic";
  variables.ANTHROPIC_API_KEY = apiKey;
  variables.ANTHROPIC_MODEL_ID = modelId;
  const envFile = join(tmpdir(), `cola-lambda-env-${Date.now()}.json`);
  writeFileSync(envFile, JSON.stringify({ Variables: variables }));
  aws([
    "lambda",
    "update-function-configuration",
    "--region",
    region,
    "--function-name",
    functionName,
    "--environment",
    `file://${envFile}`
  ]);
  aws(["lambda", "wait", "function-updated", "--region", region, "--function-name", functionName]);
}

function verifyHealth() {
  const health = curlJson(`${apiBaseUrl}/health`);
  const ai = health.ai || {};
  if (ai.reviewProvider !== "anthropic" || ai.anthropicModelId !== modelId) {
    fail(`Health check did not show direct Anthropic model ${modelId}: ${JSON.stringify(health)}`);
  }
  console.log(`Health check confirms direct Anthropic model ${ai.anthropicModelId}.`);
}

async function submitAndVerify() {
  const id = `live-anthropic-api-${Date.now()}`;
  const payload = {
    id,
    brandName: "OLD TOM DISTILLERY",
    productName: "Kentucky Straight Bourbon Whiskey",
    productType: "distilled spirits",
    className: "bourbon whisky",
    originName: "kentucky",
    domesticOrImported: "domestic",
    abv: 45,
    volume: 750,
    volumeUnit: "milliliters",
    images: [{ id: "front", localPath: "live-smoke-front.png", position: "front" }]
  };
  const response = await fetch(`${apiBaseUrl}/submissions`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => ({}));
  if (response.status !== 201) {
    fail(`Submission failed with HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
  const evidence = body?.decision?.evidence || [];
  const modelEvidence = evidence.find((item) => item.field === "anthropicModelId" && item.extracted === modelId);
  if (!modelEvidence) {
    fail(`Submission succeeded but did not include direct Anthropic evidence: ${JSON.stringify(body)}`);
  }
  if (body?.submission?.status !== "approved") {
    fail(`Model was invoked, but expected approved and got ${body?.submission?.status}: ${JSON.stringify(body)}`);
  }
  console.log(`Live E2E passed for submission ${id}; model evidence: ${modelEvidence.extracted}.`);
}

async function authHeaders() {
  const email = `live-e2e-api+${Date.now()}@example.gov`;
  const response = await fetch(`${apiBaseUrl}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "live-e2e-password" })
  });
  const body = await response.json().catch(() => ({}));
  if (response.status !== 201) {
    fail(`Applicant account setup failed with HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
  return {
    "content-type": "application/json",
    authorization: `Bearer ${body.token}`
  };
}

function curlJson(url) {
  const raw = execFileSync("curl", ["-fsS", url], { encoding: "utf8" });
  return parseJson(raw, url);
}

function aws(args) {
  const fullArgs = [...args];
  if (profile && !fullArgs.includes("--profile")) fullArgs.push("--profile", profile);
  return execFileSync("aws", fullArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function required(name) {
  const value = env[name];
  if (!value) fail(`${name} must be set.`);
  return value;
}

function parseJson(raw, label) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(`Could not parse ${label} as JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
