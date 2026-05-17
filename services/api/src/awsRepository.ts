import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { AdminOverride, AuditEvent, AutomationDecision, ColaSubmission } from "@cola/shared";
import type { UserAccount, UserRepository } from "./auth";
import type { SubmissionRecord, SubmissionRepository } from "./repository";

export class DynamoSubmissionRepository implements SubmissionRepository {
  private client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }), {
    marshallOptions: {
      removeUndefinedValues: true
    }
  });

  constructor(
    private submissionsTable: string,
    private auditTable: string
  ) {}

  async create(submission: ColaSubmission, decision?: AutomationDecision): Promise<SubmissionRecord> {
    const record: SubmissionRecord = { submission, decision, overrides: [] };
    await this.client.send(
      new PutCommand({
        TableName: this.submissionsTable,
        Item: {
          pk: `SUBMISSION#${submission.id}`,
          applicantId: submission.applicantId,
          record
        }
      })
    );
    return record;
  }

  async listForApplicant(applicantId: string): Promise<SubmissionRecord[]> {
    const response = await this.client.send(
      new QueryCommand({
        TableName: this.submissionsTable,
        IndexName: "byApplicant",
        KeyConditionExpression: "applicantId = :applicantId",
        ExpressionAttributeValues: { ":applicantId": applicantId }
      })
    );
    return (response.Items ?? []).map((item) => item.record as SubmissionRecord);
  }

  async listAll(): Promise<SubmissionRecord[]> {
    const response = await this.client.send(new ScanCommand({ TableName: this.submissionsTable }));
    return (response.Items ?? []).map((item) => item.record as SubmissionRecord);
  }

  async get(id: string): Promise<SubmissionRecord | undefined> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.submissionsTable,
        Key: { pk: `SUBMISSION#${id}` }
      })
    );
    return response.Item?.record as SubmissionRecord | undefined;
  }

  async applyOverride(override: AdminOverride): Promise<SubmissionRecord> {
    const current = await this.get(override.submissionId);
    if (!current) throw new Error("Submission not found.");
    const record: SubmissionRecord = {
      ...current,
      submission: { ...current.submission, status: override.status },
      overrides: [...current.overrides, override]
    };
    await this.client.send(
      new UpdateCommand({
        TableName: this.submissionsTable,
        Key: { pk: `SUBMISSION#${override.submissionId}` },
        UpdateExpression: "SET #record = :record",
        ExpressionAttributeNames: { "#record": "record" },
        ExpressionAttributeValues: { ":record": record }
      })
    );
    return record;
  }

  async audit(event: AuditEvent): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.auditTable,
        Item: {
          pk: `AUDIT#${event.id}`,
          submissionId: event.submissionId,
          createdAt: event.createdAt,
          event
        }
      })
    );
  }
}

export class DynamoUserRepository implements UserRepository {
  private client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }), {
    marshallOptions: {
      removeUndefinedValues: true
    }
  });

  constructor(private usersTable: string) {}

  async findByEmail(email: string): Promise<UserAccount | undefined> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.usersTable,
        Key: { email }
      })
    );
    return response.Item as UserAccount | undefined;
  }

  async create(account: UserAccount): Promise<UserAccount> {
    await this.client.send(
      new PutCommand({
        TableName: this.usersTable,
        Item: account,
        ConditionExpression: "attribute_not_exists(email)"
      })
    );
    return account;
  }
}
