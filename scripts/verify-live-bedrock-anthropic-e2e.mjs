#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const env = process.env;
const awsRegion = required("AWS_REGION");
const profile = env.AWS_PROFILE;
const functionName = env.LAMBDA_FUNCTION_NAME ?? "cola-demo-api";
const apiBaseUrl = (env.DEPLOYED_API_CLOUDFRONT_URL || env.DEPLOYED_API_URL || "").replace(/\/$/, "");
const regions = [
  argValue("--region"),
  env.BEDROCK_REGION,
  awsRegion,
  "us-east-1",
  "us-west-2"
].filter(Boolean);
const candidates = [
  env.BEDROCK_MODEL_ID,
  "us.anthropic.claude-haiku-4-5-20251001-v1:0",
  "global.anthropic.claude-haiku-4-5-20251001-v1:0",
  "us.anthropic.claude-sonnet-4-6",
  "global.anthropic.claude-sonnet-4-6",
  "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
  "global.anthropic.claude-sonnet-4-5-20250929-v1:0",
  "us.anthropic.claude-opus-4-7",
  "global.anthropic.claude-opus-4-7",
  "us.anthropic.claude-opus-4-6-v1"
].filter(Boolean);

if (!apiBaseUrl) {
  fail("DEPLOYED_API_CLOUDFRONT_URL or DEPLOYED_API_URL must be set.");
}

const selected = findWorkingModel();
console.log(`Using Bedrock Anthropic model/profile ${selected.modelId} in ${selected.region}.`);
configureLambda(selected);
verifyHealth(selected);
await submitAndVerify(selected);

function findWorkingModel() {
  const explicitModel = argValue("--model");
  for (const region of [...new Set(regions)]) {
    for (const model of [...new Set(explicitModel ? [explicitModel] : candidates)]) {
      console.log(`Probing ${model} in ${region}...`);
      const result = aws(
        [
          "bedrock-runtime",
          "converse",
          "--region",
          region,
          "--model-id",
          model,
          "--messages",
          '[{"role":"user","content":[{"text":"Return exactly: OK"}]}]',
          "--inference-config",
          '{"maxTokens":8,"temperature":0}',
          "--query",
          "output.message.content[0].text",
          "--output",
          "text"
        ],
        { allowFailure: true }
      );
      if (result.status === 0) {
        console.log(`Probe succeeded: ${result.stdout.trim()}`);
        return { modelId: model, region };
      }
      console.log(firstLines(result.stderr || result.stdout));
    }
  }
  fail("No Bedrock Anthropic model/profile was invokable. The account still appears to have zero Anthropic daily-token quota.");
}

function configureLambda(selected) {
  aws(["lambda", "wait", "function-updated", "--region", awsRegion, "--function-name", functionName]);
  const rawVars = aws([
    "lambda",
    "get-function-configuration",
    "--region",
    awsRegion,
    "--function-name",
    functionName,
    "--query",
    "Environment.Variables",
    "--output",
    "json"
  ]).stdout;
  const variables = parseJson(rawVars, "Lambda environment") || {};
  variables.AI_REVIEW_PROVIDER = "bedrock";
  variables.ENABLE_AWS_AI = "true";
  variables.BEDROCK_MODEL_ID = selected.modelId;
  variables.BEDROCK_REGION = selected.region;
  const envFile = join(tmpdir(), `cola-lambda-env-${Date.now()}.json`);
  writeFileSync(envFile, JSON.stringify({ Variables: variables }));
  aws([
    "lambda",
    "update-function-configuration",
    "--region",
    awsRegion,
    "--function-name",
    functionName,
    "--environment",
    `file://${envFile}`
  ]);
  aws(["lambda", "wait", "function-updated", "--region", awsRegion, "--function-name", functionName]);
}

function verifyHealth(selected) {
  const health = curlJson(`${apiBaseUrl}/health`);
  const ai = health.ai || {};
  if (ai.reviewProvider !== "bedrock" || ai.bedrockModelId !== selected.modelId || ai.bedrockRegion !== selected.region) {
    fail(`Health check did not show Bedrock model ${selected.modelId} in ${selected.region}: ${JSON.stringify(health)}`);
  }
  console.log(`Health check confirms Bedrock model ${ai.bedrockModelId} in ${ai.bedrockRegion}.`);
}

async function submitAndVerify(selected) {
  const id = `live-bedrock-anthropic-${Date.now()}`;
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
  const modelEvidence = evidence.find((item) => item.field === "bedrockModelId" && item.extracted === selected.modelId);
  const regionEvidence = evidence.find((item) => item.field === "bedrockRegion" && item.extracted === selected.region);
  if (!modelEvidence) {
    fail(`Submission succeeded but did not include Bedrock Anthropic evidence: ${JSON.stringify(body)}`);
  }
  if (!regionEvidence) {
    fail(`Submission succeeded but did not include Bedrock region evidence: ${JSON.stringify(body)}`);
  }
  if (body?.submission?.status !== "approved") {
    fail(`Model was invoked, but expected approved and got ${body?.submission?.status}: ${JSON.stringify(body)}`);
  }
  console.log(`Live E2E passed for submission ${id}; model evidence: ${modelEvidence.extracted} in ${regionEvidence.extracted}.`);
}

async function authHeaders() {
  const email = `live-bedrock-e2e+${Date.now()}@example.gov`;
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

function aws(args, options = {}) {
  const fullArgs = [...args];
  if (profile && !fullArgs.includes("--profile")) fullArgs.push("--profile", profile);
  try {
    const stdout = execFileSync("aws", fullArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return options.allowFailure ? { status: 0, stdout, stderr: "" } : { stdout };
  } catch (error) {
    if (options.allowFailure) {
      return {
        status: error.status ?? 1,
        stdout: error.stdout?.toString() ?? "",
        stderr: error.stderr?.toString() ?? error.message
      };
    }
    throw error;
  }
}

function firstLines(value) {
  return value
    .trim()
    .split("\n")
    .slice(0, 3)
    .join("\n");
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
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
