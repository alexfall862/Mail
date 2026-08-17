/**
 * Database schema — SPEC.md §4 is the source of truth for shape, constraints,
 * and defaults. One deliberate deviation, recorded in DECISIONS.md: files.r2_key
 * is NOT globally unique, because §5's carry-forward rule requires multiple
 * files rows (across versions of one project) to point at the same r2_key.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export const officeType = pgEnum("office_type", [
  "us_senate",
  "us_house",
  "governor",
  "secretary_of_state",
  "attorney_general",
  "state_treasurer",
  "insurance_commissioner",
  "state_board_of_education",
  "state_senate",
  "state_house",
  "county_party",
  "municipal_county_office",
  "other",
]);

export const projectStatus = pgEnum("project_status", [
  "submitted",
  "content_review",
  "campaign_review",
  "legal_review",
  "final_review",
  "changes_requested",
  "approved",
  "denied",
]);

export const vendorRole = pgEnum("vendor_role", [
  "designer_consultant",
  "print_shop",
  "mail_house",
]);

export const fileKind = pgEnum("file_kind", [
  "artwork_front",
  "artwork_back",
  "artwork_combined",
  "invoice",
]);

export const actorType = pgEnum("actor_type", [
  "admin",
  "vendor",
  "system",
  "reviewer",
]);

export const reviewInviteRole = pgEnum("review_invite_role", [
  "outside_reviewer",
  "campaign_contact",
]);

export const admins = pgTable("admins", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(), // argon2id
  isSuperuser: boolean("is_superuser").notNull().default(false),
  mustChangePassword: boolean("must_change_password").notNull().default(true),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => admins.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("idx_sessions_admin").on(table.adminId)],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    candidateSupported: text("candidate_supported").notNull(),
    description: text("description").notNull(),
    office: officeType("office").notNull(),
    // Free text: district/county; REQUIRED in app when office='other' (and per §9,
    // for state_senate, state_house, county_party, municipal_county_office).
    districtDetail: text("district_detail"),
    pieceCount: integer("piece_count").notNull(),
    totalCostCents: bigint("total_cost_cents", { mode: "number" }).notNull(),
    postOfficeLocation: text("post_office_location").notNull(),
    permitNumber: text("permit_number").notNull(),
    mailDate: date("mail_date").notNull(),

    // Campaign contact point (post-spec amendment, 2026-08-14): who at the
    // campaign signs off during campaign review. Default '' covers rows
    // predating the column; the app requires name + email on submission.
    campaignContactName: text("campaign_contact_name").notNull().default(""),
    campaignContactEmail: text("campaign_contact_email").notNull().default(""),
    campaignContactPhone: text("campaign_contact_phone"),

    status: projectStatus("status").notNull().default("submitted"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Non-null only while status='changes_requested'.
    changesRequestedFrom: projectStatus("changes_requested_from"),

    currentVersionId: uuid("current_version_id").references(
      (): AnyPgColumn => submissionVersions.id,
    ),
    vendorTokenHash: text("vendor_token_hash").notNull(), // sha256(raw magic-link token)
    // AES-256-GCM(raw token), key derived from env secrets — §12 requires the
    // magic link in every vendor email, which hash-only storage can't provide
    // (see DECISIONS.md). Lookups always use the hash.
    vendorTokenEncrypted: text("vendor_token_encrypted"),
    tokenRotatedAt: timestamp("token_rotated_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("projects_piece_count_check", sql`${table.pieceCount} > 0`),
    check("projects_total_cost_cents_check", sql`${table.totalCostCents} >= 0`),
    index("idx_projects_status").on(table.status),
    index("idx_projects_mail_date").on(table.mailDate),
  ],
);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    role: vendorRole("role").notNull(),
    orgName: text("org_name").notNull(),
    contactName: text("contact_name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    paidByKdp: boolean("paid_by_kdp").notNull().default(false),
    paidAt: timestamp("paid_at", { withTimezone: true }), // null = unpaid
    paidMarkedBy: uuid("paid_marked_by").references(() => admins.id),
    isPrimary: boolean("is_primary").notNull().default(false), // receives state-change emails
  },
  (table) => [unique().on(table.projectId, table.role)],
);

export const submissionVersions = pgTable(
  "submission_versions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    vendorNote: text("vendor_note"),
  },
  (table) => [unique().on(table.projectId, table.versionNumber)],
);

export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    versionId: uuid("version_id")
      .notNull()
      .references(() => submissionVersions.id, { onDelete: "cascade" }),
    // Denormalized for purge.
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: fileKind("kind").notNull(),
    // Not globally unique: carry-forward (§5) shares one key across versions.
    r2Key: text("r2_key").notNull(),
    originalFilename: text("original_filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    widthPx: integer("width_px"), // null for invoices
    heightPx: integer("height_px"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique().on(table.versionId, table.kind),
    index("idx_files_project").on(table.projectId),
  ],
);

export const stageReviews = pgTable(
  "stage_reviews",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    versionId: uuid("version_id")
      .notNull()
      .references(() => submissionVersions.id),
    // content_review | legal_review | final_review only (enforced in app code).
    stage: projectStatus("stage").notNull(),
    decision: text("decision").notNull(),
    checklist: jsonb("checklist").notNull().default(sql`'{}'::jsonb`),
    notes: text("notes"),
    reviewerId: uuid("reviewer_id")
      .notNull()
      .references(() => admins.id),
    decidedAt: timestamp("decided_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "stage_reviews_decision_check",
      sql`${table.decision} in ('advanced','changes_requested','denied')`,
    ),
    // One decision per stage per version.
    unique().on(table.versionId, table.stage),
    index("idx_reviews_project").on(table.projectId, table.decidedAt),
  ],
);

/**
 * Per-recipient review magic links (post-spec amendment, 2026-08-17). One row
 * per (recipient, stage) send; re-sending revokes the prior invite for the
 * same recipient+stage and issues a fresh token. A link is usable only while
 * the project still sits at the invite's stage (checked at read/submit time,
 * not via a revocation sweep), so feedback can never race a stage change.
 * Raw tokens are never stored — sha256 only, like the vendor token.
 */
export const reviewInvites = pgTable(
  "review_invites",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Review stages only (enforced in app code, like stage_reviews.stage).
    stage: projectStatus("stage").notNull(),
    role: reviewInviteRole("role").notNull(),
    recipientEmail: text("recipient_email").notNull(),
    recipientName: text("recipient_name").notNull().default(""),
    tokenHash: text("token_hash").notNull().unique(), // sha256(raw)
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }), // superseded by a re-send
  },
  (table) => [index("idx_review_invites_project").on(table.projectId)],
);

/** What an invited reviewer entered on their review page. One response per
 * invite per version (they may revise it while the stage is still open). */
export const reviewResponses = pgTable(
  "review_responses",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    inviteId: uuid("invite_id")
      .notNull()
      .references(() => reviewInvites.id, { onDelete: "cascade" }),
    // Denormalized for the admin feedback panel, like files.project_id.
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    versionId: uuid("version_id")
      .notNull()
      .references(() => submissionVersions.id, { onDelete: "cascade" }),
    decision: text("decision").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "review_responses_decision_check",
      sql`${table.decision} in ('approved','issues')`,
    ),
    unique().on(table.inviteId, table.versionId),
    index("idx_review_responses_project").on(table.projectId),
  ],
);

export const events = pgTable(
  "events",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    // §4 declares NOT NULL, but the required admin.login / admin.created /
    // admin.deactivated events have no project — nullable (see DECISIONS.md).
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    actor: actorType("actor").notNull(),
    actorId: uuid("actor_id"), // admin id or null
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("idx_events_project").on(table.projectId, table.createdAt)],
);

export const deletedProjects = pgTable("deleted_projects", {
  id: uuid("id").primaryKey(), // original project id
  candidateSupported: text("candidate_supported").notNull(),
  office: officeType("office").notNull(),
  mailDate: date("mail_date").notNull(),
  finalStatus: projectStatus("final_status").notNull(), // status at deletion time
  totalCostCents: bigint("total_cost_cents", { mode: "number" }).notNull(),
  deletedBy: uuid("deleted_by")
    .notNull()
    .references(() => admins.id),
  deletedAt: timestamp("deleted_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
