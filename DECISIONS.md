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
