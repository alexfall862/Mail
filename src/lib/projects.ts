/**
 * Project persistence operations (SPEC §5–6). Every state transition runs in
 * a transaction; resubmission locks the project row with SELECT … FOR UPDATE
 * so a losing concurrent action gets a clean "already moved" error.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  contacts as contactsTable,
  files as filesTable,
  projects,
  stageReviews,
  submissionVersions,
} from "@/db/schema";
import { logEvent } from "./events";
import {
  transition,
  type ProjectStatus,
  type ReviewStage,
} from "./state-machine";
import { generateVendorToken, hashVendorToken } from "./tokens";
import { verifyClaimedFile, type UploadKind } from "./uploads";
import type {
  ContactInput,
  FileClaim,
  ProjectFields,
  ResubmitRequest,
  SubmitRequest,
} from "./schemas/project";
import {
  computeArtworkChanged,
  validateVersionFileSet,
} from "./version-files";

export type OperationResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; message: string };

function fail<T>(status: number, message: string): OperationResult<T> {
  return { ok: false, status, message };
}

/** HEAD-verify a batch of claimed uploads against R2 (§6). */
async function verifyUploads(
  claims: FileClaim[],
  projectId: string,
  expectedPrefix: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  for (const claim of claims) {
    if (!claim.r2Key.startsWith(expectedPrefix)) {
      return { ok: false, message: "Uploaded file key does not match this submission." };
    }
    const result = await verifyClaimedFile(claim, projectId);
    if (!result.ok) return result;
  }
  return { ok: true };
}

function projectValues(fields: ProjectFields) {
  return {
    candidateSupported: fields.candidateSupported,
    description: fields.description,
    office: fields.office,
    districtDetail: fields.districtDetail?.trim() ? fields.districtDetail.trim() : null,
    pieceCount: fields.pieceCount,
    totalCostCents: fields.totalCostCents,
    postOfficeLocation: fields.postOfficeLocation,
    permitNumber: fields.permitNumber,
    mailDate: fields.mailDate,
  };
}

export type CreatedProject = {
  projectId: string;
  rawVendorToken: string;
  versionNumber: number;
};

/** §5 rows 1–2: create project + v1 + files atomically, auto-advancing to content_review. */
export async function createProject(
  input: SubmitRequest,
  projectId: string,
): Promise<OperationResult<CreatedProject>> {
  const kinds = input.files.map((f) => f.kind);
  const validity = validateVersionFileSet(kinds);
  if (!validity.ok) return fail(400, validity.message);

  const headCheck = await verifyUploads(
    input.files,
    projectId,
    `projects/${projectId}/v1/`,
  );
  if (!headCheck.ok) return fail(400, headCheck.message);

  const token = generateVendorToken();

  try {
    await db.transaction(async (tx) => {
      await tx.insert(projects).values({
        id: projectId,
        ...projectValues(input.project),
        status: "submitted",
        vendorTokenHash: token.hash,
      });

      const [version] = await tx
        .insert(submissionVersions)
        .values({ projectId, versionNumber: 1 })
        .returning({ id: submissionVersions.id });
      const versionId = version!.id;

      await tx.insert(filesTable).values(
        input.files.map((f) => ({
          versionId,
          projectId,
          kind: f.kind,
          r2Key: f.r2Key,
          originalFilename: f.originalFilename,
          contentType: f.contentType,
          sizeBytes: f.sizeBytes,
          widthPx: f.widthPx ?? null,
          heightPx: f.heightPx ?? null,
        })),
      );

      await tx.insert(contactsTable).values(
        input.contacts.map((c) => ({
          projectId,
          role: c.role,
          orgName: c.orgName,
          contactName: c.contactName,
          email: c.email.toLowerCase(),
          phone: c.phone?.trim() ? c.phone.trim() : null,
          paidByKdp: c.paidByKdp,
          isPrimary: c.isPrimary,
        })),
      );

      await logEvent(tx, {
        projectId,
        actor: "vendor",
        eventType: "project.created",
        payload: {
          candidate: input.project.candidateSupported,
          office: input.project.office,
          mailDate: input.project.mailDate,
        },
      });
      for (const f of input.files) {
        await logEvent(tx, {
          projectId,
          actor: "vendor",
          eventType: "file.uploaded",
          payload: { kind: f.kind, r2Key: f.r2Key, sizeBytes: f.sizeBytes },
        });
      }
      await logEvent(tx, {
        projectId,
        actor: "vendor",
        eventType: "version.submitted",
        payload: { versionNumber: 1 },
      });

      // §5 row 2: automatic advance in the same transaction.
      const advanced = transition(
        { status: "submitted", changesRequestedFrom: null },
        { kind: "system_advance_after_creation" },
      );
      if (!advanced.ok) throw new Error(advanced.message);
      await tx
        .update(projects)
        .set({
          currentVersionId: versionId,
          status: advanced.state.status,
          statusChangedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(projects.id, projectId));
      await logEvent(tx, {
        projectId,
        actor: "system",
        eventType: "status.changed",
        payload: { from: "submitted", to: advanced.state.status },
      });
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return fail(409, "This submission was already received.");
    }
    throw err;
  }

  return {
    ok: true,
    value: { projectId, rawVendorToken: token.raw, versionNumber: 1 },
  };
}

export type ResubmissionOutcome = {
  projectId: string;
  versionNumber: number;
  newStatus: ProjectStatus;
  artworkChanged: boolean;
  vendorNote: string | null;
};

/** §5 row 7: vendor resubmission with carry-forward and the routing rule. */
export async function resubmitProject(
  input: ResubmitRequest,
): Promise<OperationResult<ResubmissionOutcome>> {
  const tokenHash = hashVendorToken(input.vendorToken);
  const [found] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.vendorTokenHash, tokenHash));
  if (!found) return fail(404, "This link is no longer valid.");
  const projectId = found.id;

  try {
    const outcome = await db.transaction(
      async (tx): Promise<OperationResult<ResubmissionOutcome>> => {
        // §5 guardrails: row lock; the losing concurrent request waits here,
        // then fails the state-machine check below with a clean error.
        await tx.execute(
          sql`select id from projects where id = ${projectId} for update`,
        );
        const [project] = await tx
          .select()
          .from(projects)
          .where(eq(projects.id, projectId));
        if (!project) return fail(404, "This link is no longer valid.");

        const currentVersionId = project.currentVersionId;
        if (!currentVersionId) return fail(500, "Project has no current version.");
        const [currentVersion] = await tx
          .select()
          .from(submissionVersions)
          .where(eq(submissionVersions.id, currentVersionId));
        if (!currentVersion) return fail(500, "Project has no current version.");

        const previousFiles = await tx
          .select()
          .from(filesTable)
          .where(eq(filesTable.versionId, currentVersionId));
        const previousByKind = new Map(previousFiles.map((f) => [f.kind, f]));

        // Resolve carry-forward: uploads win; carried slots copy the previous
        // version's row (same r2_key — §5 version semantics).
        const uploadKinds = new Set(input.uploads.map((u) => u.kind));
        const resolved: Array<
          | { source: "upload"; claim: FileClaim }
          | { source: "carry"; file: (typeof previousFiles)[number] }
        > = input.uploads.map((claim) => ({ source: "upload", claim }));
        for (const kind of input.carryForwardKinds) {
          if (uploadKinds.has(kind)) continue; // an upload replaces the slot
          const prev = previousByKind.get(kind);
          if (!prev) {
            return fail(400, "A carried-forward file no longer exists on this project.");
          }
          resolved.push({ source: "carry", file: prev });
        }

        const resolvedKinds = resolved.map((r) =>
          r.source === "upload" ? r.claim.kind : (r.file.kind as UploadKind),
        );
        const validity = validateVersionFileSet(resolvedKinds);
        if (!validity.ok) return fail(400, validity.message);

        const versionNumber = currentVersion.versionNumber + 1;
        const headCheck = await verifyUploads(
          input.uploads,
          projectId,
          `projects/${projectId}/v${versionNumber}/`,
        );
        if (!headCheck.ok) return fail(400, headCheck.message);

        // Routing rule input: compare artwork keys across versions.
        const prevArtwork: Partial<Record<UploadKind, string>> = {};
        for (const f of previousFiles) {
          prevArtwork[f.kind as UploadKind] = f.r2Key;
        }
        const nextArtwork: Partial<Record<UploadKind, string>> = {};
        for (const r of resolved) {
          if (r.source === "upload") nextArtwork[r.claim.kind] = r.claim.r2Key;
          else nextArtwork[r.file.kind as UploadKind] = r.file.r2Key;
        }
        const artworkChanged = computeArtworkChanged(prevArtwork, nextArtwork);

        // §5: at least one changed field/file or a non-empty vendor note.
        const vendorNote = input.vendorNote?.trim() ? input.vendorNote.trim() : null;
        const previousContacts = await tx
          .select()
          .from(contactsTable)
          .where(eq(contactsTable.projectId, projectId))
          .orderBy(asc(contactsTable.role));
        const fieldsChanged = hasFieldChanges(project, input.project);
        const contactsChanged = hasContactChanges(previousContacts, input.contacts);
        const filesChanged =
          artworkChanged ||
          previousByKind.get("invoice")?.r2Key !== nextArtworkInvoiceKey(resolved);
        if (!fieldsChanged && !contactsChanged && !filesChanged && !vendorNote) {
          return fail(
            400,
            "Nothing changed — update a field or file, or add a note for the reviewers.",
          );
        }

        const result = transition(
          {
            status: project.status,
            changesRequestedFrom: project.changesRequestedFrom,
          },
          { kind: "vendor_resubmit", artworkChanged },
        );
        if (!result.ok) return fail(409, result.message);

        const [newVersion] = await tx
          .insert(submissionVersions)
          .values({ projectId, versionNumber, vendorNote })
          .returning({ id: submissionVersions.id });
        const newVersionId = newVersion!.id;

        await tx.insert(filesTable).values(
          resolved.map((r) =>
            r.source === "upload"
              ? {
                  versionId: newVersionId,
                  projectId,
                  kind: r.claim.kind,
                  r2Key: r.claim.r2Key,
                  originalFilename: r.claim.originalFilename,
                  contentType: r.claim.contentType,
                  sizeBytes: r.claim.sizeBytes,
                  widthPx: r.claim.widthPx ?? null,
                  heightPx: r.claim.heightPx ?? null,
                }
              : {
                  versionId: newVersionId,
                  projectId,
                  kind: r.file.kind,
                  r2Key: r.file.r2Key,
                  originalFilename: r.file.originalFilename,
                  contentType: r.file.contentType,
                  sizeBytes: r.file.sizeBytes,
                  widthPx: r.file.widthPx,
                  heightPx: r.file.heightPx,
                },
          ),
        );

        await syncContacts(tx, projectId, previousContacts, input.contacts);

        await tx
          .update(projects)
          .set({
            ...projectValues(input.project),
            status: result.state.status,
            changesRequestedFrom: result.state.changesRequestedFrom,
            statusChangedAt: new Date(),
            currentVersionId: newVersionId,
            updatedAt: new Date(),
          })
          .where(eq(projects.id, projectId));

        for (const u of input.uploads) {
          await logEvent(tx, {
            projectId,
            actor: "vendor",
            eventType: "file.uploaded",
            payload: { kind: u.kind, r2Key: u.r2Key, sizeBytes: u.sizeBytes },
          });
        }
        await logEvent(tx, {
          projectId,
          actor: "vendor",
          eventType: "version.submitted",
          payload: { versionNumber, artworkChanged, vendorNote },
        });
        await logEvent(tx, {
          projectId,
          actor: "vendor",
          eventType: "status.changed",
          payload: { from: project.status, to: result.state.status },
        });

        return {
          ok: true,
          value: {
            projectId,
            versionNumber,
            newStatus: result.state.status,
            artworkChanged,
            vendorNote,
          },
        };
      },
    );
    return outcome;
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Concurrent resubmission slipped past the lock ordering (same version
      // number twice) — surface the same clean conflict message.
      return fail(409, "This project has already moved forward. Reload to see its current state.");
    }
    throw err;
  }
}

function nextArtworkInvoiceKey(
  resolved: Array<
    | { source: "upload"; claim: FileClaim }
    | { source: "carry"; file: { kind: string; r2Key: string } }
  >,
): string | undefined {
  for (const r of resolved) {
    if (r.source === "upload" && r.claim.kind === "invoice") return r.claim.r2Key;
    if (r.source === "carry" && r.file.kind === "invoice") return r.file.r2Key;
  }
  return undefined;
}

function hasFieldChanges(
  current: {
    candidateSupported: string;
    description: string;
    office: string;
    districtDetail: string | null;
    pieceCount: number;
    totalCostCents: number;
    postOfficeLocation: string;
    permitNumber: string;
    mailDate: string;
  },
  next: ProjectFields,
): boolean {
  const nextDistrict = next.districtDetail?.trim() ? next.districtDetail.trim() : null;
  return (
    current.candidateSupported !== next.candidateSupported ||
    current.description !== next.description ||
    current.office !== next.office ||
    current.districtDetail !== nextDistrict ||
    current.pieceCount !== next.pieceCount ||
    current.totalCostCents !== next.totalCostCents ||
    current.postOfficeLocation !== next.postOfficeLocation ||
    current.permitNumber !== next.permitNumber ||
    current.mailDate !== next.mailDate
  );
}

function hasContactChanges(
  previous: Array<{
    role: string;
    orgName: string;
    contactName: string;
    email: string;
    phone: string | null;
    paidByKdp: boolean;
    isPrimary: boolean;
  }>,
  next: ContactInput[],
): boolean {
  if (previous.length !== next.length) return true;
  const prevByRole = new Map(previous.map((c) => [c.role, c]));
  for (const c of next) {
    const prev = prevByRole.get(c.role);
    if (!prev) return true;
    const phone = c.phone?.trim() ? c.phone.trim() : null;
    if (
      prev.orgName !== c.orgName ||
      prev.contactName !== c.contactName ||
      prev.email !== c.email.toLowerCase() ||
      prev.phone !== phone ||
      prev.paidByKdp !== c.paidByKdp ||
      prev.isPrimary !== c.isPrimary
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Update contacts in place, preserving admin payment data (paid_at,
 * paid_marked_by) for roles that remain; drop removed roles; add new ones.
 */
async function syncContacts(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  projectId: string,
  previous: Array<{ id: string; role: string }>,
  next: ContactInput[],
): Promise<void> {
  const nextRoles = new Set(next.map((c) => c.role));
  for (const prev of previous) {
    if (!nextRoles.has(prev.role as ContactInput["role"])) {
      await tx.delete(contactsTable).where(eq(contactsTable.id, prev.id));
    }
  }
  for (const c of next) {
    const values = {
      orgName: c.orgName,
      contactName: c.contactName,
      email: c.email.toLowerCase(),
      phone: c.phone?.trim() ? c.phone.trim() : null,
      paidByKdp: c.paidByKdp,
      isPrimary: c.isPrimary,
    };
    const existing = previous.find((p) => p.role === c.role);
    if (existing) {
      await tx
        .update(contactsTable)
        .set(values)
        .where(eq(contactsTable.id, existing.id));
    } else {
      await tx
        .insert(contactsTable)
        .values({ projectId, role: c.role, ...values });
    }
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}

// ---------------------------------------------------------------------------
// Vendor status page data (SPEC §8, /p/{token})
// ---------------------------------------------------------------------------

export type VendorProjectView = {
  project: typeof projects.$inferSelect;
  contacts: Array<typeof contactsTable.$inferSelect>;
  versions: Array<
    typeof submissionVersions.$inferSelect & {
      files: Array<typeof filesTable.$inferSelect>;
    }
  >;
  /** Review that bounced the current version (while changes_requested). */
  bounceReview: typeof stageReviews.$inferSelect | null;
  /** Denying review of the current version (while denied). */
  denialReview: typeof stageReviews.$inferSelect | null;
};

export async function getVendorProjectView(
  rawToken: string,
): Promise<VendorProjectView | null> {
  const tokenHash = hashVendorToken(rawToken);
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.vendorTokenHash, tokenHash));
  if (!project) return null;

  const projectContacts = await db
    .select()
    .from(contactsTable)
    .where(eq(contactsTable.projectId, project.id))
    .orderBy(asc(contactsTable.role));

  const versions = await db
    .select()
    .from(submissionVersions)
    .where(eq(submissionVersions.projectId, project.id))
    .orderBy(desc(submissionVersions.versionNumber));
  const allFiles = await db
    .select()
    .from(filesTable)
    .where(eq(filesTable.projectId, project.id));
  const versionsWithFiles = versions.map((v) => ({
    ...v,
    files: allFiles.filter((f) => f.versionId === v.id),
  }));

  let bounceReview: typeof stageReviews.$inferSelect | null = null;
  let denialReview: typeof stageReviews.$inferSelect | null = null;
  if (project.currentVersionId) {
    if (
      project.status === "changes_requested" &&
      project.changesRequestedFrom
    ) {
      const [row] = await db
        .select()
        .from(stageReviews)
        .where(
          and(
            eq(stageReviews.versionId, project.currentVersionId),
            eq(stageReviews.stage, project.changesRequestedFrom as ReviewStage),
            eq(stageReviews.decision, "changes_requested"),
          ),
        );
      bounceReview = row ?? null;
    }
    if (project.status === "denied") {
      const [row] = await db
        .select()
        .from(stageReviews)
        .where(
          and(
            eq(stageReviews.versionId, project.currentVersionId),
            eq(stageReviews.decision, "denied"),
          ),
        );
      denialReview = row ?? null;
    }
  }

  return {
    project,
    contacts: projectContacts,
    versions: versionsWithFiles,
    bounceReview,
    denialReview,
  };
}
