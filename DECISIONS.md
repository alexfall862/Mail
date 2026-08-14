# Implementation decisions

## Post-spec amendments (requested 2026-08-14)

- **AI pre-check (advisory)**: on submission (post-response via Next's `after()`, so the vendor isn't delayed) and manually re-runnable during content review, `gpt-4.1` reviews the artwork via presigned GET URLs (bytes never transit the app server, §3 preserved) for three things: claims-with-citations (citations transcribed with click-to-search links), the "Paid for by Kansas Democratic Party" disclaimer, and spelling/grammar. Results/failures are `ai_review.*` events rendered as an advisory panel on the ticket; it never gates a transition. New optional env var `OPENAI_API_KEY` (§14 addition); `scripts/ai-review-smoke.ts` verifies the integration end to end.

- **Campaign Review stage** inserted between Content Review and Legal Review (pipeline: submitted → content → campaign → legal → final → approved). It behaves like every other review stage: advance / request changes / deny, one decision per stage per version, and the §5 resubmission routing rule unchanged (artwork change → content_review; otherwise back to the kicking stage, which can now be campaign_review). Advisory checklist keys: `campaign_signoff`, `contact_confirmed`, `messaging_accurate` (adjustable in `src/lib/checklists.ts`).
- **Campaign contact fields** on the project: `campaign_contact_name` (required), `campaign_contact_email` (required), `campaign_contact_phone` (optional) — collected on the submission form, editable on resubmission, shown on the admin project page, included in CSV export. The campaign contact receives no system emails (informational only — say the word if they should be notified at campaign review).

Minor choices the spec leaves open, one line each. Anything marked ⚠ is a spec
contradiction resolved by the implementer — flagged for explicit review.

## Phase 1 — Foundation

- ⚠ **Dropped the global `unique` on `files.r2_key`** (kept `unique (version_id, kind)`): §4 declares it, but §5's carry-forward rule explicitly requires multiple `files` rows across versions of a project to point at the same `r2_key`, and §5 justifies key-sharing for purge safety. §5's observable behavior wins; revert by copying R2 objects to new keys on carry-forward if preferred.
- Scaffolded Next.js manually (create-next-app refuses a directory containing SPEC.md); `src/` layout with `@/*` → `src/*` alias.
- Postgres driver: `pg` (node-postgres) with `drizzle-orm/node-postgres`; pool capped at 5 connections.
- No ESLint (spec is silent; TypeScript strict + tests are the quality gate).
- Zod v4, Tailwind v4 (via `@tailwindcss/postcss`), Vitest for tests, `tsx` for scripts.
- FK constraint on `projects.current_version_id` is auto-named by drizzle-kit (`projects_current_version_id_submission_versions_id_fk`) instead of §4's `fk_current_version`; shape and behavior identical.
- `stage_reviews.stage` restricted to the three review stages in app code only (§4 comments the restriction but defines no DB check).
- Seed superuser's `name` is "Superuser" (spec specifies only email/password).
- Money columns (`total_cost_cents`, `size_bytes`) use JS `number` mode (safe well past any realistic value).
- Local dev Postgres: `postgres:16` on port 5432, db `kdp_mail`, creds postgres/postgres.

## Phase 3 — Auth

- ⚠ **`events.project_id` made nullable** (§4 says NOT NULL): the required minimum event set includes `admin.login`, `admin.created`, `admin.deactivated`, which have no project to reference. Project-scoped events always set it; the §4 indexes are unchanged.
- Session cookie is named `kdp_session`; fixed 30-day expiry (no sliding renewal — spec says "30-day expiry").
- Emails are normalized lowercase/trimmed for admin lookup; login verifies against a dummy argon2 hash when the email is unknown so response timing doesn't reveal account existence.
- Changing one's own password deletes the admin's *other* sessions (current one stays); spec is silent.
- Middleware redirects unauthenticated `/admin` requests by cookie presence; every admin page/API additionally does full DB session validation (`requireAdmin`) — the middleware is UX, the DB check is the security boundary.
- Forced password change is enforced in the protected admin layout (redirect to `/admin/settings/password` until cleared); the password page lives in a sibling route group so it's reachable while forced.

## Phase 4 — Upload pipeline

- Turnstile tokens are single-use, so the public flow verifies Turnstile once at the first presign; the HMAC-signed draft project-id token it returns then authenticates the rest of that form session (later presigns + final submit). Bots can't reach submit without a Turnstile pass.
- Draft-token HMAC key is derived (sha256) from `R2_SECRET_ACCESS_KEY` + `TURNSTILE_SECRET_KEY` — §14 defines no separate app secret and its list is fixed. Tokens expire after 24 h; rotating either secret invalidates in-flight drafts (acceptable).
- Artwork at rest is always the client pipeline's JPEG, so presign only allows `image/jpeg` for artwork kinds (inputs may be JPEG/PNG/WebP/PDF, but those are consumed in-browser).
- Resubmission presigns require status `changes_requested` and only sign keys under the *next* version's prefix — existing objects can never be overwritten via presign.

## Phase 5 — Vendor surface

- "Today" for the mail-date rule is computed in America/Chicago; the rule also applies on resubmission (a stale past mail date must be updated to resubmit).
- Contacts are editable on resubmission (per §5's "contacts" in the routing rule); admin payment data (`paid_at`, `paid_marked_by`) is preserved for roles that remain, removed roles are deleted, new roles added.
- `version.submitted` is logged for v1 as well as resubmissions; the v1 flow also logs `project.created`, per-file `file.uploaded`, and the automatic `status.changed`.
- The submission response body contains no magic link (it's emailed only); `/submit/success` says so. `/p/{token}` pages send `robots: noindex`.
- Combined-mode "keep current artwork" on resubmit carries forward whatever artwork kinds the current version holds (an auto-split PDF's front/back carry as front/back).
- Vendor status page also links nothing for invoices (spec lists artwork thumbnails only); invoice presence is visible in version history filenames only via the resubmit form's "keep current file" hints.

## Phase 6 — Admin surface

- Review notes are required for "Request changes" and "Deny" (the vendor receives them verbatim per §12); optional for "Advance".
- CSV `?year=` filters by mail-date year (the operative campaign year), for live rows and tombstones alike.
- New/reset admin accounts get a server-generated 16-char temp password shown once to the superuser (§7 says "create with temp password" without specifying who picks it); reset and deactivate both end the target's sessions. Reactivation added as the undo for deactivation.
- Admin project page links the current invoice via presigned GET (the final-review "costs match invoice" checklist needs it; §6 lists artwork display only).
- A superuser can't deactivate their own account.
- Deny asks for a browser confirm() since it's terminal.

## Phase 7 — Emails

- ⚠ **Added `projects.vendor_token_encrypted`** (nullable, AES-256-GCM, key derived from `R2_SECRET_ACCESS_KEY`+`TURNSTILE_SECRET_KEY`): §12 requires the magic link in every vendor email, including ones sent long after creation, but §7/§4 keep only `sha256(token)` — the link is otherwise unreconstructable. Lookups still use the hash; a DB-only leak still reveals nothing; raw tokens are still never logged. If the derived key ever changes, links vanish from emails until an admin regenerates the link (a console warning notes this).
- §5 row 10 requires "email admins" on reopen but §12's template list has no reopen template — added an internal `admin_reopened` template (9th) alongside the 8 spec ones.
- If `RESEND_API_KEY` is unset (local dev), sends are recorded as `email.failed` events with the config error — visible in the project event timeline rather than silently skipped.
- Emails to vendors go to de-duplicated `is_primary` contact addresses; the events payload records template + recipients + Resend id (never URLs or tokens).

## Phase 2 — State machine

- After a superuser reopen (approved → final_review), the current version may already hold a final_review decision; re-deciding will upsert that `stage_reviews` row (the `unique (version_id, stage)` constraint stays intact, latest decision wins, and the full history remains in `events`). The spec doesn't address this corner.
- Transition errors are typed (`invalid_transition` / `invalid_state` / `not_superuser` / `reason_required`); the concurrent-click loser message is "This project has already moved to {status label}."
- Status labels centralized in the state machine module (`submitted` renders as "Received", per §8's vendor timeline).
