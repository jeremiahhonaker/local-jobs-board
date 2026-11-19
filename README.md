# Local Jobs Board — standalone web app

Neighbors post small jobs (yard work, moving help, cleaning, hauling, handyman,
errands) with the pay shown up front; local workers claim them. The board keeps
a flat **10% fee on each completed job**, shown on every posting. Fees are
recorded — real payment collection through Stripe is a later step.

This is the standalone, deployable rebuild of the Local Jobs Board. It does not
touch Day & Night Storage, LLC: no LLC branding, no ID checks, no sensitive
data collected. It starts empty on purpose — every listing is a real one a
neighbor posted.

## Stack

- **Runtime:** Bun + TypeScript
- **Server:** Hono (REST API + static file serving), Drizzle ORM
- **Database:** SQLite via libsql — a local file in dev, Turso (hosted SQLite)
  in production. Same dialect, no migration rewrite.
- **Client:** React 19, plain CSS (no build framework beyond `bun build`)
- **Auth:** magic-link email sign-in (no passwords) via Resend; sessions in
  httpOnly cookies. Every mutating action checks ownership server-side.

## How it works

- **Board** — open jobs, newest first, with category filters. Listings show a
  neighborhood or town only, never a street address, and no contact details.
- **Post a Job** — title, category, details, pay, area, optional date needed,
  and contact details. The form previews the split live: worker's share and
  the board's 10% fee.
- **Claim** — a worker claims with a name + phone/email. Contact details are
  then shared only between the poster and that worker.
- **Complete / Cancel / Release** — the poster or the worker marks a claimed
  job done; the server computes the 10% fee and records it on the job. The
  poster can cancel; the worker can release a claimed job back to the board.
- **My Activity** — jobs you posted and jobs you claimed, with contact details
  and actions.
- **Earnings** — what you earned as a worker and spent as a poster. The board
  owner (see `OWNER_EMAIL`) also sees board-wide fee totals.
- **Safety** — meetup rules: public first meetings, exact address only with
  your worker, agree the pay up front, trust your gut.

## Run locally

```bash
bun install
bun run build        # build the client into dist/public
bun run dev          # starts the server on http://localhost:3000
```

Local dev needs no accounts and no env vars: the database is a local SQLite
file (`./data/local.db`, created automatically) and magic-link emails are
printed to the server console. Sign in by opening the printed link.

To run the automated end-to-end test (sign up → post → claim → complete →
fee math → ownership checks), start the server in test mode first:

```bash
rm -f data/test.db*
DEV_AUTH_DEBUG=1 OWNER_EMAIL=owner@test.local LOCAL_DB_PATH=./data/test.db \
  bun run src/server/index.ts &
bun run test:e2e
```

`DEV_AUTH_DEBUG=1` makes the magic-link endpoint return the sign-in link in
its JSON response so tests can sign in without email. **Never enable it in
production.**

## Deploy to Render

Accounts Jeremiah needs (all free to create; he creates them himself):

| Account | Purpose | Cost |
|---|---|---|
| GitHub | Holds the code; Render deploys from it | Free |
| Render | Hosts the app (one web service) | Free to start; ~$7/mo for an always-on service at launch |
| Turso | Hosted SQLite database | Free tier |
| Resend | Sends the magic-link sign-in emails | Free tier |
| Domain | e.g. `jobs.example.com` | ~$11/year at Cloudflare/Porkbun |

### 1. Push the code to GitHub

```bash
cd side-apps-local-jobs-board
git init
git add -A
git commit -m "Local Jobs Board — standalone app"
git branch -M main
git remote add origin git@github.com:<your-username>/local-jobs-board.git
git push -u origin main
```

### 2. Create the Turso database

```bash
# Install the Turso CLI (https://docs.turso.tech/cli/installation), then:
turso auth login
turso db create local-jobs-board
turso db show local-jobs-board --url        # -> TURSO_DATABASE_URL
turso db tokens create local-jobs-board     # -> TURSO_AUTH_TOKEN
```

### 3. Deploy on Render

Option A — Blueprint (uses `render.yaml` in this repo):

1. Render dashboard → **New +** → **Blueprint** → connect the GitHub repo.
2. Render creates the web service from `render.yaml`.
3. In the service's **Environment** tab, set the secrets:
   - `OWNER_EMAIL` — your email (only this account sees board-wide fee totals)
   - `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` — from step 2
   - `RESEND_API_KEY` — from resend.com (create a free account + API key)
   - `EMAIL_FROM` — e.g. `Local Jobs Board <jobs@yourdomain.com>` (verify the
     sending domain in Resend, or use Resend's onboarding address to start)
   - `APP_URL` — the Render URL first (`https://local-jobs-board.onrender.com`),
     then your custom domain once it is attached.
4. Deploy. The server runs the database migrations automatically on startup.

Option B — manual web service: **New +** → **Web Service** → connect the repo,
runtime **Docker**, Dockerfile path `./Dockerfile`, then set the same env vars.

### 4. Point the domain

In Render: service → **Settings** → **Custom Domains** → add your domain, then
add the DNS records Render shows at your registrar. Update `APP_URL` to the
custom domain and redeploy.

### 5. Verify the live site

Open the site, request a magic link with your email, and walk the flow once:
post a job → claim it from a second email → mark it done → check the fee and
Earnings. (The e2e script can also run against the live URL:
`E2E_BASE_URL=https://jobs.example.com bun run test:e2e` — but note it needs
`DEV_AUTH_DEBUG=1` on the server, so only use it against a staging deploy, not
production.)

## Environment variables

See `.env.example` for the full list. Required in production:

- `APP_URL` — public base URL (used in magic-link emails)
- `OWNER_EMAIL` — board owner's email (board-wide fee totals)
- `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` — Turso database
- `RESEND_API_KEY`, `EMAIL_FROM` — magic-link emails

Optional: `PORT` (Render injects it), `NODE_ENV`, `LOCAL_DB_PATH`.

## What is still needed (later steps, not in this build)

- **Stripe fee collection** — fees are recorded only. Wiring real charging
  needs a standard Stripe account in Jeremiah's own name (no LLC) plus
  Checkout + webhook work. Do that only when he says go.
- **Domain name** — Jeremiah's pick; ~$11/year.
- **Launch posts** — drafted once the live link exists; Jeremiah shares them
  (near-zero effort for him).
- **Resend sending domain** — verify a domain in Resend for the `EMAIL_FROM`
  address, or start with Resend's onboarding sender.

## Project layout

```
src/server/    Hono API + auth + mail + Drizzle schema (schema.ts, app.ts,
               auth.ts, mail.ts, db.ts, env.ts, index.ts, migrate.ts)
src/client/    React app (App.tsx, api.ts, main.tsx, index.html, styles.css)
drizzle/       SQL migrations (applied automatically on server start)
scripts/       build.ts (client bundler), migrate.ts, e2e-test.ts
render.yaml    Render Blueprint (Docker web service + env vars)
Dockerfile     Production image (oven/bun)
```
