# Architecture

## Runtime Boundaries

This prototype is designed to run locally without AWS credentials and to deploy into an AWS GovCloud-aligned architecture later.

Local development uses:

- Bun HTTP API with in-memory persistence
- Console email provider
- Static local auth headers for applicant/admin flows
- React/Vite frontend and SwiftUI client

AWS deployment uses:

- Cognito user pool groups for `Applicant` and `Admin`
- S3 for encrypted label/application uploads
- DynamoDB for submission state and audit events
- API Gateway as the public API edge
- Lambda/ECS-compatible service deployment for the API
- SES for transactional email
- Textract and/or Bedrock Data Automation for document extraction
- Bedrock GovCloud model calls for structured AI decision summaries
- Claude Platform on AWS for an AWS-billed Anthropic-native Messages API path when Bedrock quotas are not yet usable

## AI Decision Flow

1. Applicant submits COLA application fields and label images.
2. Submission is persisted and routed to automated processing.
3. OCR/document extraction returns label fields and confidence signals.
4. Deterministic validators compare application data to extracted label data.
5. AI reasoning produces a concise rationale and supporting evidence.
6. Result is `approved`, `needs_review`, or `rejected`.
7. Admins can review and override with a required reason.

The system never exposes chain-of-thought. It stores concise rationale, confidence, evidence fields, and audit events.
Configured Anthropic providers are fail-closed: if the model call is unavailable, the API returns `503` and does not create a fallback `needs_review` record.

## Dataset Testing

`.codex/cola_cloud_250` is treated as a local fixture set. All 250 applications were accepted, so tests assert that none are automatically hard-rejected. The dataset is not used to prove rejection behavior; separate synthetic fixtures cover hard failures such as brand mismatch, ABV mismatch, and missing exact government warning prefix.

## RunPod And GPT-5.5

RunPod/open-weight VLMs are reserved for offline evaluation with public, synthetic, or sanitized data. GPT-5.5 xhigh can be used as an approved fallback/evaluator, but it is not the default production inference boundary for government-style deployments.
