"use client";

/**
 * Per-vendor KDP payment control, shared by the admin dashboard (approved
 * rows expand to one of these per payable vendor) and the project detail
 * page. Records or amends a payment with its check number and amount, or
 * clears it. POSTs to the paid route and refreshes the server page so every
 * other view (badge, register, timeline) picks up the change.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DashboardPayment } from "@/lib/admin-ops";
import { formatDateTime, formatMoney } from "@/lib/format";
import { parseDollarsToCents } from "@/lib/payments";
import { CHECK_NUMBER_MAX } from "@/lib/schemas/admin";
import { vendorRoleLabel, type VendorRole } from "@/lib/schemas/project";

const inputCls =
  "rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none";
const btnCls =
  "rounded-md px-3 py-1 text-sm font-medium disabled:opacity-50 whitespace-nowrap";

async function postPaid(
  projectId: string,
  body: {
    contactId: string;
    paid: boolean;
    checkNumber?: string;
    amountCents?: number | null;
  },
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await fetch(`/api/admin/projects/${projectId}/paid`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => ({}))) as { error?: unknown };
    return {
      ok: false,
      message: typeof data.error === "string" ? data.error : "Something went wrong.",
    };
  } catch {
    return { ok: false, message: "Network error. Please try again." };
  }
}

function centsToDollarsInput(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2);
}

export function VendorPaymentControl({
  projectId,
  payment,
  suggestedAmountCents = null,
  showVendor = true,
}: {
  projectId: string;
  payment: DashboardPayment;
  /** Pre-fills the amount field when the vendor is the only KDP-paid vendor
   * on the project (the project total is then the obvious check amount). */
  suggestedAmountCents?: number | null;
  /** Hide the vendor name/role when the surrounding layout already shows it. */
  showVendor?: boolean;
}) {
  const router = useRouter();
  const isPaid = payment.paidAt !== null;
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkNumber, setCheckNumber] = useState(payment.checkNumber ?? "");
  const [amount, setAmount] = useState(
    centsToDollarsInput(payment.amountCents ?? (isPaid ? null : suggestedAmountCents)),
  );

  const showForm = !isPaid || editing;

  async function submit(paid: boolean) {
    setError(null);
    const body: Parameters<typeof postPaid>[1] = { contactId: payment.contactId, paid };
    if (paid) {
      const cents = parseDollarsToCents(amount);
      if (cents === undefined) {
        setError("Enter the amount in dollars, like 1234.50.");
        return;
      }
      body.checkNumber = checkNumber.trim();
      body.amountCents = cents;
    }
    setBusy(true);
    const result = await postPaid(projectId, body);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setEditing(false);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      {showVendor && (
        <span className="min-w-0 text-gray-800">
          <span className="font-medium">{payment.orgName}</span>{" "}
          <span className="text-gray-500">
            ({vendorRoleLabel(payment.role as VendorRole)})
          </span>
        </span>
      )}

      {isPaid && !editing && (
        <>
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
            Paid {formatDateTime(new Date(payment.paidAt!))}
          </span>
          <span className="text-gray-700">
            {payment.checkNumber ? (
              <>Check #{payment.checkNumber}</>
            ) : (
              <span className="text-amber-700">No check # recorded</span>
            )}
            {payment.amountCents !== null && <> · {formatMoney(payment.amountCents)}</>}
          </span>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs text-blue-700 hover:underline"
          >
            {payment.checkNumber ? "Edit" : "Add check #"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Mark ${payment.orgName} as unpaid? The check details will be cleared.`)) {
                void submit(false);
              }
            }}
            className="text-xs text-gray-500 hover:text-red-700 hover:underline disabled:opacity-50"
          >
            Mark unpaid
          </button>
        </>
      )}

      {showForm && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(true);
          }}
        >
          <label className="flex items-center gap-1 text-gray-600">
            <span className="text-xs">Check #</span>
            <input
              type="text"
              value={checkNumber}
              maxLength={CHECK_NUMBER_MAX}
              onChange={(e) => setCheckNumber(e.target.value)}
              placeholder="e.g. 10482"
              className={`${inputCls} w-28`}
              autoComplete="off"
            />
          </label>
          <label className="flex items-center gap-1 text-gray-600">
            <span className="text-xs">Amount</span>
            <span className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-gray-400">
                $
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className={`${inputCls} w-28 pl-5 text-right`}
                autoComplete="off"
              />
            </span>
          </label>
          <button
            type="submit"
            disabled={busy}
            className={`${btnCls} bg-green-700 text-white hover:bg-green-800`}
          >
            {busy ? "Saving…" : isPaid ? "Save" : "Mark paid"}
          </button>
          {editing && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setError(null);
                setCheckNumber(payment.checkNumber ?? "");
                setAmount(centsToDollarsInput(payment.amountCents));
              }}
              className={`${btnCls} border border-gray-300 bg-white text-gray-700 hover:bg-gray-50`}
            >
              Cancel
            </button>
          )}
        </form>
      )}

      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}
