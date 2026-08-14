# Implementation decisions

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

## Phase 2 — State machine

- After a superuser reopen (approved → final_review), the current version may already hold a final_review decision; re-deciding will upsert that `stage_reviews` row (the `unique (version_id, stage)` constraint stays intact, latest decision wins, and the full history remains in `events`). The spec doesn't address this corner.
- Transition errors are typed (`invalid_transition` / `invalid_state` / `not_superuser` / `reason_required`); the concurrent-click loser message is "This project has already moved to {status label}."
- Status labels centralized in the state machine module (`submitted` renders as "Received", per §8's vendor timeline).
