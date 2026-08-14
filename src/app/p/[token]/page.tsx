import { headers } from "next/headers";
import { ArtworkImage } from "@/components/lightbox";
import { ProjectForm } from "@/components/project-form";
import { Timeline } from "@/components/timeline";
import { formatDate, formatDateTime } from "@/lib/format";
import { getVendorProjectView } from "@/lib/projects";
import { rateLimit } from "@/lib/rate-limit";
import { presignGet } from "@/lib/r2";
import {
  officeLabel,
  vendorRoleLabel,
  type Office,
  type VendorRole,
} from "@/lib/schemas/project";
import {
  STATUS_LABELS,
  type ProjectStatus,
  type ReviewStage,
} from "@/lib/state-machine";
import type { UploadKind } from "@/lib/uploads";

export const metadata = {
  title: "Project status - KDP Mail Approval",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-3xl px-6 py-10">{children}</main>;
}

export default async function VendorStatusPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const headerList = await headers();
  const ip =
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limit = rateLimit("tokenLookup", ip); // §13: 30/min per IP
  if (!limit.allowed) {
    return (
      <Shell>
        <h1 className="text-xl font-bold text-gray-900">Please slow down</h1>
        <p className="mt-2 text-gray-600">
          Too many requests from your network. Wait a minute and reload.
        </p>
      </Shell>
    );
  }

  const view = await getVendorProjectView(token);
  if (!view) {
    return (
      <Shell>
        <h1 className="text-xl font-bold text-gray-900">
          This link isn&apos;t valid
        </h1>
        <p className="mt-2 text-gray-600">
          The status link you used doesn&apos;t match any project. If KDP
          regenerated your project&apos;s link, only the newest emailed link
          works. Check your inbox for the most recent message from the KDP
          Mail Program, or reply to it if you can&apos;t find the link.
        </p>
      </Shell>
    );
  }

  const { project, contacts, versions, bounceReview, denialReview } = view;
  const currentVersion = versions.find((v) => v.id === project.currentVersionId);
  const kindOrder: Record<string, number> = {
    artwork_front: 0,
    artwork_back: 1,
    artwork_combined: 2,
  };
  const artworkFiles = (currentVersion?.files ?? [])
    .filter((f) => f.kind !== "invoice")
    .sort((a, b) => (kindOrder[a.kind] ?? 9) - (kindOrder[b.kind] ?? 9));

  const artworkUrls = await Promise.all(
    artworkFiles.map(async (f) => ({
      file: f,
      url: await presignGet(f.r2Key), // 10-minute expiry (§3)
    })),
  );

  const status = project.status as ProjectStatus;
  const notesBlock = (notes: string | null) =>
    notes ? (
      <p className="mt-1 whitespace-pre-line">{notes}</p>
    ) : (
      <p className="mt-1 italic">No notes were provided.</p>
    );

  return (
    <Shell>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {project.candidateSupported}
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            {officeLabel(project.office as Office)}
            {project.districtDetail ? ` · ${project.districtDetail}` : ""} ·{" "}
            {project.pieceCount.toLocaleString()} pieces
          </p>
          <p className="mt-1 text-sm text-gray-600">
            Mail date: <strong>{formatDate(project.mailDate)}</strong>
          </p>
        </div>
        <span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-800">
          {STATUS_LABELS[status]}
        </span>
      </div>

      <section className="mt-8">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">
          Review progress
        </h2>
        <Timeline
          status={status}
          changesRequestedFrom={project.changesRequestedFrom as ProjectStatus | null}
          deniedStage={(denialReview?.stage as ReviewStage | undefined) ?? null}
          alertContent={notesBlock(
            status === "changes_requested"
              ? (bounceReview?.notes ?? null)
              : (denialReview?.notes ?? null),
          )}
        />
      </section>

      {status === "changes_requested" && (
        <section className="mt-4 rounded-lg border border-amber-300 bg-amber-50/50 p-5">
          <h2 className="text-lg font-semibold text-gray-900">
            Send a revision
          </h2>
          <p className="mt-1 mb-6 text-sm text-gray-600">
            The form is pre-filled with your current submission. Change what
            was requested. Any file you don&apos;t replace carries over
            unchanged.
          </p>
          <ProjectForm
            mode="resubmit"
            vendorToken={token}
            initial={{
              project: {
                candidateSupported: project.candidateSupported,
                description: project.description,
                office: project.office as Office,
                districtDetail: project.districtDetail ?? undefined,
                pieceCount: project.pieceCount,
                totalCostCents: project.totalCostCents,
                postOfficeLocation: project.postOfficeLocation,
                permitNumber: project.permitNumber,
                mailDate: project.mailDate,
                campaignContactName: project.campaignContactName,
                campaignContactEmail: project.campaignContactEmail,
                campaignContactPhone: project.campaignContactPhone ?? undefined,
              },
              contacts: contacts.map((c) => ({
                role: c.role as VendorRole,
                orgName: c.orgName,
                contactName: c.contactName,
                email: c.email,
                phone: c.phone ?? undefined,
                paidByKdp: c.paidByKdp,
                isPrimary: c.isPrimary,
              })),
              currentKinds: (currentVersion?.files ?? []).map(
                (f) => f.kind as UploadKind,
              ),
              currentFilenames: Object.fromEntries(
                (currentVersion?.files ?? []).map((f) => [
                  f.kind,
                  f.originalFilename,
                ]),
              ),
            }}
          />
        </section>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold text-gray-900">
          Artwork (version {currentVersion?.versionNumber ?? "-"})
        </h2>
        {artworkUrls.length === 0 ? (
          <p className="text-gray-600">No artwork on file.</p>
        ) : (
          <div
            className={
              artworkUrls.length === 2 ? "grid gap-4 sm:grid-cols-2" : "grid gap-4"
            }
          >
            {artworkUrls.map(({ file, url }) => (
              <figure key={file.id}>
                <ArtworkImage
                  src={url}
                  alt={artworkLabel(file.kind as UploadKind)}
                />
                <figcaption className="mt-1 text-sm text-gray-600">
                  {artworkLabel(file.kind as UploadKind)} - {file.originalFilename}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold text-gray-900">
          Version history
        </h2>
        <ul className="space-y-2">
          {versions.map((v) => (
            <li key={v.id} className="rounded-md border border-gray-200 p-3 text-sm">
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
              {v.vendorNote && (
                <p className="mt-1 whitespace-pre-line text-gray-700">
                  {v.vendorNote}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold text-gray-900">
          Vendors &amp; payment
        </h2>
        <ul className="space-y-2 text-sm">
          {contacts.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-gray-200 p-3"
            >
              <span>
                <span className="font-medium text-gray-900">{c.orgName}</span>{" "}
                <span className="text-gray-500">
                  ({vendorRoleLabel(c.role as VendorRole)})
                </span>
              </span>
              {c.paidByKdp ? (
                c.paidAt ? (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                    Paid {formatDateTime(c.paidAt)}
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                    Payment pending
                  </span>
                )
              ) : (
                <span className="text-xs text-gray-400">
                  No KDP payment expected
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <footer className="mt-10 border-t border-gray-200 pt-4 text-sm text-gray-500">
        Bookmark this page. It&apos;s your private status link for this mail
        piece.
      </footer>
    </Shell>
  );
}

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
