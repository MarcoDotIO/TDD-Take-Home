import { describe, expect, test } from "bun:test";
import type { AutomationDecision, ColaSubmission } from "@cola/shared";
import { createApp } from "../src/app";
import { AiReviewUnavailableError, AnthropicMessagesReviewPipeline, ClaudePlatformAwsReviewPipeline } from "../src/aiPipeline";
import type { EmailMessage, EmailProvider } from "../src/email";
import { InMemorySubmissionRepository } from "../src/repository";

class CapturingEmailProvider implements EmailProvider {
  messages: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const applicantHeaders = {
  "content-type": "application/json",
  "x-user-id": "applicant-1",
  "x-user-email": "applicant@example.gov",
  "x-user-roles": "applicant"
};

const otherApplicantHeaders = {
  ...applicantHeaders,
  "x-user-id": "applicant-2",
  "x-user-email": "other@example.gov"
};

const adminHeaders = {
  "content-type": "application/json",
  "x-user-id": "admin-1",
  "x-user-email": "admin@example.gov",
  "x-user-roles": "admin"
};

describe("API auth boundaries and email side effects", () => {
  test("prevents applicants from reading another applicant submission", async () => {
    const repository = new InMemorySubmissionRepository();
    const emailProvider = new CapturingEmailProvider();
    const app = createApp({ repository, emailProvider });

    const createResponse = await app.fetch(
      new Request("http://localhost/submissions", {
        method: "POST",
        headers: applicantHeaders,
        body: JSON.stringify(validDraft())
      })
    );
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { submission: ColaSubmission; decision: AutomationDecision };

    const readResponse = await app.fetch(
      new Request(`http://localhost/submissions/${created.submission.id}`, {
        headers: otherApplicantHeaders
      })
    );
    expect(readResponse.status).toBe(403);
  });

  test("prevents non-admin override and allows admin override", async () => {
    const repository = new InMemorySubmissionRepository();
    const emailProvider = new CapturingEmailProvider();
    const app = createApp({ repository, emailProvider });

    const createResponse = await app.fetch(
      new Request("http://localhost/submissions", {
        method: "POST",
        headers: applicantHeaders,
        body: JSON.stringify(validDraft())
      })
    );
    const created = (await createResponse.json()) as { submission: ColaSubmission };

    const applicantOverride = await app.fetch(
      new Request(`http://localhost/admin/submissions/${created.submission.id}/override`, {
        method: "POST",
        headers: applicantHeaders,
        body: JSON.stringify({ status: "approved", reason: "not allowed" })
      })
    );
    expect(applicantOverride.status).toBe(403);

    const adminOverride = await app.fetch(
      new Request(`http://localhost/admin/submissions/${created.submission.id}/override`, {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ status: "approved", reason: "human reviewed" })
      })
    );
    expect(adminOverride.status).toBe(200);
    expect(emailProvider.messages.some((message) => message.subject.includes("decision updated"))).toBe(true);
  });

  test("sends applicant confirmation on submission without live SES", async () => {
    const emailProvider = new CapturingEmailProvider();
    const app = createApp({ repository: new InMemorySubmissionRepository(), emailProvider });

    const response = await app.fetch(
      new Request("http://localhost/submissions", {
        method: "POST",
        headers: applicantHeaders,
        body: JSON.stringify(validDraft())
      })
    );

    expect(response.status).toBe(201);
    expect(emailProvider.messages).toHaveLength(1);
    expect(emailProvider.messages[0]?.to).toEqual(["applicant@example.gov"]);
    expect(emailProvider.messages[0]?.subject).toContain("COLA submission received");
  });

  test("does not create a fallback decision when Anthropic review is unavailable", async () => {
    const repository = new InMemorySubmissionRepository();
    const app = createApp({
      repository,
      emailProvider: new CapturingEmailProvider(),
      reviewPipeline: {
        async review() {
          throw new AiReviewUnavailableError("Anthropic Bedrock review failed for test-model: quota unavailable", "test-model");
        }
      }
    });

    const response = await app.fetch(
      new Request("http://localhost/submissions", {
        method: "POST",
        headers: applicantHeaders,
        body: JSON.stringify(validDraft())
      })
    );

    expect(response.status).toBe(503);
    expect(await repository.listAll()).toHaveLength(0);
    const body = (await response.json()) as { error: string; modelId: string };
    expect(body.error).toBe("Anthropic model review is unavailable.");
    expect(body.modelId).toBe("test-model");
  });

  test("uses Anthropic Messages decisions when configured", async () => {
    const reviewPipeline = new AnthropicMessagesReviewPipeline("test-key", "claude-opus-4-7", async () => {
      return new Response(
        JSON.stringify({
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "approved",
                confidence: 0.91,
                rationale: "Model-backed approval."
              })
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    const app = createApp({
      repository: new InMemorySubmissionRepository(),
      emailProvider: new CapturingEmailProvider(),
      reviewPipeline
    });

    const response = await app.fetch(
      new Request("http://localhost/submissions", {
        method: "POST",
        headers: applicantHeaders,
        body: JSON.stringify(validDraft())
      })
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as { submission: ColaSubmission; decision: AutomationDecision };
    expect(body.submission.status).toBe("approved");
    expect(body.decision.evidence.some((item) => item.field === "anthropicModelId")).toBe(true);
  });

  test("sends URL image blocks to Anthropic Messages when image URLs are submitted", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const reviewPipeline = new AnthropicMessagesReviewPipeline("test-key", "claude-opus-4-7", async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "approved",
                confidence: 0.92,
                rationale: "Image-backed approval."
              })
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });

    const decision = await reviewPipeline.review(validDraftWithImageUrl());
    const messages = capturedBody?.messages as Array<{ content: Array<{ type: string; source?: { type: string; url: string } }> }>;
    const imageBlocks = messages[0]?.content.filter((block) => block.type === "image") ?? [];

    expect(imageBlocks).toHaveLength(1);
    expect(imageBlocks[0]?.source).toEqual({ type: "url", url: "https://example.test/front.webp" });
    expect(decision.evidence.some((item) => item.field === "anthropicImageCount" && item.extracted === 1)).toBe(true);
  });

  test("includes Bedrock region evidence for Bedrock decisions", async () => {
    const reviewPipeline = {
      async review() {
        return {
          status: "approved" as const,
          confidence: 0.9,
          rationale: "Bedrock-backed approval.",
          evidence: [
            {
              field: "bedrockModelId",
              severity: "info" as const,
              message: "Bedrock review completed.",
              extracted: "test-model"
            },
            {
              field: "bedrockRegion",
              severity: "info" as const,
              message: "Bedrock runtime region was us-west-2.",
              extracted: "us-west-2"
            }
          ]
        };
      }
    };
    const app = createApp({
      repository: new InMemorySubmissionRepository(),
      emailProvider: new CapturingEmailProvider(),
      reviewPipeline
    });

    const response = await app.fetch(
      new Request("http://localhost/submissions", {
        method: "POST",
        headers: applicantHeaders,
        body: JSON.stringify(validDraft())
      })
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as { decision: AutomationDecision };
    expect(body.decision.evidence.some((item) => item.field === "bedrockRegion" && item.extracted === "us-west-2")).toBe(true);
  });

  test("uses Claude Platform on AWS decisions when configured", async () => {
    const reviewPipeline = new ClaudePlatformAwsReviewPipeline("workspace-test", "claude-opus-4-7", "us-east-2", {
      messages: {
        async create() {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  status: "approved",
                  confidence: 0.93,
                  rationale: "AWS-billed Anthropic approval."
                })
              }
            ]
          };
        }
      }
    });
    const app = createApp({
      repository: new InMemorySubmissionRepository(),
      emailProvider: new CapturingEmailProvider(),
      reviewPipeline
    });

    const response = await app.fetch(
      new Request("http://localhost/submissions", {
        method: "POST",
        headers: applicantHeaders,
        body: JSON.stringify(validDraft())
      })
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as { submission: ColaSubmission; decision: AutomationDecision };
    expect(body.submission.status).toBe("approved");
    expect(body.decision.evidence.some((item) => item.field === "claudePlatformAwsModelId")).toBe(true);
  });

  test("sends URL image blocks to Claude Platform on AWS when image URLs are submitted", async () => {
    let capturedInput:
      | {
          messages: Array<{ content: Array<{ type: string; source?: { type: string; url: string } }> }>;
        }
      | undefined;
    const reviewPipeline = new ClaudePlatformAwsReviewPipeline("workspace-test", "claude-opus-4-7", "us-east-2", {
      messages: {
        async create(input) {
          capturedInput = input as typeof capturedInput;
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  status: "approved",
                  confidence: 0.94,
                  rationale: "AWS image-backed approval."
                })
              }
            ]
          };
        }
      }
    });

    const decision = await reviewPipeline.review(validDraftWithImageUrl());
    const imageBlocks = capturedInput?.messages[0]?.content.filter((block) => block.type === "image") ?? [];

    expect(imageBlocks).toHaveLength(1);
    expect(imageBlocks[0]?.source).toEqual({ type: "url", url: "https://example.test/front.webp" });
    expect(decision.evidence.some((item) => item.field === "claudePlatformAwsImageCount" && item.extracted === 1)).toBe(true);
  });
});

function validDraft() {
  return {
    brandName: "OLD TOM DISTILLERY",
    productName: "Kentucky Straight Bourbon Whiskey",
    productType: "distilled spirits" as const,
    className: "bourbon whisky",
    originName: "kentucky",
    domesticOrImported: "domestic" as const,
    abv: 45,
    volume: 750,
    volumeUnit: "milliliters",
    images: [{ id: "front", localPath: "front.png", position: "front" }]
  };
}

function validDraftWithImageUrl(): ColaSubmission {
  return {
    id: "image-url-fixture",
    applicantId: "fixture-applicant",
    applicantEmail: "fixture-applicant@example.gov",
    ...validDraft(),
    submittedAt: "2026-01-01T00:00:00.000Z",
    status: "submitted",
    images: [{ id: "front", url: "https://example.test/front.webp", position: "front" }]
  };
}
