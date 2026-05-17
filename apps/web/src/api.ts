import type { ColaSubmission, DecisionStatus } from "@cola/shared";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787").replace(/\/+$/, "");

export interface Session {
  userId: string;
  email: string;
  roles: string[];
}

export interface SubmissionRecord {
  submission: ColaSubmission;
  decision?: {
    status: DecisionStatus;
    confidence: number;
    rationale: string;
    evidence: Array<{ field: string; severity: string; message: string }>;
  };
  overrides: Array<{ status: DecisionStatus; reason: string; createdAt: string; adminId: string }>;
}

export interface SubmissionDraft {
  brandName: string;
  productName: string;
  productType: ColaSubmission["productType"];
  className: string;
  originName: string;
  domesticOrImported: ColaSubmission["domesticOrImported"];
  abv?: number;
  volume?: number;
  volumeUnit?: string;
  images: Array<{ id: string; localPath?: string; url?: string; position?: string }>;
}

export async function createSubmission(session: Session, draft: SubmissionDraft): Promise<SubmissionRecord> {
  return apiFetch(session, "/submissions", {
    method: "POST",
    body: JSON.stringify(draft)
  });
}

export async function listApplicantSubmissions(session: Session): Promise<SubmissionRecord[]> {
  return apiFetch(session, "/submissions");
}

export async function listAdminSubmissions(session: Session): Promise<SubmissionRecord[]> {
  return apiFetch(session, "/admin/submissions");
}

export async function overrideSubmission(
  session: Session,
  submissionId: string,
  status: DecisionStatus,
  reason: string
): Promise<SubmissionRecord> {
  return apiFetch(session, `/admin/submissions/${submissionId}/override`, {
    method: "POST",
    body: JSON.stringify({ status, reason })
  });
}

async function apiFetch<T>(session: Session, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-user-id": session.userId,
      "x-user-email": session.email,
      "x-user-roles": session.roles.join(","),
      ...init.headers
    }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error ?? response.statusText);
  }
  return response.json();
}
