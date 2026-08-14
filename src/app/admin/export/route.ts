/**
 * CSV export (SPEC §11): GET /admin/export?status=&year= — one row per
 * project, tombstones included as rows flagged deleted=true with their
 * preserved columns. UTF-8 BOM, proper quoting.
 */
import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { contacts, deletedProjects, projects } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { buildCsv } from "@/lib/csv";
import { jsonError } from "@/lib/http";
import { PROJECT_STATUSES, type ProjectStatus } from "@/lib/state-machine";
import { VENDOR_ROLE_VALUES } from "@/lib/schemas/project";

export async function GET(request: Request): Promise<NextResponse> {
  const session = await requireAdmin();
  if (!session) return jsonError(401, "Not signed in.");

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status") ?? "";
  const yearParam = url.searchParams.get("year") ?? "";
  const status = (PROJECT_STATUSES as readonly string[]).includes(statusParam)
    ? (statusParam as ProjectStatus)
    : null;
  const year = /^\d{4}$/.test(yearParam) ? yearParam : null;

  const header = [
    "id",
    "candidate",
    "office",
    "district_detail",
    "description",
    "pieces",
    "total_cost",
    "mail_date",
    "status",
    "status_changed_at",
    "created_at",
    "permit_number",
    "post_office_location",
    "campaign_contact_name",
    "campaign_contact_email",
    "campaign_contact_phone",
  ];
  for (const role of VENDOR_ROLE_VALUES) {
    header.push(
      `${role}_org`,
      `${role}_contact`,
      `${role}_email`,
      `${role}_paid_by_kdp`,
      `${role}_paid_at`,
    );
  }
  header.push("fully_paid", "deleted");

  const projectRows = await db
    .select()
    .from(projects)
    .where(status ? eq(projects.status, status) : undefined)
    .orderBy(asc(projects.mailDate));
  const allContacts = await db.select().from(contacts);
  const contactsByProject = new Map<string, typeof allContacts>();
  for (const c of allContacts) {
    const list = contactsByProject.get(c.projectId) ?? [];
    list.push(c);
    contactsByProject.set(c.projectId, list);
  }

  const rows: string[][] = [];
  for (const p of projectRows) {
    if (year && !p.mailDate.startsWith(`${year}-`)) continue;
    const pContacts = contactsByProject.get(p.id) ?? [];
    const row = [
      p.id,
      p.candidateSupported,
      p.office,
      p.districtDetail ?? "",
      p.description,
      String(p.pieceCount),
      (p.totalCostCents / 100).toFixed(2),
      p.mailDate,
      p.status,
      p.statusChangedAt.toISOString(),
      p.createdAt.toISOString(),
      p.permitNumber,
      p.postOfficeLocation,
      p.campaignContactName,
      p.campaignContactEmail,
      p.campaignContactPhone ?? "",
    ];
    for (const role of VENDOR_ROLE_VALUES) {
      const c = pContacts.find((x) => x.role === role);
      row.push(
        c?.orgName ?? "",
        c?.contactName ?? "",
        c?.email ?? "",
        c ? String(c.paidByKdp) : "",
        c?.paidAt?.toISOString() ?? "",
      );
    }
    const needing = pContacts.filter((c) => c.paidByKdp);
    const fullyPaid = needing.every((c) => c.paidAt !== null);
    row.push(String(fullyPaid), "false");
    rows.push(row);
  }

  // Tombstones (§11): preserved columns only, flagged deleted=true.
  const tombstones = await db
    .select()
    .from(deletedProjects)
    .where(status ? eq(deletedProjects.finalStatus, status) : undefined);
  for (const t of tombstones) {
    if (year && !t.mailDate.startsWith(`${year}-`)) continue;
    const row = [
      t.id,
      t.candidateSupported,
      t.office,
      "",
      "",
      "",
      (t.totalCostCents / 100).toFixed(2),
      t.mailDate,
      t.finalStatus,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ];
    for (let i = 0; i < VENDOR_ROLE_VALUES.length; i++) {
      row.push("", "", "", "", "");
    }
    row.push("", "true");
    rows.push(row);
  }

  const filename = `kdp-mail-export-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(buildCsv(header, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
