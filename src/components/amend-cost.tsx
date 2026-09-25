"use client";

/**
 * Inline editor for an approved project's total cost, used on the project
 * page and in the dashboard's expanded approved rows. The final invoice often
 * differs from the quote on the submission; this records the new figure with
 * an optional reason (audited as `cost.amended`) without moving the project
 * back through review. Server-side, only approved projects accept it.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatMoney } from "@/lib/format";
import { parseDollarsToCents } from "@/lib/payments";

const inputCls =
  "rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none";
const btnCls =
  "rounded-md px-3 py-1 text-sm font-medium disabled:opacity-50 whitespace-nowrap";

export function AmendCostControl({
  projectId,
  totalCostCents,
  size = "md",
}: {
  projectId: string;
  totalCostCents: number;
  /** "md" shows the amount at the facts-grid size; "sm" fits a table panel. */
  size?: "md" | "sm";
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState((totalCostCents / 100).toFixed(2));
  const [reason, setReason] = useState("");

  function reset() {
    setEditing(false);
    setError(null);
    setAmount((totalCostCents / 100).toFixed(2));
    setReason("");
  }

  async function save() {
    const cents = parseDollarsToCents(amount);
    if (cents === undefined || cents === null) {
      setError("Enter the final cost in dollars, like 1234.50.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/cost`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ totalCostCents: cents, reason: reason.trim() || undefined }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: unknown };
        setError(typeof data.error === "string" ? data.error : "Something went wrong.");
        return;
      }
      setEditing(false);
      setReason("");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <span className="inline-flex flex-wrap items-baseline gap-2">
        <span className={size === "md" ? "text-gray-900" : "text-sm text-gray-800"}>
          {formatMoney(totalCostCents)}
        </span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-xs text-blue-700 hover:underline"
          title="Record the final cost if it differs from the quote. Does not affect review status."
        >
          Amend cost
        </button>
      </span>
    );
  }

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="flex items-center gap-1 text-gray-600">
        <span className="text-xs">Final cost</span>
        <span className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-gray-400">
            $
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={`${inputCls} w-32 pl-5 text-right`}
            autoComplete="off"
            autoFocus
          />
        </span>
      </label>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (optional, e.g. final invoice)"
        maxLength={500}
        className={`${inputCls} w-64`}
      />
      <button
        type="submit"
        disabled={busy}
        className={`${btnCls} bg-blue-700 text-white hover:bg-blue-800`}
      >
        {busy ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={reset}
        className={`${btnCls} border border-gray-300 bg-white text-gray-700 hover:bg-gray-50`}
      >
        Cancel
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </form>
  );
}
