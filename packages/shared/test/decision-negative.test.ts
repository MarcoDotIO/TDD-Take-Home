import { describe, expect, test } from "bun:test";
import { evaluateSubmission, type ColaSubmission } from "../src";

const baseSubmission: ColaSubmission = {
  id: "synthetic-negative",
  applicantId: "applicant-1",
  applicantEmail: "applicant@example.gov",
  brandName: "OLD TOM DISTILLERY",
  productName: "Kentucky Straight Bourbon Whiskey",
  productType: "distilled spirits",
  className: "bourbon whisky",
  originName: "kentucky",
  domesticOrImported: "domestic",
  abv: 45,
  volume: 750,
  volumeUnit: "milliliters",
  images: [{ id: "front", localPath: "front.png" }],
  submittedAt: "2026-01-01T00:00:00.000Z",
  status: "submitted"
};

describe("synthetic rejection behavior", () => {
  test("rejects clear brand mismatch", () => {
    const decision = evaluateSubmission(baseSubmission, {
      brandName: "COMPLETELY DIFFERENT BRAND",
      productName: baseSubmission.productName,
      governmentWarningText: "GOVERNMENT WARNING: (1) According to the Surgeon General..."
    });

    expect(decision.status).toBe("rejected");
    expect(decision.evidence.some((item) => item.field === "brandName" && item.severity === "reject")).toBe(true);
  });

  test("rejects ABV mismatch when both submitted and extracted values are present", () => {
    const decision = evaluateSubmission(baseSubmission, {
      brandName: baseSubmission.brandName,
      productName: baseSubmission.productName,
      abv: 12,
      governmentWarningText: "GOVERNMENT WARNING: (1) According to the Surgeon General..."
    });

    expect(decision.status).toBe("rejected");
    expect(decision.evidence.some((item) => item.field === "abv" && item.severity === "reject")).toBe(true);
  });

  test("rejects missing exact government warning prefix when warning text is extracted", () => {
    const decision = evaluateSubmission(baseSubmission, {
      brandName: baseSubmission.brandName,
      productName: baseSubmission.productName,
      governmentWarningText: "Government Warning: title case is not acceptable"
    });

    expect(decision.status).toBe("rejected");
    expect(decision.evidence.some((item) => item.field === "governmentWarningText")).toBe(true);
  });

  test("routes low OCR confidence to review when hard fields match", () => {
    const decision = evaluateSubmission(baseSubmission, {
      brandName: "Old Tom Distillery",
      productName: "Kentucky Straight Bourbon Whiskey",
      abv: 45,
      governmentWarningText: "GOVERNMENT WARNING: (1) According to the Surgeon General...",
      ocrConfidence: 0.4
    });

    expect(decision.status).toBe("needs_review");
    expect(decision.evidence.some((item) => item.field === "ocrConfidence" && item.severity === "review")).toBe(true);
  });
});
