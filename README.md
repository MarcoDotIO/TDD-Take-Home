# COLA Label Verification Prototype

Fullstack prototype for AI-assisted alcohol label verification. The system is shaped for an AWS GovCloud-oriented deployment while remaining runnable locally without AWS credentials.

## Workspace

- `packages/shared` - domain models, normalization, deterministic decision logic, dataset fixture loaders, and unit tests.
- `services/api` - Bun HTTP API with role-gated applicant/admin routes and pluggable AWS adapters.
- `apps/web` - minimal React + Vite frontend for applicant submission/status and admin review/override.
- `apps/macos` - minimal SwiftUI macOS client skeleton that targets the same API contract.
- `infra` - AWS CDK stack for Cognito, API, S3, DynamoDB, SES policy, and pipeline placeholders.
- `.codex/cola_cloud_250` - local accepted-COLA dataset used by tests. It is not uploaded by infrastructure.

## Local Setup

```bash
bun install
```

## Development

```bash
bun run dev:api
bun run dev:web
```

The API defaults to in-memory storage and a console email adapter. AWS services are only used when deployed/configured.

## Tests

```bash
bun test
```

The dataset-backed tests assert that all 250 accepted real-world COLA records avoid automated hard rejection. Rejection behavior is covered with synthetic negative fixtures because the dataset contains no rejected applications.

## Compliance-Oriented AI Posture

Production inference is designed around AWS/GovCloud-compatible services:

- S3 for encrypted uploads
- Textract and/or Bedrock Data Automation for document extraction
- Bedrock GovCloud model invocation for structured decision summaries
- Claude Platform on AWS as an AWS-billed Anthropic-native Messages API path when Bedrock account quotas block model invocation
- Step Functions for review pipeline orchestration
- Cognito for enterprise-style auth
- SES for transactional email

RunPod/open-weight models are intentionally positioned as an offline evaluation lane for public, synthetic, or sanitized data only.

The deployed API is strict about AI availability: if the configured Anthropic review provider cannot invoke a model, submissions return `503` and no fallback decision is persisted.

To let the repo choose the first available live Anthropic route, run:

```bash
set -a; source .env.local; set +a
bun run verify:live-any-anthropic
```

That command tries direct Anthropic API, Claude Platform on AWS, then Bedrock Anthropic. It configures Lambda for the first working route and fails unless the deployed API returns model-backed decision evidence.

For a faster readiness check that does not submit an application or probe every Bedrock profile:

```bash
set -a; source .env.local; set +a
bun run check:live-anthropic-readiness
```

That command reports whether direct Anthropic, Claude Platform on AWS, or Bedrock Anthropic is currently ready. Use `bun run check:live-anthropic-readiness:fast` to skip Bedrock quota enumeration when Claude Platform setup is already the known blocker. If Claude Platform returns `setup incomplete`, finish the pending **Complete setup** step in the AWS console before running the E2E verifier.

After Claude Platform on AWS is activated, the live Anthropic E2E can be finalized with:

```bash
set -a; source .env.local; set +a
bun run verify:live-anthropic
```

That script discovers the Claude Platform workspace, configures Lambda for `claude-platform-aws`, submits a live COLA application, and fails unless the API returns an approved model-backed decision with Claude Platform evidence.

If Bedrock Anthropic daily-token quotas are enabled first, use:

```bash
set -a; source .env.local; set +a
bun run verify:live-bedrock-anthropic
```

That script probes active Anthropic Bedrock profiles, configures Lambda for the first invokable profile, and runs the same live model-backed submission check.
Set `BEDROCK_REGION` if AWS enables Anthropic quota in a different region before the Lambda/API region.

If a first-party Anthropic API key is approved as the live route, use:

```bash
set -a; source .env.local; set +a
bun run verify:live-anthropic-api
```

That script probes the Anthropic Messages API, configures Lambda for `AI_REVIEW_PROVIDER=anthropic`, and verifies the deployed API returns direct Anthropic model evidence.
