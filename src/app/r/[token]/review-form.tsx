"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Decision = "approved" | "issues";

/**
 * The feedback form on a reviewer's private page. Campaign contacts at
 * campaign review are told their approval moves the piece forward; everyone
 * else's feedback is informational for the mail program team.
 */
export function ReviewForm({
  token,
  isCampaignSignoff,
  initial,
}: {
  token: string;
  /** True when an approval advances the project (campaign contact at campaign review). */
  isCampaignSignoff: boolean;
  initial: { decision: Decision; notes: string } | null;
}) {
  const router = useRouter();
  const [decision, setDecision] = useState<Decision | null>(
    initial?.decision ?? null,
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<null | { advanced: boolean }>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!decision) {
      setError("Choose an option first.");
      return;
    }
    if (
      isCampaignSignoff &&
      decision === "approved" &&
      !window.confirm(
        "Approve this mail piece? Your sign-off is recorded and the piece moves to the next review step.",
      )
    ) {
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/review/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, notes: notes.trim() || undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        advanced?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      setDone({ advanced: data.advanced === true });
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-lg border border-green-300 bg-green-50 p-5 text-sm text-green-900">
        <p className="font-semibold">
          {done.advanced
            ? "Thank you! Your approval is recorded."
            : "Thank you! Your feedback is recorded."}
        </p>
        <p className="mt-1">
          {done.advanced
            ? "The mail piece has moved on to the next review step. Nothing else is needed from you."
            : "The mail program team can see it on the project right away."}
        </p>
      </div>
    );
  }

  const approveLabel = isCampaignSignoff
    ? "Approve this mail piece"
    : "Looks good to me";
  const issuesLabel = "Flag an issue";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="sr-only">Your feedback</legend>
        {(
          [
            {
              value: "approved" as const,
              label: approveLabel,
              detail: isCampaignSignoff
                ? "Records your sign-off and moves the piece to the next review step."
                : "Lets the team know you reviewed it and saw no problems.",
            },
            {
              value: "issues" as const,
              label: issuesLabel,
              detail: "Describe the problem below; the team will follow up.",
            },
          ]
        ).map((opt) => (
          <label
            key={opt.value}
            className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${
              decision === opt.value
                ? "border-blue-500 bg-blue-50"
                : "border-gray-300 bg-white hover:bg-gray-50"
            }`}
          >
            <input
              type="radio"
              name="decision"
              value={opt.value}
              checked={decision === opt.value}
              onChange={() => setDecision(opt.value)}
              className="mt-1"
            />
            <span>
              <span className="block font-medium text-gray-900">{opt.label}</span>
              <span className="block text-sm text-gray-600">{opt.detail}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div>
        <label
          htmlFor="review-notes"
          className="block text-sm font-medium text-gray-700"
        >
          Notes{" "}
          <span className="font-normal text-gray-500">
            {decision === "issues" ? "(required)" : "(optional)"}
          </span>
        </label>
        <textarea
          id="review-notes"
          rows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          required={decision === "issues"}
          placeholder={
            decision === "issues"
              ? "What's wrong, and where on the piece?"
              : "Anything you want the team to know."
          }
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting || !decision}
        className="rounded-md bg-blue-700 px-5 py-2 font-semibold text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting
          ? "Submitting…"
          : initial
            ? "Update my feedback"
            : "Submit feedback"}
      </button>
    </form>
  );
}
