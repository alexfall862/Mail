/**
 * Reviewer feedback page (/r/{token}, post-spec amendment 2026-08-17): a
 * per-recipient read-only view of the current piece plus a feedback form.
 * Unlike the vendor page there is no resubmission, no vendor quote, and no
 * payment info. The link works only while the project sits at the stage the
 * invite was issued for; afterwards the page shows a closed notice (plus
 * whatever the reviewer recorded).
 */
import { headers } from "next/headers";
import { ArtworkImage } from "@/components/lightbox";
import { formatDate, formatDateTime } from "@/lib/format";
import { rateLimit } from "@/lib/rate-limit";
import { presignGet } from "@/lib/r2";
import { getReviewInviteView } from "@/lib/review-invites";
import { officeLabel, type Office } from "@/lib/schemas/project";
import { STATUS_LABELS, type ProjectStatus } from "@/lib/state-machine";
import type { UploadKind } from "@/lib/uploads";
import { ReviewForm } from "./review-form";

export const metadata = {
  title: "Review a mail piece - KDP Mail Approval",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-3xl px-6 py-10">{children}</main>;
}

const KIND_ORDER: Record<string, number> = {
  artwork_front: 0,
  artwork_back: 1,
  artwork_combined: 2,
};

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

export default async function ReviewInvitePage({
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

  const view = await getReviewInviteView(token);
  if (!view) {
    return (
      <Shell>
        <h1 className="text-xl font-bold text-gray-900">
          This link isn&apos;t valid
        </h1>
        <p className="mt-2 text-gray-600">
          The review link you used doesn&apos;t match any open review. If the
          mail program team re-sent the request, only the newest emailed link
          works — check your inbox for the most recent message, or reply to it
          if you can&apos;t find the link.
        </p>
      </Shell>
    );
  }

  const { invite, project, open, currentVersion, response } = view;
  const status = project.status as ProjectStatus;
  const isCampaignSignoff =
    invite.role === "campaign_contact" && invite.stage === "campaign_review";

  const artworkFiles = (currentVersion?.files ?? [])
    .filter((f) => f.kind !== "invoice")
    .sort((a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9));
  const artworkUrls = open
    ? await Promise.all(
        artworkFiles.map(async (f) => ({
          file: f,
          url: await presignGet(f.r2Key), // 10-minute expiry (§3)
        })),
      )
    : [];

  return (
    <Shell>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-blue-700">
            {isCampaignSignoff
              ? "Campaign review & sign-off"
              : `${STATUS_LABELS[invite.stage as ProjectStatus]} feedback`}
          </p>
          <h1 className="mt-1 text-2xl font-bold text-gray-900">
            {project.candidateSupported}
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            {officeLabel(project.office as Office)}
            {project.districtDetail ? ` · ${project.districtDetail}` : ""} ·{" "}
            {project.pieceCount.toLocaleString()} pieces
          </p>
          <p className="mt-1 text-sm text-gray-600">
            Scheduled mail date: <strong>{formatDate(project.mailDate)}</strong>
          </p>
        </div>
        <span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-800">
          {STATUS_LABELS[status]}
        </span>
      </div>

      {invite.recipientName && (
        <p className="mt-4 text-sm text-gray-600">
          This is the private review page for{" "}
          <strong>{invite.recipientName}</strong> ({invite.recipientEmail}).
          Feedback you record here is logged under your name.
        </p>
      )}

      {!open ? (
        <section className="mt-8 rounded-lg border border-gray-300 bg-gray-50 p-5">
          <h2 className="text-lg font-semibold text-gray-900">
            This review window has closed
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            The project has moved on since this link was sent (it&apos;s now at{" "}
            {STATUS_LABELS[status].toLowerCase()}), so feedback can no longer be
            recorded here. If you still need to reach the mail program team,
            reply to the email that brought you here.
          </p>
          {response && (
            <div className="mt-4 rounded-md border border-gray-200 bg-white p-4 text-sm">
              <p className="font-medium text-gray-900">
                Your recorded feedback (
                {formatDateTime(response.createdAt)}):{" "}
                {response.decision === "approved" ? "Approved" : "Flagged an issue"}
              </p>
              {response.notes && (
                <p className="mt-1 whitespace-pre-line text-gray-700">
                  {response.notes}
                </p>
              )}
            </div>
          )}
        </section>
      ) : (
        <>
          <section className="mt-8">
            <h2 className="mb-3 text-lg font-semibold text-gray-900">
              The mail piece (version {currentVersion?.versionNumber ?? "-"})
            </h2>
            <p className="mb-4 whitespace-pre-line text-sm text-gray-700">
              {project.description}
            </p>
            {artworkUrls.length === 0 ? (
              <p className="text-gray-600">No artwork on file.</p>
            ) : (
              <div
                className={
                  artworkUrls.length === 2
                    ? "grid gap-4 sm:grid-cols-2"
                    : "grid gap-4"
                }
              >
                {artworkUrls.map(({ file, url }) => (
                  <figure key={file.id}>
                    <ArtworkImage
                      src={url}
                      alt={artworkLabel(file.kind as UploadKind)}
                    />
                    <figcaption className="mt-1 text-sm text-gray-600">
                      {artworkLabel(file.kind as UploadKind)}
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </section>

          <section className="mt-8 rounded-lg border border-blue-200 bg-blue-50/40 p-5">
            <h2 className="text-lg font-semibold text-gray-900">
              {isCampaignSignoff ? "Your sign-off" : "Your feedback"}
            </h2>
            <p className="mb-4 mt-1 text-sm text-gray-600">
              {isCampaignSignoff
                ? "Approving records your campaign's sign-off and moves the piece to the next review step. Flagging an issue notifies the mail program team instead."
                : "Your feedback goes straight to the mail program team; it doesn't move the project by itself."}
            </p>
            {response && (
              <p className="mb-4 rounded-md border border-blue-200 bg-white p-3 text-sm text-gray-700">
                You already responded on {formatDateTime(response.createdAt)} (
                {response.decision === "approved" ? "approved" : "flagged an issue"}
                ). Submitting again replaces that response.
              </p>
            )}
            <ReviewForm
              token={token}
              isCampaignSignoff={isCampaignSignoff}
              initial={
                response
                  ? {
                      decision: response.decision as "approved" | "issues",
                      notes: response.notes ?? "",
                    }
                  : null
              }
            />
          </section>
        </>
      )}

      <footer className="mt-10 border-t border-gray-200 pt-4 text-sm text-gray-500">
        This private link was sent to you by the KDP Mail Program. Please
        don&apos;t forward it — feedback recorded here is logged under your
        name.
      </footer>
    </Shell>
  );
}
