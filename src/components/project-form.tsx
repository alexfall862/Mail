"use client";

/**
 * Shared vendor form (SPEC §9): used for the public submission (/submit) and
 * for resubmission on the magic-link status page (pre-filled, files optional
 * with carry-forward). All artwork processing happens in the browser (§6) and
 * bytes go straight to R2 via presigned PUTs (§3).
 */
import { useRef, useState } from "react";
import { Turnstile } from "@/components/turnstile";
import {
  ArtworkError,
  ARTWORK_INPUT_TYPES,
  processCombinedFile,
  processSideFile,
  type ProcessedImage,
} from "@/lib/client/artwork";
import { putToR2, requestPresign, UploadError } from "@/lib/client/upload";
import { districtOptionsFor } from "@/lib/district-options";
import {
  contactsSchema,
  DISTRICT_DETAIL_LABEL,
  DISTRICT_REQUIRED_OFFICES,
  DISTRICT_TOOLTIP,
  minMailDate,
  OFFICES,
  projectFieldsSchema,
  resubmitProjectFieldsSchema,
  VENDOR_ROLES,
  type ContactInput,
  type FileClaim,
  type Office,
  type ResubmitProjectFields,
  type VendorRole,
} from "@/lib/schemas/project";
import type { PresignRequest } from "@/lib/schemas/uploads";
import type { UploadKind } from "@/lib/uploads";

const INVOICE_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const MAX_INVOICE_BYTES = 10 * 1024 * 1024;

type ArtworkMode = "separate" | "combined";

export type ProjectFormInitial = {
  /** Total cost is intentionally absent: the status page must never carry
   * the vendor's quote (campaigns view it via the same link). */
  project: ResubmitProjectFields;
  contacts: ContactInput[];
  /** Kinds present on the current version (drives carry-forward UI). */
  currentKinds: UploadKind[];
  currentFilenames: Partial<Record<UploadKind, string>>;
};

export type ProjectFormProps =
  | { mode: "new"; siteKey: string }
  | { mode: "resubmit"; vendorToken: string; initial: ProjectFormInitial };

type ContactState = ContactInput & { enabled: boolean };

type SlotProgress = { label: string; fraction: number };

const inputCls =
  "mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none";
const labelCls = "block text-sm font-medium text-gray-700";

function emptyContact(role: VendorRole): ContactState {
  return {
    enabled: false,
    role,
    orgName: "",
    contactName: "",
    email: "",
    phone: "",
    paidByKdp: false,
    isPrimary: false,
  };
}

export function ProjectForm(props: ProjectFormProps) {
  const initial = props.mode === "resubmit" ? props.initial : null;
  const prevSeparate =
    initial?.currentKinds.includes("artwork_front") ?? false;
  const prevCombined =
    initial?.currentKinds.includes("artwork_combined") ?? false;

  const [fields, setFields] = useState(() => ({
    candidateSupported: initial?.project.candidateSupported ?? "",
    description: initial?.project.description ?? "",
    citationsAndClaims: initial?.project.citationsAndClaims ?? "",
    office: (initial?.project.office ?? "") as Office | "",
    districtDetail: initial?.project.districtDetail ?? "",
    pieceCount: initial ? String(initial.project.pieceCount) : "",
    totalCost:
      initial?.project.totalCostCents != null
        ? (initial.project.totalCostCents / 100).toFixed(2)
        : "",
    postOfficeLocation: initial?.project.postOfficeLocation ?? "",
    permitNumber: initial?.project.permitNumber ?? "",
    mailDate: initial?.project.mailDate ?? "",
  }));
  const [contacts, setContacts] = useState<ContactState[]>(() =>
    VENDOR_ROLES.map(({ value }) => {
      const existing = initial?.contacts.find((c) => c.role === value);
      return existing
        ? { ...existing, phone: existing.phone ?? "", enabled: true }
        : emptyContact(value);
    }),
  );
  const [artworkMode, setArtworkMode] = useState<ArtworkMode>(
    prevCombined ? "combined" : "separate",
  );
  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [backFile, setBackFile] = useState<File | null>(null);
  const [combinedFile, setCombinedFile] = useState<File | null>(null);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [vendorNote, setVendorNote] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [progress, setProgress] = useState<SlotProgress[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const draftTokenRef = useRef<string | null>(null);

  // Carry-forward is only possible for slots the current version has, in the
  // currently selected mode (§5: switching modes requires a full new set).
  const canKeepFront = props.mode === "resubmit" && prevSeparate && artworkMode === "separate";
  const canKeepBack = canKeepFront;
  const canKeepCombined =
    props.mode === "resubmit" && prevCombined && artworkMode === "combined";
  const canKeepInvoice = props.mode === "resubmit";

  function setField<K extends keyof typeof fields>(key: K, value: string) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  // Selecting an office suggests the district (e.g. "Statewide") without
  // clobbering anything the vendor typed themselves.
  function handleOfficeChange(value: string) {
    setFields((f) => {
      const previous = districtOptionsFor(f.office);
      const next = districtOptionsFor(value as Office);
      const untouched =
        f.districtDetail.trim() === "" || f.districtDetail === previous.prefill;
      return {
        ...f,
        office: value as Office | "",
        districtDetail: untouched ? (next.prefill ?? "") : f.districtDetail,
      };
    });
  }

  const districtSuggestions = districtOptionsFor(fields.office).options;

  function updateContact(role: VendorRole, patch: Partial<ContactState>) {
    setContacts((cs) => cs.map((c) => (c.role === role ? { ...c, ...patch } : c)));
  }

  function buildProjectFields(): ResubmitProjectFields | string {
    const pieceCount = Number(fields.pieceCount);
    const costProvided = fields.totalCost.trim() !== "";
    if (props.mode === "new" && !costProvided) {
      return "Enter the total cost in dollars.";
    }
    let totalCostCents: number | undefined;
    if (costProvided) {
      const dollars = Number(fields.totalCost);
      if (!Number.isFinite(dollars)) return "Enter the total cost in dollars.";
      totalCostCents = Math.round(dollars * 100);
    }
    const candidate: ResubmitProjectFields = {
      candidateSupported: fields.candidateSupported,
      description: fields.description,
      citationsAndClaims: fields.citationsAndClaims || undefined,
      office: (fields.office || "other") as Office,
      districtDetail: fields.districtDetail || undefined,
      pieceCount: Number.isFinite(pieceCount) ? pieceCount : 0,
      totalCostCents,
      postOfficeLocation: fields.postOfficeLocation,
      permitNumber: fields.permitNumber,
      mailDate: fields.mailDate,
    };
    if (!fields.office) return "Select the office.";
    const schema =
      props.mode === "new" ? projectFieldsSchema : resubmitProjectFieldsSchema;
    const parsed = schema.safeParse(candidate);
    if (!parsed.success) return parsed.error.issues[0]?.message ?? "Check the form fields.";
    return parsed.data;
  }

  async function presign(
    kind: UploadKind,
    contentType: string,
    sizeBytes: number,
  ) {
    const auth: PresignRequest["auth"] =
      props.mode === "resubmit"
        ? { mode: "resubmit", vendorToken: props.vendorToken }
        : draftTokenRef.current
          ? { mode: "new", draftToken: draftTokenRef.current }
          : { mode: "new", turnstileToken };
    const res = await requestPresign({ kind, contentType, sizeBytes, auth });
    if (res.draftToken) draftTokenRef.current = res.draftToken;
    return res;
  }

  async function uploadProcessed(
    kind: UploadKind,
    image: ProcessedImage,
    originalFilename: string,
    label: string,
  ): Promise<FileClaim> {
    const { url, key } = await presign(kind, "image/jpeg", image.blob.size);
    setProgress((p) => [...p, { label, fraction: 0 }]);
    await putToR2(url, image.blob, "image/jpeg", (fraction) =>
      setProgress((p) => p.map((s) => (s.label === label ? { ...s, fraction } : s))),
    );
    return {
      kind,
      r2Key: key,
      originalFilename,
      contentType: "image/jpeg",
      sizeBytes: image.blob.size,
      widthPx: image.width,
      heightPx: image.height,
    };
  }

  async function uploadInvoice(file: File): Promise<FileClaim> {
    const contentType = file.type;
    const { url, key } = await presign("invoice", contentType, file.size);
    const label = "Invoice";
    setProgress((p) => [...p, { label, fraction: 0 }]);
    await putToR2(url, file, contentType, (fraction) =>
      setProgress((p) => p.map((s) => (s.label === label ? { ...s, fraction } : s))),
    );
    return {
      kind: "invoice",
      r2Key: key,
      originalFilename: file.name,
      contentType,
      sizeBytes: file.size,
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);
    setNotes([]);
    setProgress([]);

    const problems: string[] = [];
    const projectFields = buildProjectFields();
    if (typeof projectFields === "string") problems.push(projectFields);

    const enabledContacts: ContactInput[] = contacts
      .filter((c) => c.enabled)
      .map(({ enabled: _enabled, ...c }) => ({
        ...c,
        phone: c.phone || undefined,
      }));
    const contactsParsed = contactsSchema.safeParse(enabledContacts);
    if (!contactsParsed.success) {
      problems.push(contactsParsed.error.issues[0]?.message ?? "Check the vendor blocks.");
    }

    // File presence per mode (§6/§9): required on first submission; on
    // resubmit a missing file means carry-forward where allowed.
    if (artworkMode === "separate") {
      if (!frontFile && !canKeepFront) problems.push("Attach the front artwork file.");
      if (!backFile && !canKeepBack) problems.push("Attach the back artwork file.");
    } else if (!combinedFile && !canKeepCombined) {
      problems.push("Attach the combined artwork file.");
    }
    if (!invoiceFile && !canKeepInvoice) problems.push("Attach the invoice.");
    if (invoiceFile) {
      if (!INVOICE_TYPES.includes(invoiceFile.type)) {
        problems.push("Invoices must be a PDF, JPEG, or PNG file.");
      } else if (invoiceFile.size > MAX_INVOICE_BYTES) {
        problems.push("The invoice is too large (limit 10 MB).");
      }
    }
    for (const f of [frontFile, backFile, combinedFile]) {
      if (f && !ARTWORK_INPUT_TYPES.includes(f.type)) {
        problems.push(`"${f.name}" isn't a supported artwork type (JPEG, PNG, WebP, or PDF).`);
      }
    }
    if (props.mode === "new" && !turnstileToken && !draftTokenRef.current) {
      problems.push("Complete the verification challenge at the bottom of the form.");
    }
    if (problems.length > 0 || typeof projectFields === "string" || !contactsParsed.success) {
      setErrors(problems);
      return;
    }

    setSubmitting(true);
    try {
      // 1. Process artwork in-browser (§6) before any upload.
      const uploads: FileClaim[] = [];
      const pipelineNotes: string[] = [];
      const carryForwardKinds: UploadKind[] = [];

      if (artworkMode === "separate") {
        if (frontFile) {
          const { image, note } = await processSideFile(frontFile);
          if (note) pipelineNotes.push(note);
          uploads.push(
            await uploadProcessed("artwork_front", image, frontFile.name, "Front artwork"),
          );
        } else {
          carryForwardKinds.push("artwork_front");
        }
        if (backFile) {
          const { image, note } = await processSideFile(backFile);
          if (note) pipelineNotes.push(note);
          uploads.push(
            await uploadProcessed("artwork_back", image, backFile.name, "Back artwork"),
          );
        } else {
          carryForwardKinds.push("artwork_back");
        }
      } else if (combinedFile) {
        const result = await processCombinedFile(combinedFile);
        if (result.mode === "split") {
          // §6: multi-page PDF auto-split — page 1 front, page 2 back.
          if (result.note) pipelineNotes.push(result.note);
          uploads.push(
            await uploadProcessed("artwork_front", result.front, combinedFile.name, "Artwork (page 1 → front)"),
            await uploadProcessed("artwork_back", result.back, combinedFile.name, "Artwork (page 2 → back)"),
          );
        } else {
          uploads.push(
            await uploadProcessed("artwork_combined", result.image, combinedFile.name, "Combined artwork"),
          );
        }
      } else {
        // keeping current combined artwork — §5 carry-forward keeps whatever
        // artwork kinds the current version has.
        carryForwardKinds.push("artwork_combined");
      }

      if (invoiceFile) {
        uploads.push(await uploadInvoice(invoiceFile));
      } else if (canKeepInvoice) {
        carryForwardKinds.push("invoice");
      }
      setNotes(pipelineNotes);

      // 2. Final submit with metadata + claimed files.
      if (props.mode === "new") {
        const res = await fetch("/api/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            draftToken: draftTokenRef.current,
            project: projectFields,
            contacts: enabledContacts,
            files: uploads,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new UploadError(data.error ?? "Submission failed. Please try again.");
        window.location.assign("/submit/success");
        return;
      }

      // Resubmit: carry forward every slot the vendor didn't replace.
      const res = await fetch("/api/resubmit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorToken: props.vendorToken,
          project: projectFields,
          contacts: enabledContacts,
          uploads,
          carryForwardKinds,
          vendorNote: vendorNote || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new UploadError(data.error ?? "Resubmission failed. Please try again.");
      setDone(true);
      window.location.reload();
    } catch (err) {
      if (err instanceof ArtworkError || err instanceof UploadError) {
        setErrors([err.message]);
      } else {
        console.error(err);
        setErrors(["Something went wrong. Please check your connection and try again."]);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const officeNeedsDistrict =
    fields.office !== "" &&
    DISTRICT_REQUIRED_OFFICES.includes(fields.office as Office);

  if (done) {
    return (
      <p className="rounded-md bg-green-50 p-4 text-green-800">
        Revision submitted. Refreshing the page…
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* ------------------------------------------------ General fields */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Mail piece details</h2>
        <div>
          <label htmlFor="candidate" className={labelCls}>
            Candidate or cause supported *
          </label>
          <input
            id="candidate"
            className={inputCls}
            value={fields.candidateSupported}
            onChange={(e) => setField("candidateSupported", e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="description" className={labelCls}>
            Description of the piece *
          </label>
          <textarea
            id="description"
            rows={3}
            className={inputCls}
            value={fields.description}
            onChange={(e) => setField("description", e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="citationsAndClaims" className={labelCls}>
            Citations and claims
          </label>
          <p className="text-xs text-gray-500">
            Optional. Links, sources, or explanations that support any claims
            made in the piece.
          </p>
          <textarea
            id="citationsAndClaims"
            rows={3}
            className={inputCls}
            value={fields.citationsAndClaims}
            onChange={(e) => setField("citationsAndClaims", e.target.value)}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="office" className={labelCls}>
              Office *
            </label>
            <select
              id="office"
              className={inputCls}
              value={fields.office}
              onChange={(e) => handleOfficeChange(e.target.value)}
            >
              <option value="">Select…</option>
              {OFFICES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="district" className={labelCls}>
              {DISTRICT_DETAIL_LABEL} {officeNeedsDistrict ? "*" : ""}{" "}
              <span
                title={DISTRICT_TOOLTIP}
                aria-label={DISTRICT_TOOLTIP}
                className="ml-1 inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full bg-gray-300 text-[10px] font-bold text-white"
              >
                ?
              </span>
            </label>
            <input
              id="district"
              list="district-suggestions"
              className={inputCls}
              value={fields.districtDetail}
              onChange={(e) => setField("districtDetail", e.target.value)}
            />
            <datalist id="district-suggestions">
              {districtSuggestions.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          </div>
          <div>
            <label htmlFor="pieces" className={labelCls}>
              Number of pieces *
            </label>
            <input
              id="pieces"
              type="number"
              min={1}
              step={1}
              className={inputCls}
              value={fields.pieceCount}
              onChange={(e) => setField("pieceCount", e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="cost" className={labelCls}>
              Total cost (USD) {props.mode === "new" ? "*" : ""}
            </label>
            <input
              id="cost"
              type="number"
              min={0}
              step="0.01"
              className={inputCls}
              value={fields.totalCost}
              onChange={(e) => setField("totalCost", e.target.value)}
            />
            {props.mode === "resubmit" && (
              <p className="mt-1 text-xs text-gray-500">
                Leave blank to keep the current cost.
              </p>
            )}
          </div>
          <div>
            <label htmlFor="postoffice" className={labelCls}>
              Post office location *
            </label>
            <input
              id="postoffice"
              className={inputCls}
              value={fields.postOfficeLocation}
              onChange={(e) => setField("postOfficeLocation", e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="permit" className={labelCls}>
              Permit number *
            </label>
            <input
              id="permit"
              className={inputCls}
              value={fields.permitNumber}
              onChange={(e) => setField("permitNumber", e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="maildate" className={labelCls}>
              Mail date *
            </label>
            <input
              id="maildate"
              type="date"
              min={minMailDate()}
              className={inputCls}
              value={fields.mailDate}
              onChange={(e) => setField("mailDate", e.target.value)}
            />
            <p className="mt-1 text-xs text-gray-500">
              Must be at least two full business days from today.
            </p>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ Vendors */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Vendors</h2>
        <p className="text-sm text-gray-600">
          Complete at least one block. Mark at least one contact to receive
          status emails.
        </p>
        {contacts.map((c) => (
          <fieldset key={c.role} className="rounded-md border border-gray-200 p-4">
            <label className="flex items-center gap-2 font-medium text-gray-900">
              <input
                type="checkbox"
                checked={c.enabled}
                onChange={(e) => updateContact(c.role, { enabled: e.target.checked })}
              />
              {VENDOR_ROLES.find((r) => r.value === c.role)?.label}
            </label>
            {c.enabled && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>Organization *</label>
                  <input
                    className={inputCls}
                    value={c.orgName}
                    onChange={(e) => updateContact(c.role, { orgName: e.target.value })}
                  />
                </div>
                <div>
                  <label className={labelCls}>Contact name *</label>
                  <input
                    className={inputCls}
                    value={c.contactName}
                    onChange={(e) => updateContact(c.role, { contactName: e.target.value })}
                  />
                </div>
                <div>
                  <label className={labelCls}>Email *</label>
                  <input
                    type="email"
                    className={inputCls}
                    value={c.email}
                    onChange={(e) => updateContact(c.role, { email: e.target.value })}
                  />
                </div>
                <div>
                  <label className={labelCls}>Phone</label>
                  <input
                    className={inputCls}
                    value={c.phone ?? ""}
                    onChange={(e) => updateContact(c.role, { phone: e.target.value })}
                  />
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={c.paidByKdp}
                    onChange={(e) => updateContact(c.role, { paidByKdp: e.target.checked })}
                  />
                  Needs to be paid by KDP
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={c.isPrimary}
                    onChange={(e) => updateContact(c.role, { isPrimary: e.target.checked })}
                  />
                  Receive status emails
                </label>
              </div>
            )}
          </fieldset>
        ))}
      </section>

      {/* -------------------------------------------------------- Files */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Artwork &amp; invoice</h2>
        <div className="flex gap-6">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="radio"
              name="artworkMode"
              checked={artworkMode === "separate"}
              onChange={() => setArtworkMode("separate")}
            />
            Separate front/back files
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="radio"
              name="artworkMode"
              checked={artworkMode === "combined"}
              onChange={() => setArtworkMode("combined")}
            />
            Single combined file
          </label>
        </div>
        <p className="text-sm text-gray-600">
          Accepted: JPEG, PNG, WebP, or PDF. Artwork is reduced to review
          quality in your browser before upload. Your print-ready originals
          never leave your computer.
          {artworkMode === "combined" &&
            " A multi-page PDF is split automatically: page 1 becomes the front, page 2 the back."}
        </p>
        {artworkMode === "separate" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <FileSlot
              label="Front artwork"
              accept={ARTWORK_INPUT_TYPES.join(",")}
              file={frontFile}
              onFile={setFrontFile}
              keepLabel={canKeepFront ? currentName(initial, "artwork_front") : null}
            />
            <FileSlot
              label="Back artwork"
              accept={ARTWORK_INPUT_TYPES.join(",")}
              file={backFile}
              onFile={setBackFile}
              keepLabel={canKeepBack ? currentName(initial, "artwork_back") : null}
            />
          </div>
        ) : (
          <FileSlot
            label="Combined artwork (both sides)"
            accept={ARTWORK_INPUT_TYPES.join(",")}
            file={combinedFile}
            onFile={setCombinedFile}
            keepLabel={canKeepCombined ? currentName(initial, "artwork_combined") : null}
          />
        )}
        <FileSlot
          label="Invoice"
          accept={INVOICE_TYPES.join(",")}
          file={invoiceFile}
          onFile={setInvoiceFile}
          keepLabel={canKeepInvoice ? currentName(initial, "invoice") : null}
        />
      </section>

      {props.mode === "resubmit" && (
        <section>
          <label htmlFor="vendorNote" className={labelCls}>
            Note for the reviewers (what changed?)
          </label>
          <textarea
            id="vendorNote"
            rows={3}
            className={inputCls}
            value={vendorNote}
            onChange={(e) => setVendorNote(e.target.value)}
          />
        </section>
      )}

      {props.mode === "new" && (
        <Turnstile siteKey={props.siteKey} onToken={setTurnstileToken} />
      )}

      {progress.length > 0 && (
        <div className="space-y-2">
          {progress.map((p) => (
            <div key={p.label}>
              <div className="flex justify-between text-xs text-gray-600">
                <span>{p.label}</span>
                <span>{Math.round(p.fraction * 100)}%</span>
              </div>
              <div className="h-2 rounded bg-gray-200">
                <div
                  className="h-2 rounded bg-blue-600 transition-all"
                  style={{ width: `${Math.round(p.fraction * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {notes.length > 0 && (
        <ul className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {errors.length > 0 && (
        <ul role="alert" className="space-y-1 rounded-md bg-red-50 p-3 text-sm text-red-700">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-blue-700 px-6 py-3 font-semibold text-white hover:bg-blue-600 disabled:opacity-50"
      >
        {submitting
          ? "Uploading…"
          : props.mode === "new"
            ? "Submit mail piece"
            : "Submit revision"}
      </button>
    </form>
  );
}

function currentName(
  initial: ProjectFormInitial | null,
  kind: UploadKind,
): string | null {
  return initial?.currentFilenames[kind] ?? null;
}

function FileSlot({
  label,
  accept,
  file,
  onFile,
  keepLabel,
}: {
  label: string;
  accept: string;
  file: File | null;
  onFile: (f: File | null) => void;
  /** Non-null when leaving the slot empty keeps the named current file. */
  keepLabel: string | null;
}) {
  return (
    <div>
      <label className={labelCls}>
        {label} {keepLabel === null ? "*" : ""}
      </label>
      <input
        type="file"
        accept={accept}
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        className="mt-1 block w-full text-sm text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-gray-200"
      />
      {keepLabel !== null && !file && (
        <p className="mt-1 text-xs text-gray-500">
          Leave empty to keep the current file ({keepLabel}).
        </p>
      )}
    </div>
  );
}
