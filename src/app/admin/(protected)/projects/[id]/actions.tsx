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

/** Parse a comma-separated email list; empty entries dropped. */
function parseExtraCc(raw: string): string[] {
  return raw
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e !== "");
}

/** Recipient controls shared by admin-triggered outgoing emails, collapsed
 * behind a labeled disclosure so each action's primary controls stand out. */
function EmailOptionsFields({
  label,
  ccAdmins,
  onCcAdmins,
  extraCc,
  onExtraCc,
}: {
  label: string;
  ccAdmins: boolean;
  onCcAdmins: (v: boolean) => void;
  extraCc: string;
  onExtraCc: (v: string) => void;
}) {
  return (
    <details className="rounded-md border border-gray-200 bg-white/60">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-gray-600">
        {label}
        {ccAdmins ? " · CCing the admin team" : ""}
      </summary>
      <div className="space-y-2 border-t border-gray-100 px-3 py-3">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={ccAdmins}
            onChange={(e) => onCcAdmins(e.target.checked)}
          />
          CC the admin team
        </label>
        <div>
          <label className="block text-xs font-medium text-gray-700">
            Also include (comma-separated emails)
          </label>
          <input
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
            placeholder="name@example.org, other@example.org"
            value={extraCc}
            onChange={(e) => onExtraCc(e.target.value)}
          />
        </div>
      </div>
    </details>
  );
}

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
  const [ccAdmins, setCcAdmins] = useState(true);
  const [extraCc, setExtraCc] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function decide(decision: "advanced" | "changes_requested" | "denied") {
    setError(null);
    if ((decision === "changes_requested" || decision === "denied") && !notes.trim()) {
      setError(
        decision === "changes_requested"
          ? "Explain what needs to change. The vendor sees these notes."
          : "Give a reason. The vendor sees these notes.",
      );
      return;
    }
    if (decision === "denied" && !window.confirm("Deny this mail piece? This is terminal. The vendor is notified with your reason.")) {
      return;
    }
    setBusy(decision);
    const result = await postJson(`/api/admin/projects/${projectId}/review`, {
      stage,
      decision,
      checklist,
      notes: notes.trim() || undefined,
      emailOptions: { ccAdmins, extraCc: parseExtraCc(extraCc) },
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
          Checklist is advisory. It&apos;s stored with your decision but not
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
      <EmailOptionsFields
        label="Decision email to the vendor: CC options"
        ccAdmins={ccAdmins}
        onCcAdmins={setCcAdmins}
        extraCc={extraCc}
        onExtraCc={setExtraCc}
      />
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

export type CampaignContactSuggestion = {
  name: string;
  email: string;
  phone?: string;
  note?: string;
};

/**
 * Admin-owned campaign contact for this ticket: shows the current contact,
 * lets an admin set/approve one, and offers prepopulated suggestions from
 * the known-roster table (src/lib/campaign-contacts.ts) for this race.
 */
export function CampaignContactCard({
  projectId,
  current,
  suggestions,
}: {
  projectId: string;
  current: { name: string; email: string; phone: string | null };
  suggestions: CampaignContactSuggestion[];
}) {
  const router = useRouter();
  const hasContact = current.email !== "";
  const [editing, setEditing] = useState(!hasContact);
  const [name, setName] = useState(current.name);
  const [email, setEmail] = useState(current.email);
  const [phone, setPhone] = useState(current.phone ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const result = await postJson(
      `/api/admin/projects/${projectId}/campaign-contact`,
      { name, email, phone: phone || undefined },
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.message ?? "Save failed.");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  const inputCls =
    "mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none";

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">Campaign contact</h3>
        {hasContact && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs text-blue-700 underline"
          >
            Edit
          </button>
        )}
      </div>

      {!editing ? (
        <p className="mt-2 text-gray-700">
          {current.name}
          {current.email && ` · ${current.email}`}
          {current.phone && ` · ${current.phone}`}
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {!hasContact && (
            <p className="text-gray-600">
              No campaign contact set. The campaign review email can&apos;t be
              sent until one is approved here.
            </p>
          )}
          {suggestions.length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase text-gray-500">
                Known contacts for this race
              </p>
              <ul className="mt-1 space-y-1">
                {suggestions.map((s, i) => (
                  <li
                    key={`${s.email}-${i}`}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setName(s.name);
                        setEmail(s.email);
                        setPhone(s.phone ?? "");
                      }}
                      className="rounded-md border border-cyan-600 px-2 py-1 text-xs font-medium text-cyan-800 hover:bg-cyan-50"
                    >
                      Use {s.name}
                    </button>
                    <span className="text-xs text-gray-600">
                      {s.email}
                      {s.note ? ` · ${s.note}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-gray-700">
                Name
              </label>
              <input
                className={inputCls}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700">
                Email
              </label>
              <input
                type="email"
                className={inputCls}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700">
                Phone (optional)
              </label>
              <input
                className={inputCls}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          </div>
          {error && (
            <p role="alert" className="text-red-700">
              {error}
            </p>
          )}
          <div className="flex gap-3">
            <button
              type="button"
              disabled={busy || !name.trim() || !email.trim()}
              onClick={save}
              className="rounded-md bg-blue-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save contact"}
            </button>
            {hasContact && (
              <button
                type="button"
                onClick={() => {
                  setName(current.name);
                  setEmail(current.email);
                  setPhone(current.phone ?? "");
                  setEditing(false);
                }}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Resume review at the kicking stage without a resubmission (no emails). */
export function OverrideWaitButton({
  projectId,
  stageLabel,
}: {
  projectId: string;
  stageLabel: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          if (
            !window.confirm(
              `Resume review at ${stageLabel} without a resubmission? Use this when the requested change was cleared up outside the system (no emails are sent, no new version is created).`,
            )
          )
            return;
          setBusy(true);
          setError(null);
          const result = await postJson(
            `/api/admin/projects/${projectId}/override-wait`,
            {},
          );
          setBusy(false);
          if (!result.ok) setError(result.message ?? "Override failed.");
          router.refresh();
        }}
        className="rounded-md border border-amber-600 bg-white px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
      >
        {busy ? "Resuming…" : "Override wait: resume review"}
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}

export type ReviewerContactOption = {
  name: string;
  email: string;
  note?: string;
};

/**
 * Manual notice to the standing reviewer roster (compliance/legal) for the
 * current stage. Recipients default to everyone configured; individual
 * contacts can be unticked before sending.
 */
export function ReviewerNoticeButtons({
  projectId,
  stageLabel,
  contacts,
}: {
  projectId: string;
  stageLabel: string;
  contacts: ReviewerContactOption[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(contacts.map((c) => [c.email, true])),
  );
  const [ccAdmins, setCcAdmins] = useState(true);
  const [extraCc, setExtraCc] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const chosen = contacts.filter((c) => selected[c.email]);

  return (
    <div className="max-w-xl space-y-3">
      <div>
        <p className="text-sm font-medium text-gray-900">
          Standing {stageLabel.toLowerCase()} reviewers
        </p>
        <ul className="mt-1 space-y-1">
          {contacts.map((c) => (
            <li key={c.email}>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={selected[c.email] ?? false}
                  onChange={(e) =>
                    setSelected((s) => ({ ...s, [c.email]: e.target.checked }))
                  }
                />
                {c.name} · {c.email}
                {c.note ? (
                  <span className="text-xs text-gray-500">({c.note})</span>
                ) : null}
              </label>
            </li>
          ))}
        </ul>
      </div>
      <EmailOptionsFields
        label="Notice email: CC options"
        ccAdmins={ccAdmins}
        onCcAdmins={setCcAdmins}
        extraCc={extraCc}
        onExtraCc={setExtraCc}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || chosen.length === 0}
          onClick={async () => {
            if (
              !window.confirm(
                `Email ${chosen.map((c) => c.name).join(", ")} asking them to review this piece? The email includes the status link and the scheduled mail date.`,
              )
            )
              return;
            setBusy(true);
            setMessage(null);
            const result = await postJson(
              `/api/admin/projects/${projectId}/reviewer-notice`,
              {
                recipients: chosen.map((c) => c.email),
                emailOptions: { ccAdmins, extraCc: parseExtraCc(extraCc) },
              },
            );
            setBusy(false);
            setMessage(
              result.ok
                ? `Notice sent to ${chosen.map((c) => c.email).join(", ")}.`
                : (result.message ?? "Send failed."),
            );
            router.refresh();
          }}
          className="rounded-md border border-indigo-600 bg-white px-3 py-1.5 text-sm font-medium text-indigo-800 hover:bg-indigo-50 disabled:opacity-50"
        >
          {busy ? "Sending…" : "Notify reviewers"}
        </button>
        {message && <span className="text-xs text-gray-600">{message}</span>}
      </div>
    </div>
  );
}

export function CampaignReviewEmailButton({
  projectId,
  contactName,
  contactEmail,
}: {
  projectId: string;
  contactName: string;
  contactEmail: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [ccAdmins, setCcAdmins] = useState(true);
  const [extraCc, setExtraCc] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="max-w-xl space-y-3">
      <EmailOptionsFields
        label="Campaign email: CC options"
        ccAdmins={ccAdmins}
        onCcAdmins={setCcAdmins}
        extraCc={extraCc}
        onExtraCc={setExtraCc}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            if (
              !window.confirm(
                `Email ${contactName} (${contactEmail}) asking the campaign to review this piece? The email includes the status link and the scheduled mail date.`,
              )
            )
              return;
            setBusy(true);
            setMessage(null);
            const result = await postJson(
              `/api/admin/projects/${projectId}/campaign-review-request`,
              { emailOptions: { ccAdmins, extraCc: parseExtraCc(extraCc) } },
            );
            setBusy(false);
            setMessage(
              result.ok
                ? `Review request sent to ${contactEmail}.`
                : (result.message ?? "Send failed."),
            );
            router.refresh();
          }}
          className="rounded-md border border-cyan-600 bg-white px-3 py-1.5 text-sm font-medium text-cyan-800 hover:bg-cyan-50 disabled:opacity-50"
        >
          {busy ? "Sending…" : "Email campaign for review"}
        </button>
        {message && <span className="text-xs text-gray-600">{message}</span>}
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
