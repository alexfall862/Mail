"use client";

/**
 * Client-side action widgets for the admin project detail page: review panel,
 * paid checkboxes, regenerate link, delete (typed confirmation), reopen
 * (superuser). Each POSTs to its API route and refreshes the server page;
 * a losing concurrent action surfaces the server's clean "already moved"
 * message.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { STAGE_CHECKLISTS } from "@/lib/checklists";
import type { ReviewStage } from "@/lib/state-machine";

async function postJson(
  url: string,
  body: unknown,
): Promise<{ ok: boolean; message?: string; data?: Record<string, unknown> }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        message:
          typeof data.error === "string" ? data.error : "Something went wrong.",
      };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, message: "Network error. Please try again." };
  }
}

const btnPrimary =
  "rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50";

export function ReviewPanel({
  projectId,
  stage,
}: {
  projectId: string;
  stage: ReviewStage;
}) {
  const router = useRouter();
  const items = STAGE_CHECKLISTS[stage];
  const [checklist, setChecklist] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(items.map((i) => [i.key, false])),
  );
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function decide(decision: "advanced" | "changes_requested" | "denied") {
    setError(null);
    if ((decision === "changes_requested" || decision === "denied") && !notes.trim()) {
      setError(
        decision === "changes_requested"
          ? "Explain what needs to change — the vendor sees these notes."
          : "Give a reason — the vendor sees these notes.",
      );
      return;
    }
    if (decision === "denied" && !window.confirm("Deny this mail piece? This is terminal — the vendor is notified with your reason.")) {
      return;
    }
    setBusy(decision);
    const result = await postJson(`/api/admin/projects/${projectId}/review`, {
      stage,
      decision,
      checklist,
      notes: notes.trim() || undefined,
    });
    setBusy(null);
    if (!result.ok) {
      setError(result.message ?? "Something went wrong.");
      router.refresh();
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {items.map((item) => (
          <label key={item.key} className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={checklist[item.key] ?? false}
              onChange={(e) =>
                setChecklist((c) => ({ ...c, [item.key]: e.target.checked }))
              }
            />
            {item.label}
          </label>
        ))}
        <p className="text-xs text-gray-500">
          Checklist is advisory — it&apos;s stored with your decision but not
          required to advance.
        </p>
      </div>
      <div>
        <label htmlFor="review-notes" className="block text-sm font-medium text-gray-700">
          Notes{" "}
          <span className="font-normal text-gray-500">
            (sent verbatim to the vendor on “Request changes” or “Deny”)
          </span>
        </label>
        <textarea
          id="review-notes"
          rows={3}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => decide("advanced")}
          className={`${btnPrimary} bg-green-700 hover:bg-green-600`}
        >
          {busy === "advanced" ? "Working…" : "Advance"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => decide("changes_requested")}
          className={`${btnPrimary} bg-amber-600 hover:bg-amber-500`}
        >
          {busy === "changes_requested" ? "Working…" : "Request changes"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => decide("denied")}
          className={`${btnPrimary} bg-red-700 hover:bg-red-600`}
        >
          {busy === "denied" ? "Working…" : "Deny"}
        </button>
      </div>
    </div>
  );
}

export function PaidCheckbox({
  projectId,
  contactId,
  paid,
}: {
  projectId: string;
  contactId: string;
  paid: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-2">
      <input
        type="checkbox"
        checked={paid}
        disabled={busy}
        onChange={async (e) => {
          setBusy(true);
          setError(null);
          const result = await postJson(`/api/admin/projects/${projectId}/paid`, {
            contactId,
            paid: e.target.checked,
          });
          setBusy(false);
          if (!result.ok) setError(result.message ?? "Failed.");
          router.refresh();
        }}
      />
      <span className="text-sm text-gray-700">Paid by KDP</span>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}

export function RegenerateLinkButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          if (
            !window.confirm(
              "Generate a new magic link? The old link stops working immediately and primary contacts are emailed the new one.",
            )
          )
            return;
          setBusy(true);
          setMessage(null);
          const result = await postJson(
            `/api/admin/projects/${projectId}/regenerate-link`,
            {},
          );
          setBusy(false);
          setMessage(
            result.ok
              ? "New link generated and emailed to primary contacts."
              : (result.message ?? "Failed."),
          );
          router.refresh();
        }}
        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        {busy ? "Working…" : "Regenerate vendor link"}
      </button>
      {message && <span className="text-xs text-gray-600">{message}</span>}
    </span>
  );
}

export function DeleteProjectButton({
  projectId,
  candidateName,
}: {
  projectId: string;
  candidateName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setTyped("");
          setError(null);
          setOpen(true);
        }}
        className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
      >
        Delete project
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold text-gray-900">
              Delete this project?
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              This permanently removes the project, all versions, files, and
              its audit trail, leaving only a summary tombstone. Uploaded
              artwork is purged from storage. This cannot be undone.
            </p>
            <label className="mt-4 block text-sm font-medium text-gray-700">
              Type the candidate name to confirm:{" "}
              <span className="font-mono">{candidateName}</span>
            </label>
            <input
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
            {error && (
              <p role="alert" className="mt-2 text-sm text-red-700">
                {error}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || typed.trim() !== candidateName}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  const result = await postJson(
                    `/api/admin/projects/${projectId}/delete`,
                    { confirmName: typed },
                  );
                  setBusy(false);
                  if (!result.ok) {
                    setError(result.message ?? "Delete failed.");
                    return;
                  }
                  window.location.assign("/admin");
                }}
                className={`${btnPrimary} bg-red-700 hover:bg-red-600`}
              >
                {busy ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function ReopenButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setReason("");
          setError(null);
          setOpen(true);
        }}
        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        Reopen (final review)
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold text-gray-900">Reopen project</h2>
            <p className="mt-2 text-sm text-gray-600">
              Moves this project back to Final Review. All admins are notified.
              A reason is required and recorded in the audit trail.
            </p>
            <textarea
              rows={3}
              placeholder="Reason for reopening"
              className="mt-4 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            {error && (
              <p role="alert" className="mt-2 text-sm text-red-700">
                {error}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !reason.trim()}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  const result = await postJson(
                    `/api/admin/projects/${projectId}/reopen`,
                    { reason },
                  );
                  setBusy(false);
                  if (!result.ok) {
                    setError(result.message ?? "Reopen failed.");
                    return;
                  }
                  setOpen(false);
                  router.refresh();
                }}
                className={`${btnPrimary} bg-blue-700 hover:bg-blue-600`}
              >
                {busy ? "Working…" : "Reopen"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
