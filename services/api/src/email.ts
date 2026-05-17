import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import type { AdminOverride, AutomationDecision, ColaSubmission } from "@cola/shared";

export interface EmailMessage {
  to: string[];
  subject: string;
  text: string;
  html?: string;
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
          Body: {
            Text: { Data: message.text },
            ...(message.html ? { Html: { Data: message.html } } : {})
          }
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
  const adminEmails = parseEmailList(process.env.ADMIN_NOTIFY_EMAIL).filter((email) => email !== normalizeEmailAddress(submission.applicantEmail));
  await provider.send({
    to: [submission.applicantEmail],
    subject: `COLA submission received: ${submission.brandName}`,
    text: `Your COLA submission ${submission.id} was received. Automated status: ${decision.status}.`,
    html: renderTddsEmail({
      title: "COLA submission received",
      eyebrow: "Applicant confirmation",
      status: decision.status,
      summary: `Your ${submission.brandName} application has been received.`,
      rows: submissionRows(submission, decision.rationale)
    })
  });

  if (adminEmails.length) {
    await provider.send({
      to: adminEmails,
      subject: `New COLA submission: ${submission.brandName}`,
      text: `Submission ${submission.id} was submitted by ${submission.applicantEmail}. Automated status: ${decision.status}.`,
      html: renderTddsEmail({
        title: "New COLA submission",
        eyebrow: "Admin notification",
        status: decision.status,
        summary: `${submission.applicantEmail} submitted a COLA application for ${submission.brandName}.`,
        rows: submissionRows(submission, decision.rationale)
      })
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
    text: `An admin updated submission ${submission.id} to ${override.status}. Reason: ${override.reason}`,
    html: renderTddsEmail({
      title: "COLA decision updated",
      eyebrow: "Admin override",
      status: override.status,
      summary: `A Treasury reviewer updated the decision for ${submission.brandName}.`,
      rows: [
        ...submissionRows(submission),
        ["Override reason", override.reason],
        ["Updated at", new Date(override.createdAt).toLocaleString("en-US", { timeZone: "UTC", timeZoneName: "short" })]
      ]
    })
  });
}

function submissionRows(submission: ColaSubmission, rationale?: string): Array<[string, string]> {
  return [
    ["Submission ID", submission.id],
    ["Brand", submission.brandName],
    ["Product", submission.productName],
    ["Class", submission.className],
    ["Origin", submission.originName],
    ["Images", String(submission.images.length)],
    ...(rationale ? ([["Decision rationale", rationale]] as Array<[string, string]>) : [])
  ];
}

function parseEmailList(value: string | undefined): string[] {
  if (!value) return [];
  const emails = value
    .split(",")
    .map(normalizeEmailAddress)
    .filter(Boolean);
  return [...new Set(emails)];
}

function normalizeEmailAddress(email: string): string {
  return email.trim().toLowerCase();
}

function renderTddsEmail({
  title,
  eyebrow,
  status,
  summary,
  rows
}: {
  title: string;
  eyebrow: string;
  status: string;
  summary: string;
  rows: Array<[string, string]>;
}): string {
  const tone = emailStatusTone(status);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;background:#f0f0f0;color:#1b1b1b;font-family:'Public Sans',Arial,sans-serif;">
    <div style="padding:24px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #dfe1e2;border-collapse:collapse;">
        <tr>
          <td style="background:#162e51;color:#ffffff;padding:24px 28px;">
            <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#73b3e7;font-weight:700;">U.S. Department of the Treasury</div>
            <h1 style="font-family:Georgia,serif;font-size:28px;line-height:1.15;margin:8px 0 0;">${escapeHtml(title)}</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:22px 28px 8px;">
            <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#565c65;font-weight:700;">${escapeHtml(eyebrow)}</div>
            <p style="font-size:16px;line-height:1.55;margin:8px 0 16px;">${escapeHtml(summary)}</p>
            <span style="display:inline-block;background:${tone.background};color:${tone.color};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;border-radius:3px;padding:6px 10px;">${escapeHtml(status.replace(/_/g, " "))}</span>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 28px 28px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border-top:2px solid #005ea2;">
              ${rows
                .map(
                  ([label, value]) => `<tr>
                <th align="left" style="width:34%;padding:12px 10px;border-bottom:1px solid #dfe1e2;color:#3d4551;font-size:13px;text-transform:uppercase;letter-spacing:.04em;">${escapeHtml(label)}</th>
                <td style="padding:12px 10px;border-bottom:1px solid #dfe1e2;color:#1b1b1b;font-size:14px;line-height:1.45;">${escapeHtml(value)}</td>
              </tr>`
                )
                .join("")}
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#f0f0f0;border-top:1px solid #dfe1e2;padding:14px 28px;color:#565c65;font-size:12px;line-height:1.45;">
            This message was generated by the COLA Label Verification demo.
          </td>
        </tr>
      </table>
    </div>
  </body>
</html>`;
}

function emailStatusTone(status: string) {
  if (status === "approved") return { background: "#ecf3ec", color: "#1a6027" };
  if (status === "rejected") return { background: "#f4e3db", color: "#b50909" };
  if (status === "needs_review") return { background: "#faf3d1", color: "#936f38" };
  return { background: "#d9e8f6", color: "#1a4480" };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
