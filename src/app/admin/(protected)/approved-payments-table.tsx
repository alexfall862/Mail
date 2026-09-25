"use client";

/**
 * Approved-projects table on the admin dashboard. Same columns as the other
 * dashboard tables, but each row with KDP-payable vendors expands (click the
 * paid badge) into a per-vendor payment panel where the check number and
 * amount are recorded — so approved work can be marked paid without opening
 * every project. Rows with something still owed start expanded when there
 * are only a few, so the outstanding work is visible at a glance.
 */
import Link from "next/link";
import { Fragment, useState } from "react";
import { AmendCostControl } from "@/components/amend-cost";
import { VendorPaymentControl } from "@/components/vendor-payment";
import type { DashboardRow } from "@/lib/admin-ops";
import { formatDate, formatMoney } from "@/lib/format";
import { officeLabel, type Office } from "@/lib/schemas/project";

const AUTO_EXPAND_LIMIT = 5;

export function ApprovedPaymentsTable({ rows }: { rows: DashboardRow[] }) {
  const outstanding = rows.filter((r) => r.paidNeeded > 0 && r.paidDone < r.paidNeeded);
  const [open, setOpen] = useState<Set<string>>(
    () =>
      new Set(
        outstanding.length <= AUTO_EXPAND_LIMIT ? outstanding.map((r) => r.id) : [],
      ),
  );

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allOpen = rows.every((r) => r.paidNeeded === 0 || open.has(r.id));

  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-500">
          <tr>
            <th className="px-4 py-3">Candidate</th>
            <th className="px-4 py-3">Office</th>
            <th className="px-4 py-3">Mail date</th>
            <th className="px-4 py-3 text-right">Pieces</th>
            <th className="px-4 py-3 text-right">Cost</th>
            <th className="px-4 py-3">Checks</th>
            <th className="px-4 py-3">
              <button
                type="button"
                onClick={() =>
                  setOpen(
                    allOpen
                      ? new Set()
                      : new Set(rows.filter((r) => r.paidNeeded > 0).map((r) => r.id)),
                  )
                }
                className="font-medium normal-case text-blue-700 hover:underline"
              >
                {allOpen ? "Collapse all" : "Expand all"}
              </button>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row) => {
            const expandable = row.paidNeeded > 0;
            const isOpen = expandable && open.has(row.id);
            const fullyPaid = row.paidDone === row.paidNeeded;
            const checks = [
              ...new Set(
                row.payments
                  .filter((p) => p.paidAt && p.checkNumber)
                  .map((p) => p.checkNumber!.trim()),
              ),
            ];
            const paidWithoutCheck = row.payments.some((p) => p.paidAt && !p.checkNumber);
            return (
              <Fragment key={row.id}>
                <tr className={isOpen ? "bg-gray-50" : "hover:bg-gray-50"}>
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
                  <td className="px-4 py-3 whitespace-nowrap">{formatDate(row.mailDate)}</td>
                  <td className="px-4 py-3 text-right">{row.pieceCount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">{formatMoney(row.totalCostCents)}</td>
                  <td className="px-4 py-3 text-gray-700">
                    {checks.length > 0 ? (
                      checks.map((c) => (
                        <span
                          key={c}
                          className="mr-1 inline-block rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs"
                        >
                          #{c}
                        </span>
                      ))
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                    {paidWithoutCheck && (
                      <span
                        className="ml-1 text-xs text-amber-700"
                        title="Paid, but no check number recorded"
                      >
                        no check #
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {!expandable ? (
                      <span className="text-gray-400" title="No vendor on this project is paid by KDP">
                        -
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggle(row.id)}
                        aria-expanded={isOpen}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                          fullyPaid
                            ? "bg-green-100 text-green-800 hover:bg-green-200"
                            : "bg-amber-100 text-amber-800 hover:bg-amber-200"
                        }`}
                      >
                        {row.paidDone}/{row.paidNeeded} paid
                        <span aria-hidden className="text-[10px]">
                          {isOpen ? "▲" : "▼"}
                        </span>
                      </button>
                    )}
                  </td>
                </tr>
                {isOpen && (
                  <tr className="bg-gray-50">
                    <td colSpan={7} className="px-4 pb-4 pt-1">
                      <div className="divide-y divide-gray-200 rounded-md border border-gray-200 bg-white">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-gray-50/60 px-3 py-2 text-sm">
                          <span className="text-xs uppercase text-gray-500">Total cost</span>
                          <AmendCostControl
                            projectId={row.id}
                            totalCostCents={row.totalCostCents}
                            size="sm"
                          />
                        </div>
                        {row.payments.map((p) => (
                          <div key={p.contactId} className="px-3 py-2">
                            <VendorPaymentControl
                              projectId={row.id}
                              payment={p}
                              suggestedAmountCents={
                                row.payments.length === 1 ? row.totalCostCents : null
                              }
                            />
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
