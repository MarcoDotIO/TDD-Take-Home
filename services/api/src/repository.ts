import type { AdminOverride, AuditEvent, AutomationDecision, ColaSubmission } from "@cola/shared";

export interface SubmissionRecord {
  submission: ColaSubmission;
  decision?: AutomationDecision;
  overrides: AdminOverride[];
}

export interface SubmissionRepository {
  create(submission: ColaSubmission, decision?: AutomationDecision): Promise<SubmissionRecord>;
  listForApplicant(applicantId: string): Promise<SubmissionRecord[]>;
  listAll(): Promise<SubmissionRecord[]>;
  get(id: string): Promise<SubmissionRecord | undefined>;
  applyOverride(override: AdminOverride): Promise<SubmissionRecord>;
  audit(event: AuditEvent): Promise<void>;
}

export class InMemorySubmissionRepository implements SubmissionRepository {
  private records = new Map<string, SubmissionRecord>();
  private events: AuditEvent[] = [];

  async create(submission: ColaSubmission, decision?: AutomationDecision): Promise<SubmissionRecord> {
    const record: SubmissionRecord = { submission, decision, overrides: [] };
    this.records.set(submission.id, record);
    return record;
  }

  async listForApplicant(applicantId: string): Promise<SubmissionRecord[]> {
    return [...this.records.values()].filter((record) => record.submission.applicantId === applicantId);
  }

  async listAll(): Promise<SubmissionRecord[]> {
    return [...this.records.values()];
  }

  async get(id: string): Promise<SubmissionRecord | undefined> {
    return this.records.get(id);
  }

  async applyOverride(override: AdminOverride): Promise<SubmissionRecord> {
    const record = this.records.get(override.submissionId);
    if (!record) {
      throw new Error("Submission not found.");
    }
    record.overrides.push(override);
    record.submission.status = override.status;
    this.records.set(record.submission.id, record);
    return record;
  }

  async audit(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }
}
