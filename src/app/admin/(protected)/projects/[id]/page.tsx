import { notFound } from "next/navigation";
import { getAdminProjectView } from "@/lib/admin-ops";
import { getSessionAdmin } from "@/lib/auth";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { presignGet } from "@/lib/r2";
import {
  DISTRICT_DETAIL_LABEL,
  officeLabel,
  vendorRoleLabel,
  type Office,
  type VendorRole,
} from "@/lib/schemas/project";
import {
  isReviewStage,
  STATUS_LABELS,
  type ProjectStatus,
} from "@/lib/state-machine";
import type { UploadKind } from "@/lib/uploads";
import { suggestedContactsFor } from "@/lib/campaign-contacts";
import { allReviewerContacts } from "@/lib/reviewer-contacts";
import {
  CampaignContactCard,
  CampaignReviewEmailButton,
  DeleteProjectButton,
  OverrideWaitButton,
  PaidCheckbox,
  RegenerateLinkButton,
  ReopenButton,
  ReviewerNoticeButtons,
  ReviewPanel,
} from "./actions";
import { VersionCompare, type ArtworkSet } from "./version-compare";

export const metadata = { title: "Project - KDP Mail Approval" };
export const dynamic = "force-dynamic";

function artworkLabel(kind: UploadKind): string {
  switch (kind) {
    case "artwork_front":
      return "Front";
    case "artwork_back":
      return "Back";
    case "artwork_combined":
      return "Front/Back combined";
    default:
      return kind;
  }
}

const KIND_ORDER: Record<string, number> = {
  artwork_front: 0,
  artwork_back: 1,
  artwork_combined: 2,
};

async function buildArtworkSet(version: {
  versionNumber: number;
  files: Array<{
    id: string;
    kind: string;
    r2Key: string;
    originalFilename: string;
  }>;
}): Promise<ArtworkSet> {
  const artwork = version.files
    .filter((f) => f.kind !== "invoice")
    .sort((a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9));
  return {
    versionNumber: version.versionNumber,
    images: await Promise.all(
      artwork.map(async (f) => ({
        id: f.id,
        label: artworkLabel(f.kind as UploadKind),
        url: await presignGet(f.r2Key),
        filename: f.originalFilename,
      })),
    ),
  };
}

export default async function AdminProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const session = (await getSessionAdmin())!;
  const view = await getAdminProjectView(id);
  if (!view) notFound();
  const { project, contacts, versions, reviews, events } = view;

  const status = project.status as ProjectStatus;
  const currentVersion = versions.find((v) => v.id === project.currentVersionId);
  const previousVersion = currentVersion
    ? (versions.find((v) => v.versionNumber === currentVersion.versionNumber - 1) ?? null)
    : null;

  const currentSet = currentVersion ? await buildArtworkSet(currentVersion) : null;
  const previousSet = previousVersion ? await buildArtworkSet(previousVersion) : null;
  const currentInvoice = currentVersion?.files.find((f) => f.kind === "invoice");
  const invoiceUrl = currentInvoice ? await presignGet(currentInvoice.r2Key) : null;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {project.candidateSupported}
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            {officeLabel(project.office as Office)}
            {project.districtDetail ? ` · ${project.districtDetail}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-800">
            {STATUS_LABELS[status]}
          </span>
          <RegenerateLinkButton projectId={project.id} />
          {session.admin.isSuperuser &&
            (status === "approved" || status === "denied") && (
              <ReopenButton projectId={project.id} />
            )}
          <DeleteProjectButton
            projectId={project.id}
            candidateName={project.candidateSupported}
          />
        </div>
      </div>

      {/* Facts grid */}
      <section className="grid gap-x-8 gap-y-3 rounded-lg border border-gray-200 bg-white p-5 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <Fact label="Mail date" value={formatDate(project.mailDate)} />
        <Fact label="Pieces" value={project.pieceCount.toLocaleString()} />
        <Fact label="Total cost" value={formatMoney(project.totalCostCents)} />
        <Fact label="Post office" value={project.postOfficeLocation} />
        <Fact label="Permit number" value={project.permitNumber} />
        <Fact
          label={DISTRICT_DETAIL_LABEL}
          value={project.districtDetail ?? "-"}
        />
        <Fact label="Submitted" value={formatDateTime(project.createdAt)} />
        <Fact
          label="Status since"
          value={formatDateTime(project.statusChangedAt)}
        />
        <Fact
          label="Link rotated"
          value={
            project.tokenRotatedAt ? formatDateTime(project.tokenRotatedAt) : "Never"
          }
        />
        <div className="sm:col-span-2 lg:col-span-3">
          <p className="text-xs uppercase text-gray-500">Description</p>
          <p className="mt-0.5 whitespace-pre-line text-gray-900">
            {project.description}
          </p>
        </div>
      </section>

      {/* Campaign contact (admin-owned; suggestions from the known roster) */}
      <CampaignContactCard
        projectId={project.id}
        current={{
          name: project.campaignContactName,
          email: project.campaignContactEmail,
          phone: project.campaignContactPhone,
        }}
        suggestions={suggestedContactsFor(project.office, project.districtDetail).map(
          (s) => ({ name: s.name, email: s.email, phone: s.phone, note: s.note }),
        )}
      />

      {/* Step 1 (optional): ask outside reviewers to look. Does not move the
          project — kept visually separate from the decision card below. */}
      {isReviewStage(status) && (
        <section className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-5">
          <h2 className="text-lg font-semibold text-gray-900">
            Ask for outside review
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            Optional. Sending a notice does <strong>not</strong> move the
            project; recording a decision below does.
          </p>
          <div className="mt-4 space-y-5">
            <ReviewerNoticeButtons
              projectId={project.id}
              contacts={buildNoticeContacts(
                status,
                project.campaignContactName,
                project.campaignContactEmail,
              )}
            />
            {status === "campaign_review" &&
              (project.campaignContactEmail ? (
                <div className="border-t border-indigo-200 pt-5">
                  <p className="text-sm font-medium text-gray-900">
                    Campaign sign-off request
                  </p>
                  <p className="mb-3 mt-0.5 text-xs text-gray-600">
                    The formal &quot;KDP is investing in your race&quot; email
                    to the campaign contact, with the scheduled mail date and
                    the status link.
                  </p>
                  <CampaignReviewEmailButton
                    projectId={project.id}
                    contactName={
                      project.campaignContactName || "the campaign contact"
                    }
                    contactEmail={project.campaignContactEmail}
                  />
                </div>
              ) : (
                <p className="border-t border-indigo-200 pt-5 text-sm text-amber-800">
                  Set a campaign contact above to send the campaign sign-off
                  request.
                </p>
              ))}
          </div>
        </section>
      )}

      {/* Step 2: the decision — this is what moves the project. */}
      {isReviewStage(status) && (
        <section className="rounded-lg border border-blue-300 bg-blue-50/40 p-5">
          <h2 className="text-lg font-semibold text-gray-900">
            Record your decision: {STATUS_LABELS[status]}
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            This moves the project. Advance passes{" "}
            {STATUS_LABELS[status].toLowerCase()}; Request changes and Deny
            email your notes to the vendor.
          </p>
          <div className="mt-4">
            <ReviewPanel projectId={project.id} stage={status} />
          </div>
        </section>
      )}
      {status === "changes_requested" && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          <p>
            Waiting on the vendor: changes were requested from{" "}
            <strong>
              {STATUS_LABELS[project.changesRequestedFrom as ProjectStatus]}
            </strong>
            . The project resumes when they resubmit through their link.
          </p>
          <div className="mt-3">
            <OverrideWaitButton
              projectId={project.id}
              stageLabel={
                STATUS_LABELS[project.changesRequestedFrom as ProjectStatus] ??
                "the previous stage"
              }
            />
          </div>
        </section>
      )}

      {/* Artwork with version compare */}
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            Artwork (version {currentVersion?.versionNumber ?? "-"})
          </h2>
          {invoiceUrl && (
            <a
              href={invoiceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-blue-700 underline"
            >
              View invoice ({currentInvoice!.originalFilename})
            </a>
          )}
        </div>
        {currentSet ? (
          <VersionCompare current={currentSet} previous={previousSet} />
        ) : (
          <p className="text-gray-600">No versions yet.</p>
        )}
      </section>

      {/* Contacts & payment */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-gray-900">
          Vendors &amp; payment
        </h2>
        <div className="space-y-2">
          {contacts.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-gray-200 bg-white p-4 text-sm"
            >
              <div>
                <p className="font-medium text-gray-900">
                  {c.orgName}{" "}
                  <span className="font-normal text-gray-500">
                    ({vendorRoleLabel(c.role as VendorRole)})
                  </span>
                  {c.isPrimary && (
                    <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800">
                      gets status emails
                    </span>
                  )}
                </p>
                <p className="text-gray-600">
                  {c.contactName} · {c.email}
                  {c.phone ? ` · ${c.phone}` : ""}
                </p>
              </div>
              {c.paidByKdp ? (
                <div className="text-right">
                  <PaidCheckbox
                    projectId={project.id}
                    contactId={c.id}
                    paid={c.paidAt !== null}
                  />
                  {c.paidAt && (
                    <p className="mt-1 text-xs text-gray-500">
                      {formatDateTime(c.paidAt)}
                    </p>
                  )}
                </div>
              ) : (
                <span className="text-xs text-gray-400">
                  No KDP payment expected
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Version history */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-gray-900">
          Version history
        </h2>
        <ul className="space-y-2 text-sm">
          {versions.map((v) => (
            <li key={v.id} className="rounded-md border border-gray-200 bg-white p-3">
              <p className="font-medium text-gray-900">
                Version {v.versionNumber}
                {v.id === project.currentVersionId && (
                  <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800">
                    current
                  </span>
                )}
                <span className="ml-2 font-normal text-gray-500">
                  {formatDateTime(v.submittedAt)}
                </span>
              </p>
              <p className="mt-1 text-gray-600">
                {v.files
                  .sort((a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9))
                  .map(
                    (f) =>
                      `${f.kind === "invoice" ? "Invoice" : artworkLabel(f.kind as UploadKind)}: ${f.originalFilename}`,
                  )
                  .join(" · ")}
              </p>
              {v.vendorNote && (
                <p className="mt-1 whitespace-pre-line text-gray-700">
                  <span className="font-medium">Vendor note:</span> {v.vendorNote}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* Reviews */}
      {reviews.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-gray-900">
            Review decisions
          </h2>
          <ul className="space-y-2 text-sm">
            {reviews.map((r) => (
              <li key={r.id} className="rounded-md border border-gray-200 bg-white p-3">
                <p className="font-medium text-gray-900">
                  {STATUS_LABELS[r.stage as ProjectStatus]}:{" "}
                  {r.decision === "advanced"
                    ? "Advanced"
                    : r.decision === "changes_requested"
                      ? "Changes requested"
                      : "Denied"}
                  <span className="ml-2 font-normal text-gray-500">
                    by {r.reviewerName ?? "unknown"} · {formatDateTime(r.decidedAt)}
                  </span>
                </p>
                {r.notes && (
                  <p className="mt-1 whitespace-pre-line text-gray-700">{r.notes}</p>
                )}
                <ChecklistSummary checklist={r.checklist as Record<string, boolean>} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Event timeline */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-gray-900">
          Event timeline
        </h2>
        <ul className="space-y-1 text-sm">
          {events.map((e) => (
            <li key={e.id} className="flex gap-3 border-b border-gray-100 py-1.5">
              <span className="w-40 shrink-0 text-gray-500">
                {formatDateTime(e.createdAt)}
              </span>
              <span className="font-mono text-xs text-gray-500 pt-0.5 w-36 shrink-0">
                {e.eventType}
              </span>
              <span className="text-gray-700">
                {describeEvent(e.eventType, e.payload as Record<string, unknown>, e.actorName)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** All configured reviewers plus this ticket's campaign contact, deduped;
 * the current stage's reviewers are the pre-checked defaults. */
function buildNoticeContacts(
  status: ProjectStatus,
  campaignContactName: string,
  campaignContactEmail: string,
) {
  const options = allReviewerContacts().map((c) => ({
    name: c.name,
    email: c.email,
    note: c.note,
    tags: c.stages.map((s) => STATUS_LABELS[s]),
    defaultChecked: (c.stages as string[]).includes(status),
  }));
  if (
    campaignContactEmail &&
    !options.some(
      (o) => o.email.toLowerCase() === campaignContactEmail.toLowerCase(),
    )
  ) {
    options.push({
      name: campaignContactName || "Campaign contact",
      email: campaignContactEmail,
      note: "Campaign contact",
      tags: [],
      defaultChecked: false,
    });
  }
  return options;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase text-gray-500">{label}</p>
      <p className="mt-0.5 text-gray-900">{value}</p>
    </div>
  );
}

function ChecklistSummary({ checklist }: { checklist: Record<string, boolean> }) {
  const entries = Object.entries(checklist);
  if (entries.length === 0) return null;
  return (
    <p className="mt-1 text-xs text-gray-500">
      Checklist:{" "}
      {entries.map(([k, v]) => `${v ? "☑" : "☐"} ${k.replaceAll("_", " ")}`).join("  ")}
    </p>
  );
}

function describeEvent(
  type: string,
  payload: Record<string, unknown>,
  actorName: string | null,
): string {
  const who = actorName ? ` by ${actorName}` : "";
  switch (type) {
    case "project.created":
      return "Submission received";
    case "status.changed":
      return `Status: ${String(payload.from ?? "?")} → ${String(payload.to ?? "?")}${who}`;
    case "version.submitted":
      return `Version ${String(payload.versionNumber ?? "?")} submitted`;
    case "review.decided":
      return `${String(payload.stage ?? "?")}: ${String(payload.decision ?? "?")}${who}`;
    case "file.uploaded":
      return `File uploaded (${String(payload.kind ?? "?")})`;
    case "email.sent":
      return `Email sent: ${String(payload.template ?? "?")} → ${Array.isArray(payload.recipients) ? (payload.recipients as string[]).join(", ") : "?"}`;
    case "email.failed":
      return `EMAIL FAILED: ${String(payload.template ?? "?")}`;
    case "email.skipped":
      return `Vendor email suppressed${who} (${String(payload.stage ?? "?")}: ${String(payload.decision ?? "?")})`;
    case "token.rotated":
      return `Vendor link regenerated${who}`;
    case "contact.paid":
      return `Marked paid: ${String(payload.org ?? payload.role ?? "?")}${who}`;
    case "contact.unpaid":
      return `Marked unpaid: ${String(payload.org ?? payload.role ?? "?")}${who}`;
    case "project.reopened":
      return `Reopened${who}: ${String(payload.reason ?? "")}`;
    case "campaign_contact.updated":
      return `Campaign contact set to ${String(payload.name ?? "?")} (${String(payload.email ?? "?")})${who}`;
    case "changes_request.overridden":
      return `Wait overridden${who}: review resumed at ${String(payload.resumedStage ?? "?")}`;
    default:
      return type;
  }
}
