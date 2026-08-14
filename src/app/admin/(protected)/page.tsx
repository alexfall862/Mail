import Link from "next/link";
import { getDashboardRows } from "@/lib/admin-ops";
import { formatDate, formatMoney } from "@/lib/format";
import { officeLabel, type Office } from "@/lib/schemas/project";
import {
  PROJECT_STATUSES,
  STATUS_LABELS,
  type ProjectStatus,
} from "@/lib/state-machine";

export const metadata = { title: "Dashboard — KDP Mail Approval" };
export const dynamic = "force-dynamic";

const TERMINAL: ProjectStatus[] = ["approved", "denied"];

/** §8: red flag on any non-terminal project with mail_date ≤ 10 days out. */
function isUrgent(status: ProjectStatus, mailDate: string): boolean {
  if (TERMINAL.includes(status)) return false;
  const [y, m, d] = mailDate.split("-").map(Number);
  const due = new Date(y!, m! - 1, d!);
  const days = (due.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
  return days <= 10;
}

const STATUS_BADGE: Record<ProjectStatus, string> = {
  submitted: "bg-gray-100 text-gray-800",
  content_review: "bg-blue-100 text-blue-800",
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
  const rows = await getDashboardRows(statusFilter);

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
                When a vendor submits a mail piece it appears here, sorted by
                mail date.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">Candidate</th>
                <th className="px-4 py-3">Office</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Mail date</th>
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
                    {isUrgent(row.status, row.mailDate) && (
                      <span
                        className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-red-600 align-middle"
                        title="Mail date is 10 days out or less"
                      />
                    )}
                    {formatDate(row.mailDate)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.pieceCount.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatMoney(row.totalCostCents)}
                  </td>
                  <td className="px-4 py-3">
                    {row.paidNeeded === 0 ? (
                      <span className="text-gray-400">—</span>
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
      )}
    </div>
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
