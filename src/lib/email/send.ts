/**
 * Email sending (SPEC §12). All sends happen AFTER the DB commit; a failed
 * send never fails the request — it's logged as an email.failed event.
 * Recipients: all is_primary contacts (vendor mails); all active admins
 * (admin mails). Presigned URLs and raw tokens are never logged; the events
 * payload records template + recipients + resend id only.
 */
import { Resend } from "resend";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { admins, contacts, projects } from "@/db/schema";
import { logEvent } from "@/lib/events";
import { formatDate } from "@/lib/format";
import { officeLabel, type Office } from "@/lib/schemas/project";
import { decryptVendorToken } from "@/lib/token-crypto";
import { vendorLinkUrl } from "@/lib/tokens";
import type { EmailContent, ProjectSummary } from "./templates";

let client: Resend | null = null;

function resend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  client ??= new Resend(process.env.RESEND_API_KEY);
  return client;
}

/** Send one email and log email.sent / email.failed. Never throws. */
export async function sendAndLog(
  projectId: string | null,
  to: string[],
  content: EmailContent,
): Promise<void> {
  if (to.length === 0) return;
  const base = { template: content.template, recipients: to };
  try {
    const api = resend();
    if (!api) {
      throw new Error("RESEND_API_KEY is not configured");
    }
    const { data, error } = await api.emails.send({
      from: process.env.EMAIL_FROM ?? "KDP Mail Program <onboarding@resend.dev>",
      to,
      subject: content.subject,
      html: content.html,
      text: content.text,
    });
    if (error) throw new Error(error.message);
    await logEvent(db, {
      projectId,
      actor: "system",
      eventType: "email.sent",
      payload: { ...base, resendId: data?.id ?? null },
    });
  } catch (err) {
    console.error(`Email send failed (${content.template}):`, err);
    await logEvent(db, {
      projectId,
      actor: "system",
      eventType: "email.failed",
      payload: {
        ...base,
        error: err instanceof Error ? err.message : String(err),
      },
    }).catch((logErr) => console.error("Failed to log email.failed:", logErr));
  }
}

// ---------------------------------------------------------------------------
// Recipient + context helpers
// ---------------------------------------------------------------------------

export async function primaryContactEmails(projectId: string): Promise<string[]> {
  const rows = await db
    .select({ email: contacts.email })
    .from(contacts)
    .where(and(eq(contacts.projectId, projectId), eq(contacts.isPrimary, true)));
  return [...new Set(rows.map((r) => r.email))];
}

export async function activeAdminEmails(): Promise<string[]> {
  const rows = await db
    .select({ email: admins.email })
    .from(admins)
    .where(eq(admins.active, true));
  return rows.map((r) => r.email);
}

export type ProjectEmailContext = {
  summary: ProjectSummary;
  /** Magic link, when reconstructable (null → vendor footer omitted). */
  magicLink: string | null;
  adminUrl: string;
  primaries: string[];
  campaignContactEmail: string;
};

/** Load everything the templates need for a project, post-commit. */
export async function projectEmailContext(
  projectId: string,
): Promise<ProjectEmailContext | null> {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project) return null;
  const raw = decryptVendorToken(project.vendorTokenEncrypted);
  return {
    summary: {
      candidateSupported: project.candidateSupported,
      officeLabel: officeLabel(project.office as Office),
      mailDateFormatted: formatDate(project.mailDate),
    },
    magicLink: raw ? vendorLinkUrl(raw) : null,
    adminUrl: `${process.env.APP_URL}/admin/projects/${project.id}`,
    primaries: await primaryContactEmails(projectId),
    campaignContactEmail: project.campaignContactEmail,
  };
}
