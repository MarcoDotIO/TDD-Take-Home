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
const modelId = env.ANTHROPIC_MODEL_ID || "claude-opus-4-7";
const workspaceOverride = argValue("--workspace");
const workspaceIdPattern = /^wrkspc_[A-Za-z0-9]+$/;

if (!apiBaseUrl) {
  fail("DEPLOYED_API_CLOUDFRONT_URL or DEPLOYED_API_URL must be set.");
}

const workspaceId = workspaceOverride || env.ANTHROPIC_AWS_WORKSPACE_ID || findWorkspaceId();
if (!workspaceId) {
  fail("No Claude Platform on AWS workspace was found. Activate Claude Platform on AWS first, then rerun this script.");
}
if (!workspaceIdPattern.test(workspaceId)) {
  fail(`Claude Platform on AWS workspace ID must look like wrkspc_..., got ${workspaceId}.`);
}

console.log(`Using Claude Platform on AWS workspace ${workspaceId}.`);
ensureLambdaRoleCanUseAnthropic();
configureLambda(workspaceId);
verifyHealth();
await submitAndVerify();

function findWorkspaceId() {
  const accessKey = aws(["configure", "get", "aws_access_key_id"]).trim() || env.AWS_ACCESS_KEY_ID;
  const secretKey = aws(["configure", "get", "aws_secret_access_key"]).trim() || env.AWS_SECRET_ACCESS_KEY;
  if (!accessKey || !secretKey) {
    fail("AWS credentials are required to discover Claude Platform on AWS workspaces.");
  }

  const url = `https://aws-external-anthropic.${region}.api.aws/v1/organizations/workspaces`;
  const result = execFileSync(
    "curl",
    [
      "-sS",
      "--aws-sigv4",
      `aws:amz:${region}:aws-external-anthropic`,
      "--user",
      `${accessKey}:${secretKey}`,
      "-H",
      "anthropic-version: 2023-06-01",
      "-w",
      "\nHTTP_STATUS:%{http_code}\n",
      url
    ],
    { encoding: "utf8" }
  );
  const [rawBody, statusLine] = splitCurlStatus(result);
  const status = Number(statusLine?.replace("HTTP_STATUS:", "").trim());
  const body = parseJson(rawBody, "Claude Platform on AWS workspace response");
  if (status >= 400) {
    const message = body?.error?.message || rawBody.trim();
    if (/setup incomplete/i.test(message)) {
      fail(
        [
          `Claude Platform on AWS workspace lookup failed with HTTP ${status}: ${message}`,
          "Next action: complete the pending Claude Platform on AWS setup in the AWS console, then rerun bun run verify:live-anthropic."
        ].join("\n")
      );
    }
    fail(`Claude Platform on AWS workspace lookup failed with HTTP ${status}: ${message}`);
  }
  const ids = collectWorkspaceIds(body);
  return ids[0];
}

function ensureLambdaRoleCanUseAnthropic() {
  const roleArn = aws([
    "lambda",
    "get-function-configuration",
    "--region",
    region,
    "--function-name",
    functionName,
    "--query",
    "Role",
    "--output",
    "text"
  ]).trim();
  const roleName = roleArn.split("/").pop();
  if (!roleName) fail(`Could not determine Lambda role from ${roleArn}.`);
  aws([
    "iam",
    "attach-role-policy",
    "--role-name",
    roleName,
    "--policy-arn",
    "arn:aws:iam::aws:policy/AnthropicFullAccess"
  ]);
}

function configureLambda(workspaceId) {
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
  variables.AI_REVIEW_PROVIDER = "claude-platform-aws";
  variables.ANTHROPIC_AWS_WORKSPACE_ID = workspaceId;
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
  if (ai.reviewProvider !== "claude-platform-aws" || ai.claudePlatformAwsWorkspaceConfigured !== true) {
    fail(`Health check did not show Claude Platform on AWS as configured: ${JSON.stringify(health)}`);
  }
  console.log(`Health check confirms provider ${ai.reviewProvider}.`);
}

async function submitAndVerify() {
  const id = `live-anthropic-${Date.now()}`;
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
  const modelEvidence = evidence.find((item) => item.field === "claudePlatformAwsModelId");
  if (!modelEvidence) {
    fail(`Submission succeeded but did not include Claude Platform on AWS evidence: ${JSON.stringify(body)}`);
  }
  if (body?.submission?.status !== "approved") {
    fail(`Model was invoked, but expected approved and got ${body?.submission?.status}: ${JSON.stringify(body)}`);
  }
  console.log(`Live E2E passed for submission ${id}; model evidence: ${modelEvidence.extracted}.`);
}

async function authHeaders() {
  const email = `live-e2e+${Date.now()}@example.gov`;
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

function splitCurlStatus(output) {
  const marker = "\nHTTP_STATUS:";
  const index = output.lastIndexOf(marker);
  if (index === -1) return [output, undefined];
  return [output.slice(0, index), output.slice(index + 1).trim()];
}

function collectWorkspaceIds(value, found = []) {
  if (typeof value === "string") {
    if (workspaceIdPattern.test(value)) found.push(value);
    return found;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectWorkspaceIds(item, found);
    return found;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (/^(id|workspace_id|workspaceId)$/.test(key) && typeof nested === "string") found.push(nested);
      else collectWorkspaceIds(nested, found);
    }
  }
  return [...new Set(found)];
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
