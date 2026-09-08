# KDP Mail Approval System — Build Specification

Audience: an LLM coding agent implementing this system end-to-end. All decisions in this
document are final unless marked as a judgment call. Do not substitute alternative
architectures, storage patterns, or auth schemes.

---

## 1. Purpose

A web application for the Kansas Democratic Party (KDP) to intake, review, and approve
political mail piece submissions from vendors/print shops, replacing a Google Form +
email workflow. Core requirements:

- Public submission form (no vendor accounts — access via per-project magic link).
- Admin-side multi-stage review pipeline: Content Review → Legal Review → Final Review.
- Artwork review images stored cheaply (downscaled client-side; originals never uploaded).
- Vendors can check status and resubmit revisions via their magic link without contacting KDP.
- Email notifications on every state change.
- Full audit trail; admin-initiated full project deletion (with tombstone).
- Vendor payment tracking (which vendors KDP owes, and whether they've been paid).
- ~100 submissions/year. Optimize for low, predictable hosting cost, not scale.

## 2. Stack (final decision)

| Layer | Choice | Notes |
|---|---|---|
| Framework | **Next.js 15+ (App Router), TypeScript** | One deployable service: public pages, admin UI, and API routes together |
| Runtime | Node 20+ on **Railway** | Single service, hobby-tier sized |
| Database | **PostgreSQL on Railway** | Managed, small instance |
| ORM/migrations | **Drizzle ORM + drizzle-kit** | Schema below must be expressed in Drizzle; SQL shown is the source of truth for shape |
| Object storage | **Cloudflare R2** (S3-compatible, private bucket) | Via `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` |
| Email | **Resend** (`resend` SDK) | Plain HTML templates in-repo; no react-email dependency required |
| Bot protection | **Cloudflare Turnstile** | On the public submission form and admin login |
| Password hashing | **argon2id** via `@node-rs/argon2` | Never bcrypt defaults, never custom |
| Validation | **Zod** on every API boundary | Shared schemas between client and server |
| Styling | **Tailwind CSS** | Functional, clean; no component library required |
| Client PDF rendering | **pdfjs-dist** | Rasterize PDF artwork to images in-browser |
| Client image downscale | Canvas-based (see §6) | `browser-image-compression` acceptable as helper |

Rationale (for context, not reconsideration): a single Next.js service keeps Railway
billing to one small container; the JS ecosystem has first-class libraries for every
piece of this (presigned S3 uploads, pdf.js in-browser rasterization, canvas resizing),
which is precisely the functionality this project hinges on.

## 3. Architecture rules (cost-critical — do not violate)

1. **Artwork bytes never pass through the Railway app.** Uploads: browser downscales →
   browser PUTs directly to R2 via presigned URL. Downloads/review: browser GETs via
   short-lived presigned URL. The app only mints URLs and records metadata.
2. **Originals are never uploaded.** Client-side pipeline (§6) reduces artwork to review
   fidelity before upload. Server rejects artwork uploads over the size cap.
3. No image processing on the server. No sharp, no ImageMagick, no ffmpeg.
4. No background job system. Everything (emails, purges) runs inline in the request;
   at this volume that is fine. Email sends must not fail the transaction — send after
   commit, log failures as events.
5. Private R2 bucket. No public bucket access; all reads presigned (10-minute expiry).

## 4. Database schema

Implement in Drizzle; this SQL defines the required shape, constraints, and defaults.

```sql
create type office_type as enum (
  'us_senate','governor','secretary_of_state','attorney_general',
  'state_treasurer','insurance_commissioner','state_board_of_education',
  'state_senate','state_house','county_party','municipal_county_office','other'
);

create type project_status as enum (
  'submitted','content_review','legal_review','final_review',
  'changes_requested','approved','denied'
);

create type vendor_role as enum ('designer_consultant','print_shop','mail_house');
create type file_kind as enum ('artwork_front','artwork_back','artwork_combined','invoice');
create type actor_type as enum ('admin','vendor','system');

create table admins (
  id                   uuid primary key default gen_random_uuid(),
  email                text not null unique,
  name                 text not null,
  password_hash        text not null,               -- argon2id
  is_superuser         boolean not null default false,
  must_change_password boolean not null default true,
  active               boolean not null default true,
  created_at           timestamptz not null default now()
);

create table sessions (
  id         uuid primary key default gen_random_uuid(),
  admin_id   uuid not null references admins(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table projects (
  id                   uuid primary key default gen_random_uuid(),
  candidate_supported  text not null,
  description          text not null,
  citations_and_claims text,          -- optional: links/notes supporting claims in the piece
  office               office_type not null,
  district_detail      text,          -- free text: district/county; REQUIRED in app when office='other'
  piece_count          integer not null check (piece_count > 0),
  total_cost_cents     bigint not null check (total_cost_cents >= 0),
  post_office_location text not null,
  permit_number        text not null,
  mail_date            date not null,

  status                 project_status not null default 'submitted',
  status_changed_at      timestamptz not null default now(),
  changes_requested_from project_status,   -- non-null only while status='changes_requested'

  current_version_id   uuid,               -- FK added below
  vendor_token_hash    text not null,      -- sha256(raw magic-link token)
  token_rotated_at     timestamptz,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table contacts (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references projects(id) on delete cascade,
  role           vendor_role not null,
  org_name       text not null,
  contact_name   text not null,
  email          text not null,
  phone          text,
  paid_by_kdp    boolean not null default false,
  paid_at        timestamptz,                        -- null = unpaid
  paid_marked_by uuid references admins(id),
  is_primary     boolean not null default false,     -- receives state-change emails
  unique (project_id, role)
);

create table submission_versions (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references projects(id) on delete cascade,
  version_number integer not null,
  submitted_at   timestamptz not null default now(),
  vendor_note    text,
  unique (project_id, version_number)
);

alter table projects
  add constraint fk_current_version
  foreign key (current_version_id) references submission_versions(id);

create table files (
  id                uuid primary key default gen_random_uuid(),
  version_id        uuid not null references submission_versions(id) on delete cascade,
  project_id        uuid not null references projects(id) on delete cascade, -- denormalized for purge
  kind              file_kind not null,
  r2_key            text not null unique,
  original_filename text not null,
  content_type      text not null,
  size_bytes        bigint not null,
  width_px          integer,      -- null for invoices
  height_px         integer,
  uploaded_at       timestamptz not null default now(),
  unique (version_id, kind)
);

create table stage_reviews (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  version_id  uuid not null references submission_versions(id),
  stage       project_status not null,  -- content_review | legal_review | final_review only
  decision    text not null check (decision in ('advanced','changes_requested','denied')),
  checklist   jsonb not null default '{}'::jsonb,
  notes       text,
  reviewer_id uuid not null references admins(id),
  decided_at  timestamptz not null default now(),
  unique (version_id, stage)            -- one decision per stage per version
);

create table events (
  id         bigint generated always as identity primary key,
  project_id uuid not null references projects(id) on delete cascade,
  actor      actor_type not null,
  actor_id   uuid,                      -- admin id or null
  event_type text not null,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table deleted_projects (
  id                  uuid primary key,          -- original project id
  candidate_supported text not null,
  office              office_type not null,
  mail_date           date not null,
  final_status        project_status not null,   -- status at deletion time
  total_cost_cents    bigint not null,
  deleted_by          uuid not null references admins(id),
  deleted_at          timestamptz not null default now()
);

create index idx_projects_status    on projects(status);
create index idx_projects_mail_date on projects(mail_date);
create index idx_events_project     on events(project_id, created_at);
create index idx_files_project      on files(project_id);
create index idx_reviews_project    on stage_reviews(project_id, decided_at);
create index idx_sessions_admin     on sessions(admin_id);
```

Event types (minimum set): `project.created`, `status.changed`, `version.submitted`,
`review.decided`, `email.sent`, `email.failed`, `token.rotated`, `file.uploaded`,
`contact.paid`, `contact.unpaid`, `project.reopened`, `admin.login`, `admin.created`,
`admin.deactivated`. Payloads include enough to reconstruct the action (old/new status,
template + recipient for emails, etc.).

### Derived values

- **Fully paid**: every contact with `paid_by_kdp = true` has non-null `paid_at`.
  Show as a badge (e.g. "2/3 paid") on the admin dashboard; include per-role paid dates
  and a `fully_paid` boolean in CSV export. Payment state is orthogonal to review status.

### Seed

Migration seeds one superuser from env: `SEED_SUPERUSER_EMAIL` (alex@kansasdems.org) +
`SEED_SUPERUSER_PASSWORD`, with `must_change_password = true`. Idempotent (skip if exists).

## 5. State machine

Linear pipeline with kickback and terminal branches. Enforce server-side as a whitelist;
UI only reflects what the server allows.

```
submitted → content_review → legal_review → final_review → approved
              │ ▲               │ ▲             │
              ▼ │               ▼ │             ▼
            ┌───┴───────────────────┴──────────────┐
            │           changes_requested          │──(resubmit)──► routing rule
            └──────────────────────────────────────┘
            (each review stage may also → denied)
```

| # | From | To | Trigger | Actor | Side effects |
|---|------|----|---------|-------|--------------|
| 1 | — | submitted | Public form submit | vendor | Create project + version 1 + files; email vendor confirmation w/ magic link; email admins |
| 2 | submitted | content_review | Automatic, same transaction as creation | system | Event only. `submitted` exists so the vendor timeline shows "Received" |
| 3 | content_review | legal_review | Review decision `advanced` | admin | stage_reviews row; email primaries "passed content review" |
| 4 | legal_review | final_review | Review decision `advanced` | admin | Same pattern |
| 5 | final_review | approved | Review decision `advanced` | admin | Email primaries "approved — cleared to print". Terminal |
| 6 | content/legal/final review | changes_requested | Review decision `changes_requested` | admin | Set `changes_requested_from` = the stage; email primaries with review `notes` verbatim + magic link |
| 7 | changes_requested | (routing rule) | Vendor resubmits via magic link | vendor | New version; clear `changes_requested_from`; email admins "v{N} resubmitted" |
| 8 | content/legal/final review | denied | Review decision `denied` | admin | Email primaries with reason (`notes`). Terminal |
| 9 | any | (deleted) | Admin delete + typed confirmation | admin | §10 |
| 10 | approved or denied | final_review | Superuser "reopen" with required reason | superuser | Event `project.reopened` with reason; email admins |

### Resubmission routing rule (transition 7) — implement exactly

- If the new version changed **any artwork file** (`artwork_front`, `artwork_back`, or
  `artwork_combined` — including switching between separate and combined modes) → status
  becomes `content_review` (content approval is stale), regardless of which stage kicked
  it back.
- If **only non-artwork content** changed (invoice file, metadata fields, contacts, note)
  → status returns to `changes_requested_from`.

### Version semantics

- Resubmission form (magic link) is pre-filled with current values; **every file slot is
  optional** (artwork and invoice alike — omitted files carry forward); requires at least
  one changed field/file or a non-empty `vendor_note`; always creates a new version.
- Unchanged files **carry forward**: new `files` rows in the new version pointing at the
  same `r2_key`. Every version is self-contained. (Purge deletes by prefix, so shared
  keys within one project are safe.) In separate mode, front and back carry forward
  independently (vendor may replace only one side). Switching artwork mode requires
  supplying the complete new artwork set — no mixing a carried-forward front with a new
  combined file.
- `current_version_id` always points at the latest version.

### Guardrails

- No stage skipping. No fast-track.
- `unique (version_id, stage)` enforces one decision per stage per version.
- All transitions run in a transaction with `select … from projects where id=$1 for update`;
  a losing concurrent click gets a clean "project already moved to X" error, not a
  double transition or double email.
- Vendors can only act when status = `changes_requested` (resubmit) — otherwise their
  page is read-only. Admin review actions only valid for the project's current stage.

## 6. File upload pipeline

### Client side (public form and resubmission form)

**Artwork mode toggle** (per version): "Separate front/back files" or "Single combined
file". Accepted inputs per slot (all artwork accepts `image/jpeg, image/png, image/webp,
application/pdf`):

- Separate mode: `artwork_front` + `artwork_back`, both required on v1; on resubmit each
  side independently optional (omitted = carry forward).
- Combined mode: one upload containing both sides. Handling depends on the file:
  - **Multi-page PDF (≥2 pages)**: auto-split — rasterize page 1 → stored as
    `artwork_front`, page 2 → stored as `artwork_back` (pages 3+ ignored with a visible
    note). The version ends up with front/back kinds even though the vendor uploaded one
    file; reviewers get the normal side-by-side view. Record the original filename on
    both rows.
  - **Single image or 1-page PDF**: stored as one `artwork_combined` file.
- `invoice` (required on v1; **optional on resubmit** — omitted = carry forward, same as
  artwork): accept `application/pdf, image/jpeg, image/png`.
  Stored as-is (invoices are small); enforce ≤ 10 MB client + server.

Version validity rule (enforce server-side on every submission): artwork present as
either (`artwork_front` AND `artwork_back`) or (`artwork_combined`) — never both sets,
never a partial set.

Artwork processing before upload (all in-browser):
1. If PDF: render the relevant page(s) with pdfjs-dist to canvas at a scale yielding
   the target long edge below. Separate-mode PDFs use page 1 only (note shown if >1 page).
2. If image: draw to canvas, downscale so long edge ≤ target (never upscale).
   Target long edge: **2500 px** for front/back/auto-split pages; **3500 px** for
   `artwork_combined` (a stacked two-sides-in-one image needs more pixels per side to
   remain reviewable).
3. Export canvas as **JPEG quality 0.85** (use white background fill first — PNGs with
   transparency must not turn black).
4. Record output width/height; reject if either dimension < 600 px ("image too small to
   review — please upload a larger file").
5. Result must be ≤ **8 MB** (it will be far under; this is a backstop).

Upload flow per file:
1. `POST /api/uploads/presign` with `{ kind, contentType, sizeBytes }` + auth context
   (Turnstile token on first submission; magic-link token on resubmission). Server
   validates type/size, generates the R2 key, returns `{ url, key }` (presigned PUT,
   10-min expiry, content-type and content-length conditions set).
2. Browser `PUT`s the blob to R2 with progress UI.
3. File metadata is included in the final form submission; server records `files` rows.

R2 key convention: `projects/{project_id}/v{version_number}/{kind}.{ext}`. For the
initial submission the project id is generated at presign time and threaded through
the form session (server issues a draft project id token; project row is only created
on successful final submit — orphaned R2 objects from abandoned forms are acceptable
and cleaned by the R2 lifecycle rule in the setup checklist).

### Server-side validation (never trust the client)

- Presign endpoint enforces content-type whitelist and size caps (8 MB artwork / 10 MB invoice).
- On final submit, server `HEAD`s each claimed R2 key to confirm existence, size, and
  content-type before creating rows.
- Rate limit presigns: 20/hour per IP.

### Review display

- Admin review page and vendor status page show artwork via presigned GET (10-min expiry),
  fetched on page load. Full-size in a zoomable lightbox; side-by-side "current vs previous
  version" toggle on the admin review screen. Versions with `artwork_combined` render as
  one full-width image (labeled "Front/Back combined"); version-compare must handle
  comparing across modes (e.g. v1 separate vs. v2 combined) by simply showing each
  version's artwork set as-is.

## 7. Auth

### Vendor: magic links

- Raw token: 32 bytes from `crypto.randomBytes`, base64url. Shown only in URLs/emails:
  `{APP_URL}/p/{token}`. DB stores `sha256(token)` in `projects.vendor_token_hash`.
- Lookup: hash presented token → find project. Constant-time compare not required
  (lookup is by hash), but tokens must never be logged.
- No expiry. Admin action "regenerate link" replaces the hash, stamps `token_rotated_at`,
  logs `token.rotated`, and emails primaries the new link.
- Rate limit token lookups: 30/min per IP (blunts brute force; 256-bit space makes it moot).

### Admin: password login

- `POST /api/admin/login` with email + password + Turnstile token. Verify argon2id.
  Rate limit: 5 attempts / 15 min per (IP, email). Log `admin.login` on success.
- Session: row in `sessions` (30-day expiry), id in an httpOnly, Secure, SameSite=Lax
  cookie. Middleware guards all `/admin` routes. Logout deletes the row.
- `must_change_password = true` → forced password-change screen before anything else.
  Minimum length 12; no other composition rules.
- Superuser-only screens: manage admins (create with temp password, deactivate —
  which also deletes their sessions —, reset password) and the reopen action (§5 #10).
- No self-signup, no password reset emails (superuser resets manually).

## 8. Routes / pages

### Public (vendor)

| Route | Purpose |
|---|---|
| `/` | Landing: short explanation + "Submit a mail piece" |
| `/submit` | Submission form (§9). Turnstile-gated |
| `/submit/success` | Confirmation; repeats that the magic link was emailed |
| `/p/{token}` | Project status page: timeline (Received ✓ → Content Review → Legal Review → Final Review → Approved), `changes_requested` rendered as an alert on the stage that bounced it with the review notes shown inline; denied shows reason; artwork thumbnails (current version), version history, mail date, and each vendor's own paid/unpaid status. When status = `changes_requested`: resubmission form inline |

### Admin (session-guarded)

| Route | Purpose |
|---|---|
| `/admin/login` | Login |
| `/admin` | Dashboard: table of projects, default sort by `mail_date` asc; columns: candidate, office, status, mail date, pieces, cost, paid badge; filter by status; **red flag on any non-terminal project with mail_date ≤ 10 days out** |
| `/admin/projects/{id}` | Project detail: all fields, contacts w/ paid checkboxes (visible only where `paid_by_kdp`), artwork viewer w/ version compare, version history, full event timeline, review panel for the current stage (checklist + notes + Advance / Request changes / Deny), regenerate link, delete |
| `/admin/export` | CSV export (§11) |
| `/admin/users` | Superuser only: admin management |
| `/admin/settings/password` | Change own password |

### Stage checklists (initial keys; stored in `stage_reviews.checklist`)

- `content_review`: `disclaimer_present` ("Paid for by" disclaimer correct), `union_bug`,
  `candidate_info_accurate`, `imagery_appropriate`
- `legal_review`: `disclaimer_compliant`, `permit_indicia_correct`, `funding_source_ok`
- `final_review`: `mail_date_feasible`, `costs_match_invoice`, `final_artwork_confirmed`

Checkboxes are advisory (not required to advance) but are stored with the decision.
Keys live in one config file so KDP can adjust between cycles without a migration.

## 9. Submission form fields

General: candidate_supported (text, req), description (textarea, req), citations_and_claims
(textarea, optional; links/notes supporting claims in the piece), office (select of
enum incl. "Other", req), district_detail (text; label "District / County / Specify office",
required when office = state_senate, state_house, county_party, municipal_county_office,
or other), piece_count (int > 0, req), total_cost (dollars input, stored as cents, req),
post_office_location (text, req), permit_number (text, req), mail_date (date, must be
today or later, req).

Vendors: three optional blocks (Designer/Consultant, Print Shop, Mail House), each with
org_name, contact_name, email, phone (opt), paid_by_kdp (checkbox, the "needs to be paid
by KDP" question), is_primary (checkbox "receive status emails"). Validation: at least
one contact block completed; at least one `is_primary` across contacts; every completed
block requires org, name, valid email.

Files: artwork mode toggle (separate front/back vs. single combined file) with the
corresponding upload slot(s) required, plus invoice (req) — all per §6.

Zod schema shared client/server; server re-validates everything.

## 10. Deletion (purge)

Admin clicks Delete → modal requires typing the candidate name → server, in order:
1. Insert `deleted_projects` tombstone (final_status = current status).
2. List and delete all R2 objects under prefix `projects/{id}/` (paginate; verify empty).
3. Delete the project row (cascades remove versions, files, contacts, reviews, events).
Wrap DB steps in a transaction; do R2 deletion first-attempt before the transaction and
retry/log if partial (an orphaned R2 object costs ~nothing; a dangling DB row is worse —
prefer completing the DB delete and logging any R2 leftovers to server logs).
No emails on delete.

## 11. CSV export

`GET /admin/export?status=&year=` → CSV, one row per project (including tombstones as
rows flagged `deleted=true` with their preserved columns): id, candidate, office,
district_detail, description, citations_and_claims, pieces, total_cost (dollars), mail_date, status,
status_changed_at, created_at, permit_number, post_office_location, then per role
(designer/print/mail): org, contact, email, paid_by_kdp, paid_at — plus `fully_paid`.
Excel-safe encoding (UTF-8 BOM), proper quoting.

## 12. Emails (Resend)

From: `KDP Mail Program <mail-approval@{domain}>`. All sends occur after DB commit;
each send logs `email.sent` (template, recipients, resend id) or `email.failed`.
Recipients: all `is_primary` contacts (vendor mails); all active admins (admin mails).

Templates (plain, mobile-friendly HTML + text part):
1. `vendor_confirmation` — submission received; includes magic link; "bookmark this".
2. `admin_new_submission` — candidate, office, mail date, link to admin page.
3. `vendor_stage_passed` — parameterized stage name.
4. `vendor_changes_requested` — stage, review notes verbatim, magic link, resubmit instructions.
5. `vendor_approved` — cleared to print.
6. `vendor_denied` — reason (notes).
7. `admin_resubmission` — version number, vendor note, link.
8. `vendor_link_regenerated` — new magic link, old link disabled.

Every vendor email footer: "Check status anytime: {magic link}". Never include the
magic link in admin emails.

## 13. Security requirements

- Turnstile verified server-side on: public submission, admin login.
- Rate limits (in-memory per-instance is acceptable at this scale): presign 20/hr/IP,
  submission 5/hr/IP, token lookup 30/min/IP, login 5/15min/(IP,email).
- All state-changing endpoints: POST with same-origin check (Origin header) — cookie
  auth for admin, token auth for vendor. No CSRF token machinery needed beyond that.
- Zod-validate every request body; never interpolate user input into SQL (Drizzle
  parameterizes) or HTML (React escapes; never `dangerouslySetInnerHTML` with user data —
  review notes render as plain text with line breaks).
- Secrets only via env vars. Never log tokens, passwords, or presigned URLs.
- HTTPS enforced (Railway provides TLS; redirect http→https, HSTS header).
- Security headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy:
  strict-origin-when-cross-origin`, a CSP allowing self + Turnstile + R2 presigned hosts.
- Uploaded files are never executed or transformed server-side; served only via
  presigned GET with correct content-type.

## 14. Environment variables

```
DATABASE_URL
APP_URL                      # e.g. https://mail.kansasdems.org
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET                    # kdp-mail-approval
RESEND_API_KEY
EMAIL_FROM                   # KDP Mail Program <mail-approval@kansasdems.org>
TURNSTILE_SITE_KEY           # public, used client-side
TURNSTILE_SECRET_KEY
SEED_SUPERUSER_EMAIL         # alex@kansasdems.org
SEED_SUPERUSER_PASSWORD      # temp; forced change on first login
```

## 15. Non-goals

No vendor accounts/passwords. No server-side image processing. No background workers or
queues. No multi-tenancy. No in-app chat (review notes + email are the feedback channel).
No payment processing (tracking only). No mobile app. No analytics beyond the events table.

## 16. Definition of done (agent checklist)

- [ ] Migrations produce the §4 schema; seed creates the superuser idempotently
- [ ] Submission flow: both artwork modes work (separate front/back; combined incl. multi-page-PDF auto-split) → downscale → presigned PUT → project + v1 + files created atomically → both confirmation emails sent; version validity rule enforced server-side
- [ ] State machine matches §5 table exactly, including routing rule, reopen, and row-lock concurrency behavior
- [ ] Vendor page: correct timeline rendering for every status, resubmission only when `changes_requested`, carry-forward for unchanged files
- [ ] Admin: dashboard (mail-date sort + ≤10-day flag), review panel with checklists, version compare, paid checkboxes, regenerate link, delete w/ tombstone + R2 prefix purge, CSV export, user management (superuser), forced password change
- [ ] All 8 email templates wired to their transitions; sends logged as events
- [ ] Rate limits, Turnstile verification, security headers in place
- [ ] README covering local dev (docker-compose Postgres), migration commands, and Railway deploy
