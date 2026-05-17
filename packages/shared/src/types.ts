export type UserRole = "applicant" | "admin";

export type BeverageType = "distilled spirits" | "malt beverage" | "wine" | "unknown";

export type DecisionStatus = "approved" | "needs_review" | "rejected";

export type ApplicationStatus = "draft" | "submitted" | "processing" | DecisionStatus;

export type EvidenceSeverity = "info" | "review" | "reject";

export interface ColaImage {
  id: string;
  localPath?: string;
  url?: string;
  position?: string;
  widthPixels?: number;
  heightPixels?: number;
}

export interface ColaSubmission {
  id: string;
  applicantId: string;
  applicantEmail: string;
  brandName: string;
  productName: string;
  productType: BeverageType;
  className: string;
  originName: string;
  domesticOrImported: "domestic" | "imported" | "unknown";
  abv?: number;
  volume?: number;
  volumeUnit?: string;
  barcodeValue?: string;
  llmCategory?: string;
  llmCategoryPath?: string;
  images: ColaImage[];
  submittedAt: string;
  status: ApplicationStatus;
}

export interface ExtractedLabelFields {
  brandName?: string;
  productName?: string;
  productType?: BeverageType;
  className?: string;
  originName?: string;
  abv?: number;
  volume?: number;
  volumeUnit?: string;
  barcodeValue?: string;
  governmentWarningText?: string;
  ocrConfidence?: number;
}

export interface DecisionEvidence {
  field: string;
  severity: EvidenceSeverity;
  message: string;
  submitted?: unknown;
  extracted?: unknown;
}

export interface AutomationDecision {
  status: DecisionStatus;
  confidence: number;
  rationale: string;
  evidence: DecisionEvidence[];
}

export interface AdminOverride {
  submissionId: string;
  adminId: string;
  status: DecisionStatus;
  reason: string;
  createdAt: string;
}

export interface AuthContext {
  userId: string;
  email: string;
  roles: UserRole[];
}

export interface AuditEvent {
  id: string;
  actorId: string;
  action: string;
  submissionId?: string;
  createdAt: string;
  details?: Record<string, unknown>;
}
