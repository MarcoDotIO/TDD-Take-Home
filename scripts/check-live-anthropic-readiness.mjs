#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const env = process.env;
const awsRegion = required("AWS_REGION");
const profile = env.AWS_PROFILE;
const apiBaseUrl = (env.DEPLOYED_API_CLOUDFRONT_URL || env.DEPLOYED_API_URL || "").replace(/\/$/, "");
const bedrockRegions = [...new Set([env.BEDROCK_REGION, awsRegion, "us-east-1", "us-west-2"].filter(Boolean))];
const fastMode = process.argv.includes("--fast");

const directAnthropic = checkDirectAnthropic();
const claudePlatformAws = checkClaudePlatformAws();
const report = {
  directAnthropic,
  claudePlatformAws,
  bedrockAnthropic: fastMode ? skippedBedrockAnthropic() : checkBedrockAnthropic(),
  deployedApi: checkDeployedApi()
};

const readyRoutes = Object.entries(report)
  .filter(([name, value]) => name !== "deployedApi" && value.ready)
  .map(([name]) => name);

console.log(JSON.stringify({ ready: readyRoutes.length > 0, readyRoutes, ...report }, null, 2));

if (readyRoutes.length === 0) {
  console.error(nextAction(report));
  process.exit(1);
}

function checkDirectAnthropic() {
  return {
    ready: Boolean(env.ANTHROPIC_API_KEY),
    modelId: env.ANTHROPIC_MODEL_ID || "claude-opus-4-7",
    detail: env.ANTHROPIC_API_KEY ? "ANTHROPIC_API_KEY is set." : "ANTHROPIC_API_KEY is not set."
  };
}

function checkClaudePlatformAws() {
  if (env.ANTHROPIC_AWS_WORKSPACE_ID) {
    return {
      ready: true,
      workspaceId: env.ANTHROPIC_AWS_WORKSPACE_ID,
      modelId: env.ANTHROPIC_MODEL_ID || "claude-opus-4-7",
      detail: "ANTHROPIC_AWS_WORKSPACE_ID is set."
    };
  }

  const credentials = getAwsCredentials();
  if (!credentials.accessKey || !credentials.secretKey) {
    return {
      ready: false,
      detail: "AWS credentials are not available for signed Claude Platform workspace discovery."
    };
  }

  const result = signedCurl(
    `https://aws-external-anthropic.${awsRegion}.api.aws/v1/organizations/workspaces`,
    credentials
  );
  if (result.status >= 400) {
    const message = result.body?.error?.message || result.rawBody.trim();
    return {
      ready: false,
      status: result.status,
      detail: message,
      nextAction:
        /setup incomplete/i.test(message)
          ? "Open the AWS Claude Platform on AWS console and complete the pending setup, then rerun bun run verify:live-anthropic."
          : "Resolve the Claude Platform workspace API error, then rerun bun run verify:live-anthropic."
    };
  }

  const workspaceIds = collectWorkspaceIds(result.body);
  return {
    ready: workspaceIds.length > 0,
    workspaceId: workspaceIds[0],
    workspaceCount: workspaceIds.length,
    modelId: env.ANTHROPIC_MODEL_ID || "claude-opus-4-7",
    detail: workspaceIds.length > 0 ? "Claude Platform workspace discovered." : "No Claude Platform workspace IDs found."
  };
}

function checkBedrockAnthropic() {
  const regions = [];
  for (const region of bedrockRegions) {
    const result = aws(
      [
        "service-quotas",
        "list-service-quotas",
        "--service-code",
        "bedrock",
        "--region",
        region,
        "--cli-connect-timeout",
        "5",
        "--cli-read-timeout",
        "20",
        "--output",
        "json"
      ],
      { allowFailure: true }
    );
    if (result.status !== 0) {
      regions.push({ region, ready: false, detail: firstLines(result.stderr || result.stdout) });
      continue;
    }
    const quotas = parseJson(result.stdout, `Bedrock service quotas for ${region}`).Quotas || [];
    const anthroDaily = quotas.filter(
      (quota) => quota.QuotaName?.includes("Anthropic") && quota.QuotaName?.includes("tokens per day")
    );
    const positive = anthroDaily.filter((quota) => Number(quota.Value) > 0);
    regions.push({
      region,
      ready: positive.length > 0,
      positiveDailyTokenQuotaCount: positive.length,
      totalAnthropicDailyTokenQuotaCount: anthroDaily.length,
      positiveDailyTokenQuotas: positive.map(({ QuotaName, Value, QuotaCode, Adjustable }) => ({
        quotaName: QuotaName,
        value: Value,
        quotaCode: QuotaCode,
        adjustable: Adjustable
      }))
    });
  }

  return {
    ready: regions.some((region) => region.ready),
    regions,
    detail: regions.some((region) => region.ready)
      ? "At least one region has nonzero Anthropic daily-token quota."
      : "No checked region has nonzero Anthropic daily-token quota."
  };
}

function skippedBedrockAnthropic() {
  return {
    ready: false,
    skipped: true,
    detail: "Skipped Bedrock quota enumeration in fast mode."
  };
}

function checkDeployedApi() {
  if (!apiBaseUrl) {
    return { ready: false, detail: "DEPLOYED_API_CLOUDFRONT_URL or DEPLOYED_API_URL is not set." };
  }
  try {
    const raw = execFileSync("curl", ["-fsS", `${apiBaseUrl}/health`], { encoding: "utf8" });
    const health = parseJson(raw, "deployed API health");
    return { ready: Boolean(health.ok), health };
  } catch (error) {
    return { ready: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

function nextAction(value) {
  if (value.claudePlatformAws.nextAction) return value.claudePlatformAws.nextAction;
  if (!value.directAnthropic.ready) return "Set ANTHROPIC_API_KEY or complete Claude Platform on AWS setup, then rerun bun run verify:live-any-anthropic.";
  return "Rerun bun run verify:live-any-anthropic after the provider-side blocker is resolved.";
}

function getAwsCredentials() {
  return {
    accessKey: aws(["configure", "get", "aws_access_key_id"], { allowFailure: true }).stdout.trim() || env.AWS_ACCESS_KEY_ID,
    secretKey: aws(["configure", "get", "aws_secret_access_key"], { allowFailure: true }).stdout.trim() || env.AWS_SECRET_ACCESS_KEY
  };
}

function signedCurl(url, credentials) {
  const result = execFileSync(
    "curl",
    [
      "-sS",
      "--aws-sigv4",
      `aws:amz:${awsRegion}:aws-external-anthropic`,
      "--user",
      `${credentials.accessKey}:${credentials.secretKey}`,
      "--connect-timeout",
      "5",
      "--max-time",
      "20",
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
  return { status, rawBody, body: parseJson(rawBody, "Claude Platform on AWS response") };
}

function aws(args, options = {}) {
  const fullArgs = [...args];
  if (profile && !fullArgs.includes("--profile")) fullArgs.push("--profile", profile);
  if (!fullArgs.includes("--cli-connect-timeout")) fullArgs.push("--cli-connect-timeout", "5");
  if (!fullArgs.includes("--cli-read-timeout")) fullArgs.push("--cli-read-timeout", "20");
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

function splitCurlStatus(output) {
  const marker = "\nHTTP_STATUS:";
  const index = output.lastIndexOf(marker);
  if (index === -1) return [output, undefined];
  return [output.slice(0, index), output.slice(index + 1).trim()];
}

function collectWorkspaceIds(value, found = []) {
  if (typeof value === "string") {
    if (/^wrkspc_[A-Za-z0-9]+$/.test(value)) found.push(value);
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

function firstLines(value) {
  return value
    .trim()
    .split("\n")
    .slice(0, 3)
    .join("\n");
}

function required(name) {
  const value = env[name];
  if (!value) {
    console.error(`${name} must be set.`);
    process.exit(1);
  }
  return value;
}

function parseJson(raw, label) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error(`Could not parse ${label} as JSON: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
