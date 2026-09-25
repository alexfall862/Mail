import Link from "next/link";
import { getDashboardRows, type DashboardRow } from "@/lib/admin-ops";
import { formatDate, formatMoney } from "@/lib/format";
import {
  buildCheckRegister,
  summarizePayments,
  type CheckRegisterEntry,
  type PaymentSummary,
} from "@/lib/payments";
import { daysUntil, scheduleSlack, urgencyTier } from "@/lib/priority";
import { ApprovedPaymentsTable } from "./approved-payments-table";
import { CheckRegister } from "./check-register";
import { officeLabel, type Office } from "@/lib/schemas/project";
import {
  PROJECT_STATUSES,
  STATUS_LABELS,
  type ProjectStatus,
} from "@/lib/state-machine";

export const metadata = { title: "Dashboard - KDP Mail Approval" };
export const dynamic = "force-dynamic";

const TERMINAL: ProjectStatus[] = ["approved", "denied"];

const STATUS_BADGE: Record<ProjectStatus, string> = {
  submitted: "bg-gray-100 text-gray-800",
  content_review: "bg-blue-100 text-blue-800",
  campaign_review: "bg-cyan-100 text-cyan-800",
  legal_review: "bg-indigo-100 text-indigo-800",
  final_review: "bg-purple-100 text-purple-800",
  changes_requested: "bg-amber-100 text-amber-800",
  approved: "bg-green-100 text-green-800",
  denied: "bg-red-100 text-red-800",
};

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const statusFilter = (PROJECT_STATUSES as readonly string[]).includes(
    status ?? "",
  )
    ? (status as ProjectStatus)
    : undefined;
  // Load everything once: the status filter is applied in memory (~100 rows a
  // year) so the check register can always cover every recorded payment,
  // whichever filter is active.
  const allRows = await getDashboardRows();
  const rows = statusFilter
    ? allRows.filter((r) => r.status === statusFilter)
    : allRows;
  const checkRegister = buildCheckRegister(allRows);
  const paymentSummary = summarizePayments(allRows);

  // Active work ranked by schedule slack (least room first); approved and
  // denied kept out of the way in their own tables.
  const now = new Date();
  const bySlack = (a: DashboardRow, b: DashboardRow) =>
    scheduleSlack(a.status, a.changesRequestedFrom, a.mailDate, now) -
      scheduleSlack(b.status, b.changesRequestedFrom, b.mailDate, now) ||
    a.mailDate.localeCompare(b.mailDate);
  const active = rows
    .filter((r) => !TERMINAL.includes(r.status))
    .sort(bySlack);
  const approved = rows.filter((r) => r.status === "approved");
  const denied = rows.filter((r) => r.status === "denied");

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <nav className="flex flex-wrap gap-1 text-sm">
          <FilterLink label="All" href="/admin" active={!statusFilter} />
          {PROJECT_STATUSES.filter((s) => s !== "submitted").map((s) => (
            <FilterLink
              key={s}
              label={STATUS_LABELS[s]}
              href={`/admin?status=${s}`}
              active={statusFilter === s}
            />
          ))}
        </nav>
      </div>

      {rows.length === 0 ? (
        <div className="mt-16 text-center text-gray-500">
          {statusFilter ? (
            <p>No projects with status “{STATUS_LABELS[statusFilter]}”.</p>
          ) : (
            <>
              <p className="text-lg font-medium text-gray-700">
                No submissions yet
              </p>
              <p className="mt-2">
                When a vendor submits a mail piece it appears here, most
                urgent first.
              </p>
            </>
          )}
        </div>
      ) : statusFilter === "approved" ? (
        <>
          <ApprovedPaymentsTable rows={rows} />
          <PaymentsSection
            summary={paymentSummary}
            entries={checkRegister}
          />
        </>
      ) : statusFilter ? (
        <ProjectTable
          rows={TERMINAL.includes(statusFilter) ? rows : active}
          showUrgency={!TERMINAL.includes(statusFilter)}
          now={now}
        />
      ) : (
        <>
          <SectionHeading
            title="In review"
            count={active.length}
            hint="ranked by how tight the schedule is: days until the mail date vs. review stages left"
          />
          {active.length === 0 ? (
            <p className="mt-3 text-sm text-gray-500">
              Nothing in review right now.
            </p>
          ) : (
            <ProjectTable rows={active} showUrgency now={now} />
          )}

          {approved.length > 0 && (
            <>
              <SectionHeading
                title="Approved"
                count={approved.length}
                hint={approvedHint(paymentSummary)}
              />
              <ApprovedPaymentsTable rows={approved} />
            </>
          )}

          {(approved.length > 0 || checkRegister.length > 0) && (
            <PaymentsSection
              summary={paymentSummary}
              entries={checkRegister}
            />
          )}

          {denied.length > 0 && (
            <>
              <SectionHeading title="Denied" count={denied.length} />
              <ProjectTable rows={denied} showUrgency={false} now={now} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function SectionHeading({
  title,
  count,
  hint,
}: {
  title: string;
  count: number;
  hint?: string;
}) {
  return (
    <div className="mt-8 flex flex-wrap items-baseline gap-2">
      <h2 className="text-lg font-semibold text-gray-900">
        {title} <span className="font-normal text-gray-500">({count})</span>
      </h2>
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

/** One-line payment status for the Approved heading. */
function approvedHint(s: PaymentSummary): string | undefined {
  if (s.approvedBillable === 0) return undefined;
  const parts = [`${s.approvedFullyPaid}/${s.approvedBillable} fully paid`];
  if (s.vendorsAwaiting > 0) {
    parts.push(
      `${s.vendorsAwaiting} vendor payment${s.vendorsAwaiting === 1 ? "" : "s"} outstanding`,
    );
  }
  parts.push("click a paid badge to record a check");
  return parts.join(" · ");
}

/** Check register with its heading; shown under the approved table. */
function PaymentsSection({
  summary,
  entries,
}: {
  summary: PaymentSummary;
  entries: CheckRegisterEntry[];
}) {
  const hintParts: string[] = [];
  if (summary.checksRecorded > 0) {
    hintParts.push(
      `${summary.checksRecorded} check${summary.checksRecorded === 1 ? "" : "s"} recorded`,
    );
  }
  if (summary.paidWithoutCheck > 0) {
    hintParts.push(
      `${summary.paidWithoutCheck} payment${summary.paidWithoutCheck === 1 ? "" : "s"} missing a check #`,
    );
  }
  return (
    <>
      <SectionHeading
        title="Payments by check"
        count={entries.length}
        hint={hintParts.length > 0 ? hintParts.join(" · ") : undefined}
      />
      <CheckRegister entries={entries} />
    </>
  );
}

function ProjectTable({
  rows,
  showUrgency,
  now,
}: {
  rows: DashboardRow[];
  showUrgency: boolean;
  now: Date;
}) {
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-500">
          <tr>
            <th className="px-4 py-3">Candidate</th>
            <th className="px-4 py-3">Office</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Mail date</th>
            {showUrgency && <th className="px-4 py-3">Days left</th>}
            <th className="px-4 py-3 text-right">Pieces</th>
            <th className="px-4 py-3 text-right">Cost</th>
            <th className="px-4 py-3">Paid</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 font-medium">
                <Link
                  href={`/admin/projects/${row.id}`}
                  className="text-blue-700 hover:underline"
                >
                  {row.candidateSupported}
                </Link>
              </td>
              <td className="px-4 py-3 text-gray-600">
                {officeLabel(row.office as Office)}
              </td>
              <td className="px-4 py-3">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[row.status]}`}
                >
                  {STATUS_LABELS[row.status]}
                </span>
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                {formatDate(row.mailDate)}
              </td>
              {showUrgency && (
                <td className="px-4 py-3 whitespace-nowrap">
                  <DaysLeftChip row={row} now={now} />
                </td>
              )}
              <td className="px-4 py-3 text-right">
                {row.pieceCount.toLocaleString()}
              </td>
              <td className="px-4 py-3 text-right">
                {formatMoney(row.totalCostCents)}
              </td>
              <td className="px-4 py-3">
                {row.paidNeeded === 0 ? (
                  <span className="text-gray-400">-</span>
                ) : (
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      row.paidDone === row.paidNeeded
                        ? "bg-green-100 text-green-800"
                        : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {row.paidDone}/{row.paidNeeded} paid
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Days until mail, colored by whether the remaining stages still fit. */
function DaysLeftChip({ row, now }: { row: DashboardRow; now: Date }) {
  const daysLeft = daysUntil(row.mailDate, now);
  const slack = scheduleSlack(
    row.status,
    row.changesRequestedFrom,
    row.mailDate,
    now,
  );
  const tier = urgencyTier(daysLeft, slack);
  const style =
    tier === "red"
      ? "bg-red-100 text-red-800"
      : tier === "amber"
        ? "bg-amber-100 text-amber-800"
        : "bg-gray-100 text-gray-600";
  const label = daysLeft < 0 ? `${-daysLeft}d overdue` : `${daysLeft}d`;
  const title =
    slack < 0
      ? "The remaining review stages no longer fit before the mail date"
      : `About ${slack} day${slack === 1 ? "" : "s"} of slack after the remaining review stages`;
  return (
    <span
      title={title}
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${style}`}
    >
      {label}
    </span>
  );
}

function FilterLink({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1 ${
        active
          ? "bg-blue-700 text-white"
          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
      }`}
    >
      {label}
    </Link>
  );
}
