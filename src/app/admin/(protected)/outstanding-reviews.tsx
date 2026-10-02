"use client";

/**
 * Outstanding reviews grouped by reviewer on the admin dashboard. Each row
 * sends that person one reminder covering every review they still owe, with
 * their existing links (see /api/admin/review-reminders).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type OutstandingReviewer = {
  email: string;
  name: string;
  items: Array<{
    inviteId: string;
    projectId: string;
    candidateSupported: string;
    stageLabel: string;
    mailDate: string;
    campaignContact: boolean;
  }>;
  /** Formatted on the server; null = never reminded. */
  lastReminded: string | null;
};

export function OutstandingReviewsTable({
  reviewers,
}: {
  reviewers: OutstandingReviewer[];
}) {
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-500">
          <tr>
            <th className="px-4 py-3">Reviewer</th>
            <th className="px-4 py-3">Waiting on</th>
            <th className="px-4 py-3">Last reminded</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {reviewers.map((r) => (
            <tr key={r.email} className="align-top">
              <td className="px-4 py-3">
                <p className="font-medium text-gray-900">{r.name || r.email}</p>
                {r.name && <p className="text-xs text-gray-500">{r.email}</p>}
              </td>
              <td className="px-4 py-3">
                <ul className="space-y-0.5">
                  {r.items.map((i) => (
                    <li key={i.inviteId}>
                      <Link
                        href={`/admin/projects/${i.projectId}`}
                        className="text-blue-700 hover:underline"
                      >
                        {i.candidateSupported}
                      </Link>
                      <span className="text-gray-500">
                        {" "}
                        · {i.stageLabel}
                        {i.campaignContact ? " (campaign sign-off)" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-gray-600">
                {r.lastReminded ?? <span className="text-gray-400">-</span>}
              </td>
              <td className="px-4 py-3 text-right">
                <GroupedReminderButton reviewer={r} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupedReminderButton({ reviewer }: { reviewer: OutstandingReviewer }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const n = reviewer.items.length;
  const who = reviewer.name || reviewer.email;

  async function send() {
    if (
      !window.confirm(
        n === 1
          ? `Email ${who} a reminder? It re-sends their existing review link; the original email keeps working.`
          : `Email ${who} one reminder covering all ${n} reviews they owe? Each piece is listed with their existing review link; the original emails keep working.`,
      )
    )
      return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/review-reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: reviewer.email }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: unknown;
        count?: number;
        freshLinks?: number;
      };
      if (!res.ok) {
        setMessage(typeof data.error === "string" ? data.error : "Send failed.");
      } else {
        const fresh = data.freshLinks ?? 0;
        setMessage(
          `Reminder sent (${data.count ?? n} review${(data.count ?? n) === 1 ? "" : "s"}).` +
            (fresh > 0
              ? ` ${fresh} link${fresh === 1 ? "" : "s"} predated saved links and ${fresh === 1 ? "was" : "were"} reissued; the old ${fresh === 1 ? "one no longer works" : "ones no longer work"}.`
              : ""),
        );
      }
    } catch {
      setMessage("Network error. Please try again.");
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={send}
        className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium whitespace-nowrap text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        {busy ? "Sending…" : n === 1 ? "Send reminder" : `Send reminder (${n})`}
      </button>
      {message && <span className="max-w-xs text-right text-xs text-gray-600">{message}</span>}
    </div>
  );
}
