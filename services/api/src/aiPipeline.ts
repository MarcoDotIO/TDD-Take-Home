import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { AnthropicAws } from "@anthropic-ai/aws-sdk";
import { evaluateSubmission, type AutomationDecision, type ColaSubmission, type ExtractedLabelFields } from "@cola/shared";

export interface DocumentExtractionProvider {
  extract(submission: ColaSubmission): Promise<ExtractedLabelFields | undefined>;
}

export interface AiReviewPipeline {
  review(submission: ColaSubmission): Promise<AutomationDecision>;
}

export class AiReviewUnavailableError extends Error {
  constructor(
    message: string,
    readonly modelId: string
  ) {
    super(message);
    this.name = "AiReviewUnavailableError";
  }
}

export class PendingExtractionProvider implements DocumentExtractionProvider {
  async extract(): Promise<ExtractedLabelFields | undefined> {
    return undefined;
  }
}

export class DeterministicReviewPipeline implements AiReviewPipeline {
  constructor(private extractionProvider: DocumentExtractionProvider = new PendingExtractionProvider()) {}

  async review(submission: ColaSubmission): Promise<AutomationDecision> {
    const extracted = await this.extractionProvider.extract(submission);
    return evaluateSubmission(submission, extracted, { requireExtraction: true });
  }
}

export class AwsGovCloudExtractionProvider implements DocumentExtractionProvider {
  async extract(): Promise<ExtractedLabelFields | undefined> {
    // Production hook: call Textract or Bedrock Data Automation here, then map
    // extracted fields into ExtractedLabelFields. It intentionally stays inert
    // locally so builds and tests do not require AWS credentials.
    return undefined;
  }
}

export class BedrockReviewPipeline implements AiReviewPipeline {
  private client: BedrockRuntimeClient;

  constructor(
    private modelId: string,
    private region = process.env.BEDROCK_REGION ?? process.env.AWS_REGION
  ) {
    this.client = new BedrockRuntimeClient({ region: this.region });
  }

  async review(submission: ColaSubmission): Promise<AutomationDecision> {
    const deterministic = evaluateSubmission(submission, undefined, { requireExtraction: false });
    try {
      const response = await this.client.send(
        new ConverseCommand({
          modelId: this.modelId,
          messages: [
            {
              role: "user",
              content: [
                {
                  text: buildBedrockPrompt(submission, deterministic)
                }
              ]
            }
          ],
          inferenceConfig: {
            maxTokens: 256,
            temperature: 0
          }
        })
      );
      const text = response.output?.message?.content?.find((part) => "text" in part)?.text ?? "";
      const parsed = parseBedrockDecision(text);
      const status = deterministic.status === "rejected" ? "rejected" : parsed.status ?? deterministic.status;
      return {
        status,
        confidence: parsed.confidence ?? deterministic.confidence,
        rationale: parsed.rationale ?? deterministic.rationale,
        evidence: [
          ...deterministic.evidence,
          {
            field: "bedrockModelId",
            severity: "info",
            message: `Bedrock review completed with ${this.modelId} in ${this.region ?? "default region"}.`,
            extracted: this.modelId
          },
          {
            field: "bedrockRegion",
            severity: "info",
            message: `Bedrock runtime region was ${this.region ?? "default"}.`,
            extracted: this.region
          }
        ]
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new AiReviewUnavailableError(
        `Anthropic Bedrock review failed for ${this.modelId} in ${this.region ?? "default region"}: ${message}`,
        this.modelId
      );
    }
  }
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type AnthropicTextBlock = { type: "text"; text: string };
type AnthropicUrlImageBlock = { type: "image"; source: { type: "url"; url: string } };
type AnthropicBase64ImageBlock = { type: "image"; source: { type: "base64"; media_type: string; data: string } };
type AnthropicInputContentBlock = AnthropicTextBlock | AnthropicUrlImageBlock | AnthropicBase64ImageBlock;
type AnthropicMessageContent = string | AnthropicInputContentBlock[];
type AnthropicContentBlock = AnthropicTextBlock | ({ type: string } & Record<string, unknown>);
type AnthropicMessageClient = {
  messages: {
    create(input: {
      model: string;
      max_tokens: number;
      temperature?: number;
      messages: Array<{ role: "user"; content: AnthropicMessageContent }>;
    }): Promise<{ content?: AnthropicContentBlock[] }>;
  };
};

const MAX_ANTHROPIC_IMAGE_BLOCKS = 4;

export class AnthropicMessagesReviewPipeline implements AiReviewPipeline {
  constructor(
    private apiKey: string | undefined,
    private modelId: string,
    private fetchFn: FetchLike = fetch
  ) {}

  async review(submission: ColaSubmission): Promise<AutomationDecision> {
    if (!this.apiKey) {
      throw new AiReviewUnavailableError(`Anthropic Messages review failed for ${this.modelId}: missing ANTHROPIC_API_KEY`, this.modelId);
    }

    const deterministic = evaluateSubmission(submission, undefined, { requireExtraction: false });
    try {
      const content = buildAnthropicContent(submission, deterministic);
      const imageBlockCount = countAnthropicImageBlocks(content);
      const response = await this.fetchFn("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: this.modelId,
          max_tokens: 256,
          messages: [
            {
              role: "user",
              content
            }
          ]
        })
      });
      const body = (await response.json().catch(() => ({}))) as AnthropicMessagesResponse;
      if (!response.ok) {
        throw new Error(readAnthropicError(body, response.status));
      }
      const text = body.content?.find(isAnthropicTextBlock)?.text ?? "";
      const parsed = parseBedrockDecision(text);
      const status = deterministic.status === "rejected" ? "rejected" : parsed.status ?? deterministic.status;
      return {
        status,
        confidence: parsed.confidence ?? deterministic.confidence,
        rationale: parsed.rationale ?? deterministic.rationale,
        evidence: [
          ...deterministic.evidence,
          {
            field: "anthropicModelId",
            severity: "info",
            message: `Anthropic Messages review completed with ${this.modelId}.`,
            extracted: this.modelId
          },
          {
            field: "anthropicImageCount",
            severity: "info",
            message: `Sent ${imageBlockCount} label image(s) to Anthropic Messages from ${submission.images.length} submitted image record(s).`,
            submitted: submission.images.length,
            extracted: imageBlockCount
          }
        ]
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new AiReviewUnavailableError(`Anthropic Messages review failed for ${this.modelId}: ${message}`, this.modelId);
    }
  }
}

export class ClaudePlatformAwsReviewPipeline implements AiReviewPipeline {
  private client?: AnthropicMessageClient;

  constructor(
    private workspaceId: string | undefined,
    private modelId: string,
    private region = process.env.AWS_REGION,
    client?: AnthropicMessageClient
  ) {
    this.client = client;
  }

  async review(submission: ColaSubmission): Promise<AutomationDecision> {
    if (!this.workspaceId) {
      throw new AiReviewUnavailableError(
        `Claude Platform on AWS review failed for ${this.modelId}: missing ANTHROPIC_AWS_WORKSPACE_ID`,
        this.modelId
      );
    }

    const deterministic = evaluateSubmission(submission, undefined, { requireExtraction: false });
    try {
      const content = buildAnthropicContent(submission, deterministic);
      const imageBlockCount = countAnthropicImageBlocks(content);
      const response = await this.getClient().messages.create({
        model: this.modelId,
        max_tokens: 256,
        messages: [
          {
            role: "user",
            content
          }
        ]
      });
      const text = response.content?.find(isAnthropicTextBlock)?.text ?? "";
      const parsed = parseBedrockDecision(text);
      const status = deterministic.status === "rejected" ? "rejected" : parsed.status ?? deterministic.status;
      return {
        status,
        confidence: parsed.confidence ?? deterministic.confidence,
        rationale: parsed.rationale ?? deterministic.rationale,
        evidence: [
          ...deterministic.evidence,
          {
            field: "claudePlatformAwsModelId",
            severity: "info",
            message: `Claude Platform on AWS review completed with ${this.modelId}.`,
            extracted: this.modelId
          },
          {
            field: "claudePlatformAwsImageCount",
            severity: "info",
            message: `Sent ${imageBlockCount} label image(s) to Claude Platform on AWS from ${submission.images.length} submitted image record(s).`,
            submitted: submission.images.length,
            extracted: imageBlockCount
          }
        ]
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new AiReviewUnavailableError(`Claude Platform on AWS review failed for ${this.modelId}: ${message}`, this.modelId);
    }
  }

  private getClient(): AnthropicMessageClient {
    if (!this.client) {
      const client = new AnthropicAws({
        awsRegion: this.region,
        workspaceId: this.workspaceId
      }) as unknown as AnthropicMessageClient;
      this.client = client;
    }
    return this.client;
  }
}

export function createReviewPipeline(): AiReviewPipeline {
  if (process.env.AI_REVIEW_PROVIDER === "claude-platform-aws" || process.env.AI_REVIEW_PROVIDER === "anthropic-aws") {
    return new ClaudePlatformAwsReviewPipeline(
      process.env.ANTHROPIC_AWS_WORKSPACE_ID,
      process.env.ANTHROPIC_MODEL_ID ?? "claude-opus-4-7",
      process.env.AWS_REGION
    );
  }
  if (process.env.AI_REVIEW_PROVIDER === "anthropic") {
    return new AnthropicMessagesReviewPipeline(
      process.env.ANTHROPIC_API_KEY,
      process.env.ANTHROPIC_MODEL_ID ?? "claude-opus-4-7"
    );
  }
  if (process.env.ENABLE_AWS_AI === "true" && process.env.BEDROCK_MODEL_ID) {
    return new BedrockReviewPipeline(process.env.BEDROCK_MODEL_ID, process.env.BEDROCK_REGION ?? process.env.AWS_REGION);
  }
  const provider = process.env.ENABLE_AWS_AI === "true" ? new AwsGovCloudExtractionProvider() : new PendingExtractionProvider();
  return new DeterministicReviewPipeline(provider);
}

function buildBedrockPrompt(submission: ColaSubmission, deterministic: AutomationDecision): string {
  return [
    "You are reviewing a TTB COLA alcohol label application.",
    "Return only compact JSON with keys status, confidence, rationale.",
    "Allowed status values: approved, needs_review, rejected.",
    "Never downgrade a deterministic hard rejection.",
    "Use approved when the submitted fields are complete, coherent, and the deterministic pre-screen has no reject evidence.",
    "This prototype may not have OCR extraction yet; absence of OCR alone is not a reason to force needs_review.",
    "Use needs_review for uncertainty, missing critical evidence, or label/application ambiguity.",
    "",
    `Submitted application: ${JSON.stringify({
      brandName: submission.brandName,
      productName: submission.productName,
      productType: submission.productType,
      className: submission.className,
      originName: submission.originName,
      domesticOrImported: submission.domesticOrImported,
      abv: submission.abv,
      volume: submission.volume,
      volumeUnit: submission.volumeUnit,
      imageCount: submission.images.length
    })}`,
    `Deterministic pre-screen: ${JSON.stringify(deterministic)}`
  ].join("\n");
}

function buildAnthropicPrompt(submission: ColaSubmission, deterministic: AutomationDecision): string {
  return [
    buildBedrockPrompt(submission, deterministic),
    "",
    "If image blocks are attached, inspect the label imagery directly and use it to verify visible brand, product, class/type, origin, ABV, volume, and warning/barcode cues when readable.",
    "Do not expose chain-of-thought. Keep the rationale concise and evidence-oriented.",
    `Attached image metadata: ${JSON.stringify(
      submission.images.map((image) => ({
        id: image.id,
        position: image.position,
        hasUrl: Boolean(validHttpUrl(image.url)),
        hasUploadedData: Boolean(parseDataUrl(image.dataUrl)),
        filename: image.filename,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        localPath: image.localPath,
        widthPixels: image.widthPixels,
        heightPixels: image.heightPixels
      }))
    )}`
  ].join("\n");
}

function buildAnthropicContent(submission: ColaSubmission, deterministic: AutomationDecision): AnthropicMessageContent {
  const prompt = buildAnthropicPrompt(submission, deterministic);
  const imageBlocks = submission.images
    .map((image): AnthropicUrlImageBlock | AnthropicBase64ImageBlock | undefined => {
      const url = validHttpUrl(image.url);
      if (url) return { type: "image", source: { type: "url", url } };
      const data = parseDataUrl(image.dataUrl);
      return data ? { type: "image", source: { type: "base64", media_type: data.mediaType, data: data.base64 } } : undefined;
    })
    .filter((block): block is AnthropicUrlImageBlock | AnthropicBase64ImageBlock => Boolean(block))
    .slice(0, MAX_ANTHROPIC_IMAGE_BLOCKS);

  if (!imageBlocks.length) return prompt;
  return [{ type: "text", text: prompt }, ...imageBlocks];
}

function validHttpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function parseDataUrl(value: string | undefined): { mediaType: string; base64: string } | undefined {
  if (!value) return undefined;
  const match = value.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return undefined;
  return {
    mediaType: match[1] === "image/jpg" ? "image/jpeg" : match[1],
    base64: match[2]
  };
}

function countAnthropicImageBlocks(content: AnthropicMessageContent): number {
  return Array.isArray(content) ? content.filter((block) => block.type === "image").length : 0;
}

function parseBedrockDecision(text: string): Partial<AutomationDecision> {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const status =
      parsed.status === "approved" || parsed.status === "needs_review" || parsed.status === "rejected"
        ? parsed.status
        : undefined;
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : undefined;
    const rationale = typeof parsed.rationale === "string" ? parsed.rationale : undefined;
    return { status, confidence, rationale };
  } catch {
    return {};
  }
}

interface AnthropicMessagesResponse {
  content?: AnthropicContentBlock[];
  error?: { message?: string; type?: string };
}

function isAnthropicTextBlock(part: AnthropicContentBlock): part is { type: "text"; text: string } {
  return part.type === "text" && "text" in part && typeof part.text === "string";
}

function readAnthropicError(body: AnthropicMessagesResponse, status: number): string {
  const detail = body.error?.message ?? body.error?.type;
  return detail ? `HTTP ${status}: ${detail}` : `HTTP ${status}`;
}
