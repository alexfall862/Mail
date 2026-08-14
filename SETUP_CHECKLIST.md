# KDP Mail Approval — Setup Checklist (Human Tasks)

Everything the coding agent *cannot* do for you: accounts, keys, DNS, and dashboards.
Work top to bottom; each section notes which env vars it produces (these map 1:1 to
§14 of SPEC.md). Keep collected values in a password manager, not a text file.

Decide your app URL first — assumed below: **https://mail.kansasdems.org**.

---

## 1. Cloudflare — R2 storage (~15 min)

You need a Cloudflare account (free plan is fine). R2 requires adding a payment card,
but at this project's volume you should remain inside the free tier ($0).

1. Dashboard → **R2** → enable R2 (card prompt appears here).
2. **Create bucket**: name `kdp-mail-approval`, location "North America". Leave the
   bucket **private** (do not enable public access, do not connect a custom domain).
3. Note your **Account ID** (right sidebar of the R2 overview page).
   → `R2_ACCOUNT_ID`
4. **Create API token**: R2 → "Manage R2 API Tokens" → Create token.
   - Permissions: **Object Read & Write**
   - Scope: **Apply to specific buckets** → `kdp-mail-approval` only
   - TTL: no expiry
   - Save the Access Key ID and Secret Access Key (secret is shown once).
   → `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET=kdp-mail-approval`
5. **CORS** (required for browser → R2 presigned PUTs): bucket → Settings → CORS policy:

   ```json
   [
     {
       "AllowedOrigins": ["https://mail.kansasdems.org", "http://localhost:3000"],
       "AllowedMethods": ["PUT", "GET", "HEAD"],
       "AllowedHeaders": ["content-type", "content-length"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

6. **Lifecycle rule** (cleans up uploads from abandoned/never-submitted forms — the app
   deliberately tolerates these): bucket → Settings → Object lifecycle rules → add rule:
   *"Abort incomplete multipart uploads after 1 day."* That's the only rule; do **not**
   add any age-based deletion rule on regular objects (it would delete live artwork).

## 2. Cloudflare — Turnstile bot protection (~5 min)

1. Dashboard → **Turnstile** → Add site.
   - Domain: `mail.kansasdems.org` (add `localhost` too for development)
   - Widget mode: **Managed**
2. Copy the **Site Key** and **Secret Key**.
   → `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`

## 3. Resend — transactional email (~20 min, includes DNS wait)

1. Create account at resend.com (free tier: 3,000 emails/month, 100/day — plenty).
2. **Domains** → Add domain. Recommended: add the subdomain **`mail.kansasdems.org`**
   (or `send.kansasdems.org`) rather than the apex — keeps this app's email reputation
   separate from the party's main mail.
3. Resend shows DNS records to add (SPF TXT, DKIM TXT/CNAMEs, optionally DMARC).
   Add them wherever `kansasdems.org` DNS is hosted. **Coordinate with whoever manages
   party email before touching any existing SPF/DMARC records on the apex** — adding
   records on the subdomain avoids conflicts, which is the point of step 2.
4. Wait for Resend to show the domain **Verified** (minutes to a few hours).
5. **API Keys** → Create key, permission "Sending access", scoped to the domain.
   → `RESEND_API_KEY`, and `EMAIL_FROM=KDP Mail Program <approval@mail.kansasdems.org>`
   (any mailbox name on the verified domain works; it doesn't need to be a real inbox,
   but consider setting up forwarding for replies or use a real reply-to later).

## 4. Railway — hosting (~20 min)

1. Create/log into Railway; create project **kdp-mail-approval**.
2. Add **PostgreSQL** (managed plugin). Railway generates `DATABASE_URL` — reference it
   in the app service as a shared variable rather than pasting the string.
3. Add the app **service** connected to your GitHub repo (create the repo first; the
   coding agent's output lives there). Railway auto-detects Next.js.
4. Service → **Variables**: enter every env var from SPEC.md §14. For
   `SEED_SUPERUSER_EMAIL` use `alex@kansasdems.org`; for `SEED_SUPERUSER_PASSWORD`
   generate a strong temporary password (you'll be forced to change it on first login).
   `APP_URL=https://mail.kansasdems.org`.
5. Service → Settings → **Networking** → Custom domain: `mail.kansasdems.org`.
   Railway shows a CNAME target; add that CNAME in DNS. (Note: this coexists fine with
   the Resend records on the same subdomain — CNAME for web, TXT/DKIM for mail — but if
   your DNS host complains about CNAME+TXT on the same name, put Resend on
   `send.kansasdems.org` instead and adjust `EMAIL_FROM`.)
6. Cost guardrails while you're in there:
   - Project → Usage: set a **usage email alert** (e.g. at $10).
   - App service → Settings: no autoscaling / single replica (default), and confirm the
     service sleeps or stays within Hobby limits. Expected steady state: **$5–10/mo
     total** (app + Postgres). R2, Resend, Turnstile: $0.

## 5. First deploy & smoke test (~30 min)

1. Push the agent-built repo → Railway deploys → migrations run → superuser seeded.
2. Log in at `/admin/login` as alex@kansasdems.org with the temp password; complete the
   forced password change.
3. Create 1–2 additional admin accounts under `/admin/users` (reviewers/legal), hand
   them their temp passwords out-of-band.
4. End-to-end test with a dummy project:
   - Submit via `/submit` with a large image and a PDF as artwork → confirm both emails
     arrive (vendor confirmation with magic link; admin alert) and the uploaded review
     images look sharp enough to proofread at zoom.
   - Advance through content → legal, request changes at legal → confirm the vendor
     email contains your notes → resubmit via the magic link with new artwork → confirm
     it routes back to **content review** (not legal) → advance to approval.
   - Mark a vendor paid; check the dashboard badge and CSV export.
   - Delete the dummy project; confirm the R2 bucket prefix is gone (Cloudflare
     dashboard → bucket → search the project id) and the tombstone shows in the export.
5. Check spam placement: send the test emails to a Gmail and an Outlook address.

## 6. Operational notes (ongoing)

- **Payments to make**: Cloudflare (card on file, expect $0), Railway (~$5–10/mo),
  Resend free, Turnstile free.
- **Backups**: Railway Postgres keeps backups on paid plans — verify in the Postgres
  service settings; also schedule a monthly manual `pg_dump` reminder for yourself.
  The database is the crown jewels; R2 artwork is replaceable in a pinch, the audit
  trail is not.
- **Key rotation**: if any key leaks, all four (R2 token, Resend key, Turnstile secret,
  DB URL) can be rotated from their dashboards + Railway variables with zero code change.
- **Off-season**: the system idles at the same cost; no need to tear anything down.
- **Who to give admin access**: keep the list short; deactivate accounts when staff
  roll off a cycle (superuser → `/admin/users`).

## Env var collection summary

| Var | Source (section) |
|---|---|
| DATABASE_URL | Railway Postgres (4) |
| APP_URL | Your domain decision |
| R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET | Cloudflare R2 (1) |
| TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY | Cloudflare Turnstile (2) |
| RESEND_API_KEY / EMAIL_FROM | Resend (3) |
| SEED_SUPERUSER_EMAIL / SEED_SUPERUSER_PASSWORD | You (4) |
