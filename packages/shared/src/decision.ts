import type { AutomationDecision, ColaSubmission, DecisionEvidence, ExtractedLabelFields } from "./types";
import {
  GOVERNMENT_WARNING_PREFIX,
  hasGovernmentWarning,
  normalizeVolumeUnit,
  numbersClose,
  productFamilyFromCategoryPath,
  productFamilyFromType,
  textEquivalent
} from "./normalization";

export interface DecisionOptions {
  requireExtraction?: boolean;
  requireGovernmentWarning?: boolean;
  rejectOnHardMismatch?: boolean;
}

const DEFAULT_OPTIONS: Required<DecisionOptions> = {
  requireExtraction: false,
  requireGovernmentWarning: true,
  rejectOnHardMismatch: true
};

export function evaluateSubmission(
  submission: ColaSubmission,
  extraction?: ExtractedLabelFields,
  options: DecisionOptions = {}
): AutomationDecision {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const evidence: DecisionEvidence[] = [];

  addRequiredSubmissionEvidence(submission, evidence);
  addCategoryEvidence(submission, evidence);

  if (!extraction) {
    if (config.requireExtraction) {
      evidence.push({
        field: "extraction",
        severity: "review",
        message: "No OCR/model extraction is available yet."
      });
    }
    return summarizeDecision(evidence, "Known fields are structurally valid; extraction is pending.");
  }

  addExtractionEvidence(submission, extraction, evidence, config);

  return summarizeDecision(evidence, "Automated field comparison completed.");
}

function addRequiredSubmissionEvidence(submission: ColaSubmission, evidence: DecisionEvidence[]): void {
  const requiredTextFields: Array<[keyof ColaSubmission, string]> = [
    ["brandName", "Brand name is required."],
    ["productName", "Product name is required."],
    ["className", "Class/type designation is required."],
    ["originName", "Origin is required."],
    ["domesticOrImported", "Domestic/imported designation is required."]
  ];

  for (const [field, message] of requiredTextFields) {
    const value = submission[field];
    if (typeof value !== "string" || value.trim().length === 0 || value === "unknown") {
      evidence.push({ field, severity: "reject", message });
    }
  }

  if (!submission.images.length) {
    evidence.push({
      field: "images",
      severity: "reject",
      message: "At least one label image is required."
    });
  }
}

function addCategoryEvidence(submission: ColaSubmission, evidence: DecisionEvidence[]): void {
  const typeFamily = productFamilyFromType(submission.productType);
  const categoryFamily = productFamilyFromCategoryPath(submission.llmCategoryPath);
  if (typeFamily !== "Unknown" && categoryFamily !== "Unknown" && typeFamily !== categoryFamily) {
    evidence.push({
      field: "llmCategoryPath",
      severity: "review",
      message: "Product type and category path disagree; route to human review instead of hard rejection.",
      submitted: submission.productType,
      extracted: submission.llmCategoryPath
    });
  }
}

function addExtractionEvidence(
  submission: ColaSubmission,
  extraction: ExtractedLabelFields,
  evidence: DecisionEvidence[],
  config: Required<DecisionOptions>
): void {
  compareText("brandName", submission.brandName, extraction.brandName, evidence);
  compareText("productName", submission.productName, extraction.productName, evidence);
  compareText("className", submission.className, extraction.className, evidence, "review");
  compareText("originName", submission.originName, extraction.originName, evidence, "review");

  if (submission.abv !== undefined && extraction.abv !== undefined && !numbersClose(submission.abv, extraction.abv, 0.1)) {
    evidence.push({
      field: "abv",
      severity: "reject",
      message: "Alcohol content does not match the extracted label value.",
      submitted: submission.abv,
      extracted: extraction.abv
    });
  }

  if (
    submission.volume !== undefined &&
    extraction.volume !== undefined &&
    !numbersClose(submission.volume, extraction.volume, 0.1)
  ) {
    evidence.push({
      field: "volume",
      severity: "review",
      message: "Net contents differ from the extracted label value.",
      submitted: submission.volume,
      extracted: extraction.volume
    });
  }

  const submittedUnit = normalizeVolumeUnit(submission.volumeUnit);
  const extractedUnit = normalizeVolumeUnit(extraction.volumeUnit);
  if (submittedUnit && extractedUnit && submittedUnit !== extractedUnit) {
    evidence.push({
      field: "volumeUnit",
      severity: "review",
      message: "Net contents unit differs from the extracted label value.",
      submitted: submittedUnit,
      extracted: extractedUnit
    });
  }

  if (submission.barcodeValue && extraction.barcodeValue && submission.barcodeValue !== extraction.barcodeValue) {
    evidence.push({
      field: "barcodeValue",
      severity: "review",
      message: "Barcode value differs from the extracted label value.",
      submitted: submission.barcodeValue,
      extracted: extraction.barcodeValue
    });
  }

  if (config.requireGovernmentWarning && extraction.governmentWarningText !== undefined) {
    if (!hasGovernmentWarning(extraction.governmentWarningText)) {
      evidence.push({
        field: "governmentWarningText",
        severity: "reject",
        message: `${GOVERNMENT_WARNING_PREFIX} is missing or not capitalized exactly.`
      });
    }
  }

  if (extraction.ocrConfidence !== undefined && extraction.ocrConfidence < 0.78) {
    evidence.push({
      field: "ocrConfidence",
      severity: "review",
      message: "OCR confidence is low; route to human review.",
      extracted: extraction.ocrConfidence
    });
  }
}

function compareText(
  field: string,
  submitted: string | undefined,
  extracted: string | undefined,
  evidence: DecisionEvidence[],
  severity: DecisionEvidence["severity"] = "reject"
): void {
  if (!submitted || !extracted) return;
  if (!textEquivalent(submitted, extracted)) {
    evidence.push({
      field,
      severity,
      message: `${field} does not match the extracted label value.`,
      submitted,
      extracted
    });
  }
}

function summarizeDecision(evidence: DecisionEvidence[], fallbackRationale: string): AutomationDecision {
  const hasReject = evidence.some((item) => item.severity === "reject");
  const hasReview = evidence.some((item) => item.severity === "review");
  const status = hasReject ? "rejected" : hasReview ? "needs_review" : "approved";
  const confidence = hasReject ? 0.95 : hasReview ? 0.62 : 0.9;

  return {
    status,
    confidence,
    evidence,
    rationale: evidence.length
      ? evidence.map((item) => item.message).slice(0, 3).join(" ")
      : fallbackRationale
  };
}
