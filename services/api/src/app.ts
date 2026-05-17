import { randomUUID } from "node:crypto";
import type { AdminOverride, ColaSubmission } from "@cola/shared";
import { AiReviewUnavailableError, createReviewPipeline, type AiReviewPipeline } from "./aiPipeline";
import { AuthService, canReadSubmission, HttpError, InMemoryUserRepository, requireRole, type UserRepository } from "./auth";
import { createEmailProvider, sendOverrideEmail, sendSubmissionEmails, type EmailProvider } from "./email";
import { DynamoSubmissionRepository, DynamoUserRepository } from "./awsRepository";
import { InMemorySubmissionRepository, type SubmissionRepository } from "./repository";

export interface AppDependencies {
  repository?: SubmissionRepository;
  userRepository?: UserRepository;
  emailProvider?: EmailProvider;
  reviewPipeline?: AiReviewPipeline;
  authService?: AuthService;
}

export function createRepository(): SubmissionRepository {
  if (
    process.env.USE_AWS_STORAGE === "true" &&
    process.env.SUBMISSIONS_TABLE &&
    process.env.AUDIT_TABLE &&
    process.env.AWS_REGION
  ) {
    return new DynamoSubmissionRepository(process.env.SUBMISSIONS_TABLE, process.env.AUDIT_TABLE);
  }
  return new InMemorySubmissionRepository();
}

export function createUserRepository(): UserRepository {
  if (process.env.USE_AWS_STORAGE === "true" && process.env.USERS_TABLE) {
    return new DynamoUserRepository(process.env.USERS_TABLE);
  }
  return new InMemoryUserRepository();
}

export function createApp(dependencies: AppDependencies = {}) {
  const repository = dependencies.repository ?? createRepository();
  const userRepository = dependencies.userRepository ?? createUserRepository();
  const emailProvider = dependencies.emailProvider ?? createEmailProvider();
  const reviewPipeline = dependencies.reviewPipeline ?? createReviewPipeline();
  const authService = dependencies.authService ?? new AuthService(userRepository);

  return {
    async fetch(request: Request): Promise<Response> {
      try {
        const url = new URL(request.url);
        if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
        if (request.method === "GET" && url.pathname === "/health") {
          return json({
            ok: true,
            ai: {
              reviewProvider: process.env.AI_REVIEW_PROVIDER ?? (process.env.ENABLE_AWS_AI === "true" ? "bedrock" : "deterministic"),
              awsAiEnabled: process.env.ENABLE_AWS_AI === "true",
              bedrockModelId: process.env.BEDROCK_MODEL_ID ?? null,
              bedrockRegion: process.env.BEDROCK_REGION ?? process.env.AWS_REGION ?? null,
              anthropicModelId: process.env.ANTHROPIC_MODEL_ID ?? null,
              claudePlatformAwsWorkspaceConfigured: Boolean(process.env.ANTHROPIC_AWS_WORKSPACE_ID)
            }
          });
        }

        if (request.method === "POST" && url.pathname === "/auth/register") {
          const body = (await request.json()) as { email?: string; password?: string };
          return json(await authService.registerApplicant(body.email ?? "", body.password ?? ""), 201);
        }

        if (request.method === "POST" && url.pathname === "/auth/login") {
          const body = (await request.json()) as { email?: string; password?: string };
          return json(await authService.login(body.email ?? "", body.password ?? ""));
        }

        const auth = authService.authFromRequest(request);

        if (request.method === "GET" && url.pathname === "/auth/me") {
          return json({ user: auth });
        }

        if (request.method === "POST" && url.pathname === "/submissions") {
          requireRole(auth, "applicant");
          const body = (await request.json()) as Partial<ColaSubmission>;
          const now = new Date().toISOString();
          const submission: ColaSubmission = {
            id: body.id ?? randomUUID(),
            applicantId: auth.userId,
            applicantEmail: auth.email,
            brandName: requireBodyString(body.brandName, "brandName"),
            productName: requireBodyString(body.productName, "productName"),
            productType: body.productType ?? "unknown",
            className: requireBodyString(body.className, "className"),
            originName: requireBodyString(body.originName, "originName"),
            domesticOrImported: body.domesticOrImported ?? "unknown",
            abv: body.abv,
            volume: body.volume,
            volumeUnit: body.volumeUnit,
            barcodeValue: body.barcodeValue,
            llmCategory: body.llmCategory,
            llmCategoryPath: body.llmCategoryPath,
            images: body.images ?? [],
            submittedAt: now,
            status: "submitted"
          };
          const decision = await reviewPipeline.review(submission);
          submission.status = decision.status;
          const record = await repository.create(submission, decision);
          await repository.audit({
            id: randomUUID(),
            actorId: auth.userId,
            action: "submission.created",
            submissionId: submission.id,
            createdAt: now
          });
          await safeSendEmail(() => sendSubmissionEmails(emailProvider, submission, decision));
          return json(record, 201);
        }

        if (request.method === "GET" && url.pathname === "/submissions") {
          requireRole(auth, "applicant");
          return json(await repository.listForApplicant(auth.userId));
        }

        const submissionMatch = url.pathname.match(/^\/submissions\/([^/]+)$/);
        if (request.method === "GET" && submissionMatch) {
          const record = await repository.get(submissionMatch[1]);
          if (!record) throw new HttpError(404, "Submission not found.");
          if (!canReadSubmission(auth, record.submission.applicantId)) throw new HttpError(403, "Cannot read this submission.");
          return json(record);
        }

        if (request.method === "GET" && url.pathname === "/admin/submissions") {
          requireRole(auth, "admin");
          return json(await repository.listAll());
        }

        const overrideMatch = url.pathname.match(/^\/admin\/submissions\/([^/]+)\/override$/);
        if (request.method === "POST" && overrideMatch) {
          requireRole(auth, "admin");
          const body = (await request.json()) as Partial<AdminOverride>;
          if (body.status !== "approved" && body.status !== "needs_review" && body.status !== "rejected") {
            throw new HttpError(400, "Override status must be approved, needs_review, or rejected.");
          }
          const reason = requireBodyString(body.reason, "reason");
          const override: AdminOverride = {
            submissionId: overrideMatch[1],
            adminId: auth.userId,
            status: body.status,
            reason,
            createdAt: new Date().toISOString()
          };
          const record = await repository.applyOverride(override);
          await repository.audit({
            id: randomUUID(),
            actorId: auth.userId,
            action: "submission.override",
            submissionId: override.submissionId,
            createdAt: override.createdAt,
            details: { status: override.status, reason }
          });
          await safeSendEmail(() => sendOverrideEmail(emailProvider, record.submission, override));
          return json(record);
        }

        throw new HttpError(404, "Not found.");
      } catch (error) {
        if (error instanceof HttpError) {
          return json({ error: error.message }, error.status);
        }
        if (error instanceof AiReviewUnavailableError) {
          return json(
            {
              error: "Anthropic model review is unavailable.",
              modelId: error.modelId,
              detail: error.message
            },
            503
          );
        }
        console.error(error);
        return json({ error: "Internal server error." }, 500);
      }
    }
  };
}

async function safeSendEmail(send: () => Promise<void>): Promise<void> {
  try {
    await send();
  } catch (error) {
    console.error("Email notification failed", error);
  }
}

function requireBodyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `${field} is required.`);
  }
  return value.trim();
}

function json(data: unknown, status = 200): Response {
  return cors(
    new Response(JSON.stringify(data, null, 2), {
      status,
      headers: { "content-type": "application/json" }
    })
  );
}

function cors(response: Response): Response {
  if (process.env.DISABLE_APP_CORS === "true") {
    return response;
  }
  response.headers.set("access-control-allow-origin", "*");
  response.headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  response.headers.set("access-control-allow-headers", "content-type,authorization");
  return response;
}
