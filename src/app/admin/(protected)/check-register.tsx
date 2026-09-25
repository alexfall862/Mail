/**
 * "Payments by check" register on the admin dashboard: every recorded vendor
 * payment grouped by the KDP check that covered it, so a check stub can be
 * reconciled against the projects it paid for. Server-rendered from the
 * dashboard rows already loaded; see src/lib/payments.ts for the grouping.
 */
import Link from "next/link";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { CheckRegisterEntry } from "@/lib/payments";
import { vendorRoleLabel, type VendorRole } from "@/lib/schemas/project";

export function CheckRegister({ entries }: { entries: CheckRegisterEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="mt-3 text-sm text-gray-500">
        No payments recorded yet. Expand an approved project above to mark a
        vendor paid and enter the check number.
      </p>
    );
  }

  const grandTotal = entries.reduce((n, e) => n + (e.amountCents ?? 0), 0);
  const anyMissing = entries.some((e) => e.missingAmounts > 0);

  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-500">
          <tr>
            <th className="px-4 py-3">Check #</th>
            <th className="px-4 py-3">Recorded</th>
            <th className="px-4 py-3">Paid to</th>
            <th className="px-4 py-3">Projects</th>
            <th className="px-4 py-3 text-right">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {entries.map((entry) => (
            <tr
              key={entry.checkNumber ?? "__none"}
              className={entry.checkNumber === null ? "bg-amber-50/50" : "hover:bg-gray-50"}
            >
              <td className="px-4 py-3 align-top font-mono">
                {entry.checkNumber !== null ? (
                  `#${entry.checkNumber}`
                ) : (
                  <span className="font-sans text-amber-800">No check # recorded</span>
                )}
              </td>
              <td className="px-4 py-3 align-top whitespace-nowrap text-gray-600">
                {formatDateTime(new Date(entry.firstPaidAt))}
              </td>
              <td className="px-4 py-3 align-top">
                <ul className="space-y-0.5">
                  {entry.payments.map((p) => (
                    <li key={p.contactId} className="text-gray-800">
                      {p.orgName}{" "}
                      <span className="text-xs text-gray-500">
                        ({vendorRoleLabel(p.role as VendorRole)})
                      </span>
                    </li>
                  ))}
                </ul>
              </td>
              <td className="px-4 py-3 align-top">
                <ul className="space-y-0.5">
                  {entry.payments.map((p) => (
                    <li key={p.contactId}>
                      <Link
                        href={`/admin/projects/${p.projectId}`}
                        className="text-blue-700 hover:underline"
                      >
                        {p.candidateSupported}
                      </Link>
                      {p.projectStatus !== "approved" && (
                        <span className="ml-1 text-xs text-gray-500">
                          ({p.projectStatus.replaceAll("_", " ")})
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </td>
              <td className="px-4 py-3 align-top text-right whitespace-nowrap">
                <ul className="space-y-0.5">
                  {entry.payments.map((p) => (
                    <li key={p.contactId} className="text-gray-700">
                      {p.amountCents !== null ? (
                        formatMoney(p.amountCents)
                      ) : (
                        <span className="text-xs text-gray-400" title="No amount recorded for this payment">
                          —
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                {entry.payments.length > 1 && (
                  <p className="mt-1 border-t border-gray-200 pt-1 font-medium text-gray-900">
                    {entry.amountCents !== null ? formatMoney(entry.amountCents) : "—"}
                    {entry.missingAmounts > 0 && entry.amountCents !== null && (
                      <span className="ml-1 text-xs font-normal text-amber-700">
                        +{entry.missingAmounts} w/o amount
                      </span>
                    )}
                  </p>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-gray-200 bg-gray-50 text-sm">
          <tr>
            <td colSpan={4} className="px-4 py-3 text-gray-600">
              {entries.filter((e) => e.checkNumber !== null).length} check
              {entries.filter((e) => e.checkNumber !== null).length === 1 ? "" : "s"} ·{" "}
              {entries.reduce((n, e) => n + e.payments.length, 0)} vendor payment
              {entries.reduce((n, e) => n + e.payments.length, 0) === 1 ? "" : "s"}
              {anyMissing && (
                <span className="ml-2 text-xs text-amber-700">
                  Total excludes payments with no amount recorded.
                </span>
              )}
            </td>
            <td className="px-4 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">
              {formatMoney(grandTotal)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
