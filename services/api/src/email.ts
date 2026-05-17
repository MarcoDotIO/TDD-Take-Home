import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import type { AdminOverride, AutomationDecision, ColaSubmission } from "@cola/shared";

export interface EmailMessage {
  to: string[];
  subject: string;
  text: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

export class ConsoleEmailProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<void> {
    console.info("[email:console]", JSON.stringify(message));
  }
}

export class SesEmailProvider implements EmailProvider {
  private client = new SESClient({ region: process.env.AWS_REGION });

  constructor(private fromEmail: string) {}

  async send(message: EmailMessage): Promise<void> {
    await this.client.send(
      new SendEmailCommand({
        Source: this.fromEmail,
        Destination: { ToAddresses: message.to },
        Message: {
          Subject: { Data: message.subject },
          Body: { Text: { Data: message.text } }
        }
      })
    );
  }
}

export function createEmailProvider(): EmailProvider {
  const fromEmail = process.env.SES_FROM_EMAIL;
  if (process.env.USE_SES_EMAIL === "true" && fromEmail && process.env.AWS_REGION) {
    return new SesEmailProvider(fromEmail);
  }
  return new ConsoleEmailProvider();
}

export async function sendSubmissionEmails(
  provider: EmailProvider,
  submission: ColaSubmission,
  decision: AutomationDecision
): Promise<void> {
  const adminEmail = process.env.ADMIN_NOTIFY_EMAIL;
  await provider.send({
    to: [submission.applicantEmail],
    subject: `COLA submission received: ${submission.brandName}`,
    text: `Your COLA submission ${submission.id} was received. Automated status: ${decision.status}.`
  });

  if (adminEmail) {
    await provider.send({
      to: [adminEmail],
      subject: `New COLA submission: ${submission.brandName}`,
      text: `Submission ${submission.id} was submitted by ${submission.applicantEmail}. Automated status: ${decision.status}.`
    });
  }
}

export async function sendOverrideEmail(
  provider: EmailProvider,
  submission: ColaSubmission,
  override: AdminOverride
): Promise<void> {
  await provider.send({
    to: [submission.applicantEmail],
    subject: `COLA decision updated: ${submission.brandName}`,
    text: `An admin updated submission ${submission.id} to ${override.status}. Reason: ${override.reason}`
  });
}
