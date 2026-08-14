# KDP Mail Approval

Mail-piece submission and approval system for the Kansas Democratic Party.
Vendors submit political mail through a public form and track review through a
private magic link; admins run a three-stage review pipeline (content → legal
→ final) with full audit trail, payment tracking, and CSV export.

Built to [SPEC.md](SPEC.md). Implementation choices the spec left open are
logged in [DECISIONS.md](DECISIONS.md); human setup tasks (Cloudflare, Resend,
Railway, DNS) are in [SETUP_CHECKLIST.md](SETUP_CHECKLIST.md).

## Stack

Next.js 15 (App Router, TypeScript strict) · Drizzle ORM + PostgreSQL ·
Cloudflare R2 via presigned URLs (artwork bytes never touch the server) ·
Resend · Cloudflare Turnstile · argon2id · Zod · Tailwind CSS · pdfjs-dist
(in-browser PDF rasterization). One deployable service, no queues, no
server-side image processing.

## Local development

Prerequisites: Node 20+, Docker Desktop.

```bash
# 1. Install dependencies
npm install

# 2. Start the local Postgres
docker compose up -d

# 3. Configure environment
cp .env.example .env
#    The defaults work for local dev. For a fully working flow you'll want
#    real R2 + Turnstile keys (see SETUP_CHECKLIST.md); Cloudflare's test
#    Turnstile keys (site 1x00000000000000000000AA /
#    secret 1x0000000000000000000000000000000AA) always pass locally.
#    Set SEED_SUPERUSER_PASSWORD to anything you like.

# 4. Create the schema and seed the superuser (idempotent)
npm run db:setup

# 5. Run it
npm run dev
```

- Public form: <http://localhost:3000/submit>
- Admin: <http://localhost:3000/admin/login> — sign in with
  `SEED_SUPERUSER_EMAIL` / `SEED_SUPERUSER_PASSWORD`; you'll be forced to
  choose a real password (min 12 chars) on first login.
- Emails: with no `RESEND_API_KEY` set, sends are recorded as `email.failed`
  events on the project's event timeline instead of going out.

## Tests

```bash
npm test
```

Unit tests (state machine, rate limiter, tokens, uploads, CSV, email
templates) run standalone; the integration suite (`tests/integration.test.ts`)
needs the docker-compose Postgres running — it exercises the full lifecycle
against the real database, including the concurrent-click row-lock case, with
R2 mocked.

## Migrations

Migrations live in `drizzle/` and are generated from `src/db/schema.ts`:

```bash
npm run db:generate   # after editing src/db/schema.ts: emit a new migration
npm run db:migrate    # apply pending migrations
npm run db:seed       # idempotent superuser seed (skips if the email exists)
npm run db:setup      # migrate + seed
```

Never edit an applied migration; add a new one.

## Deploying to Railway

Follow [SETUP_CHECKLIST.md](SETUP_CHECKLIST.md) for accounts/DNS. The app
itself:

1. Create a Railway project with the **PostgreSQL** plugin and a **service**
   connected to this repo. Railway auto-detects Next.js (build: `npm run
   build`).
2. Set the service **custom start command** to:

   ```
   npm run railway:start
   ```

   That runs migrations + the idempotent seed, then starts the server — so
   every deploy is self-migrating.
3. Set every variable from [.env.example](.env.example) in the service's
   Variables tab (reference `DATABASE_URL` from the Postgres plugin).
   `APP_URL` must be the public URL, e.g. `https://mail.kansasdems.org`.
4. Add the custom domain under Networking and create the CNAME.
5. Smoke-test per SETUP_CHECKLIST §5.

Operational notes:

- **R2 CORS** must allow the app origin for `PUT`/`GET`/`HEAD` (checklist §1.5)
  or browser uploads will fail.
- Rate limits are in-memory per instance (fine at this scale — run a single
  replica).
- The magic-link encryption and draft-token keys are derived from
  `R2_SECRET_ACCESS_KEY` + `TURNSTILE_SECRET_KEY`; if you rotate either,
  in-flight submission forms expire (harmless) and vendor emails lose their
  status-link footer until an admin uses "Regenerate vendor link" on affected
  projects.
- Backups: enable/verify Railway Postgres backups; the database is the audit
  trail. R2 artwork is review-fidelity only and recoverable from vendors.

## Repo tour

```
src/lib/state-machine.ts   §5 transition table as a pure module (no I/O)
src/lib/projects.ts        create/resubmit transactions (row-locked)
src/lib/admin-ops.ts       review decisions, reopen, delete+purge, payments
src/lib/uploads.ts         presign validation + HEAD verification (§6)
src/lib/client/artwork.ts  in-browser downscale + PDF rasterize/auto-split
src/lib/email/             §12 templates + post-commit sending with events
src/db/schema.ts           §4 schema (Drizzle); migrations in drizzle/
tests/                     unit + DB-backed integration suites
```
