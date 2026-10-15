# Stock Tracker: Phased Plan of Action

## Context
`spec.md` (v3) settles the architecture, but no code exists yet and the folder isn't a git repo. The spec's build order (§13) builds locally first and deploys at steps 8-9. This plan changes that order to fit three goals:
- **Learning**: Node API + Postgres, OAuth/OIDC/Entra, and Cloud/IaC/CI-CD are new to you, so these phases include explicit learning goals and "explain why" checkpoints. React/TS is familiar, so UI phases move faster.
- **Personal use**: get to a usable "daily driver" MVP early (end of Phase 5).
- **Opening it to others later**: make choices now that don't block this later (shared sentiment table, per-user isolation, env split), and save the legal and ops work for a final phase.

Decisions from this planning session:
- **Deploy early with a walking skeleton.** A trivial slice goes to Azure via Terraform + GitHub Actions in Phase 1, and every later phase ships through that pipeline.
- **The sentiment table is shared, keyed by symbol** (it is not user-owned and has no RLS). The worker polls the union of all users' watchlists. This resolves an open question in the spec.
- **The frontend is TanStack Start with SSR, acting as a Backend-for-Frontend (ADR 004).** It runs as a second Container App with public ingress.
  - The web server is the OAuth client (`@azure/msal-node`) and keeps tokens in an encrypted session store. The browser only gets an `httpOnly` cookie.
  - Server functions are thin proxies to Fastify, which stays the only business backend, now with internal-only ingress.
  - This replaced an earlier SPA-mode plan.

---

## Cross-cutting habits (every phase)
- **Small PRs into `main`** (branch protection on), with CI green before merging.
- **ADRs** in `docs/adr/NNN-title.md` for any non-trivial choice (the spec's "why / alternative" tables are the seed). They are cheap to write and very useful for learning.
- **Tests in the same PR as the code they cover**: Vitest for units and Postgres integration tests (docker compose locally, a service container in CI).
- **Always TDD, frontend and backend** (see below).
- **Architecture:** vertical slices on the backend (ADR 002) and atomic design on the frontend (ADR 003). House rules are in `AGENTS.md`.

### Test-driven development (always)
All behaviour is test-driven, frontend and backend alike, from the first line of real code (including Phase 1's `/healthz`). Only pure scaffolding, config and Terraform are exempt. Use **red → green → refactor**:
1. **Red:** write a failing test that describes the behaviour, and run it to see it fail for the right reason.
2. **Green:** write the minimum code that makes it pass.
3. **Refactor:** clean up while the tests stay green. Then commit.

| Layer | Tools | What to test first |
|---|---|---|
| API routes | Vitest + Fastify `app.inject()` | Status codes, auth rejections (401/403), validation errors, response shapes against the zod schemas |
| Auth plugin | Vitest + `jose` with a locally generated key pair | Every rejection case before the happy path |
| Data layer | Vitest + real Postgres (docker compose / CI service) | Per-user isolation, unique constraints, RLS behaviour |
| Worker | Vitest, with the provider HTTP faked (MSW or injected clients) | Idempotency (run twice → no duplicates), retry and backoff, scoring |
| Frontend | Vitest + React Testing Library + MSW for the API | User-visible behaviour (add/remove a watchlist item; loading, error and empty states), not implementation details |
| End-to-end (Phase 5+) | Playwright, a few critical journeys | Login → add a symbol → see a quote |

Habits:
- Keep tests fast and deterministic: fake timers for cache TTLs and cron, and no real third-party calls in CI.
- Write a regression test for every bug before fixing it.
- Treat coverage as a signal, not a target. Don't gate CI on a percentage.
- **Each phase ends with a "Done when" check and a short retro note** in the roadmap: what you learned and what surprised you.
- **Cost safety**: create an Azure budget alert in Phase 1, before anything bills.

---

## Phase 0: Foundations (local only)
**Learn:** monorepo workspaces, TS project references, CI basics.
- `git init`, create a private GitHub repo, add `.gitignore` and `.editorconfig`.
- Set up pnpm workspaces matching spec §10: `web/`, `server/`, `worker/`, `packages/types/`, `infra/`, `.github/workflows/`.
- Shared `tsconfig` base, ESLint + Prettier (or Biome), Vitest, and a Node LTS pinned in `.nvmrc`.
- `docker-compose.yml` with local Postgres, so local dev is independent of Supabase.
- First CI workflow: install, lint, typecheck, test on every PR.
- Turn on Dependabot and secret scanning now (cheap, and good habits).

**Done when:** `pnpm -r test` passes locally and in CI on a PR.

## Phase 1: Walking skeleton deployed
**Learn:** containers, GHCR, Terraform state, GitHub→Azure OIDC federation, Container Apps (public vs internal ingress), SSR and hydration basics.
- `server/`: Fastify with `GET /healthz` and pino logging, test-driven with `app.inject()`. Write a multi-stage Dockerfile.
- `web/`: scaffold TanStack Start with SSR, plus the Router–Query SSR integration. Verify the current package names and Node deployment output, pin the versions, and record them in an ADR.
  - **The first page is server-rendered.** Its loader calls a server function that fetches the API's `/healthz` server-to-server, so the response is already in the HTML. View the page source to check.
  - Give `web/` its own `GET /healthz` for the container probe.
  - Add the ESLint import-direction rules from ADR 003, plus a short nested `AGENTS.md` in `web/` and `server/`.
  - Write a multi-stage Dockerfile.
- Bootstrap Terraform remote state by hand (a one-off script or small `infra/bootstrap` stack: storage account + container), and document it.
- `infra/`:
  - resource group and Container Apps environment (Consumption), in UK South
  - **web** container app with public ingress and scale-to-zero
  - **API** container app with **internal-only ingress**; the web app gets the API's internal FQDN as an env var
  - budget alert
- GitHub Actions: Entra app registration with a federated credential, so Actions logs in to Azure without a stored secret.
- Pipeline: build and push **both** images to GHCR. Run `terraform plan` on PRs and `apply` on main. Path filters mean an image is only rebuilt when its own app changed.
- Create the Supabase project (London) now, by hand or with the provider, so the region choice and connection strings are settled. It isn't used yet.

**Done when:**
- Merging to main updates the live site.
- The page's **HTML source** already contains the API's health response.
- The API's URL **isn't reachable from the internet**.
- `terraform plan` on a clean main shows no changes.

## Phase 2: Identity end-to-end (OAuth 2.0 / OIDC)
**Learn:** auth code + PKCE, confidential vs public clients, access vs ID vs refresh tokens, JWKS, `iss`/`aud`/`scp` claims, the BFF pattern, secure session cookies, CSRF. This is the key learning phase, so go slowly. It's bigger than an SPA login, so consider splitting it into 2a (API token validation) and 2b (BFF login and sessions).
- By hand: create the Entra External ID tenant and user flow (email OTP or password, non-SMS MFA). Record every setting in `docs/auth-setup.md`.
- Terraform (`azuread`):
  - The **web** registration: a confidential client with a "Web" platform, redirect URIs for localhost and the deployed app, and a client secret stored as a Container Apps secret for now.
  - The **API** registration: `api://stock-tracker-api`, `access_as_user` scope, `requestedAccessTokenVersion = 2`.
  - Check that the provider can authenticate to the external tenant; if not, document a manual fallback.
- **Session store:** write an ADR confirming the design (spec §3 Auth). Then add the `web_sessions` table with its migration and the `app_web` role (access to this table only). Encrypt the token cache with a key from config. Test-drive it: create, load, expire, rotate, delete, and check that the encryption round-trips.
- `web/src/server/` (spec §3 Auth flow), test-driven:
  - `GET /auth/login`: PKCE + `state` + `nonce`.
  - `GET /auth/callback`: check `state`, redeem the code with `@azure/msal-node`, **rotate the session ID**, set the `__Host-session` cookie.
  - `POST /auth/logout`: delete the session, clear the cookie, end the Entra session.
  - An API client that calls `acquireTokenSilent`, then Fastify with a Bearer token.
  - Gate authenticated routes in `beforeLoad` using the session from router context. If there's no session, redirect to `/auth/login`.
  - An `Origin` check on all state-changing requests.
- `server/`: an auth plugin using `jose` (remote JWKS, cached) that checks signature, `iss`, `aud`, `exp`/`nbf`, and the `scp` scope, and returns 401 or 403. It decorates the request with `userId = oid`.
- `GET /api/v1/me` returns `{ oid }`. Use it to answer the spec's open question: do `oid` and `scp` appear as expected in the tokens?
- First TDD exercise: write these tests *before* the auth plugin. Sign test tokens with a locally generated key pair, then cover the negative cases: wrong audience, wrong issuer, expired, missing scope, an ID token sent as an access token, and a missing header.
- **BFF tests:**
  - The cookie has the right flags.
  - A login rotates the session ID.
  - A wrong `state` is rejected.
  - A cross-origin POST is rejected.
  - An expired session redirects to login.
  - **No token ever appears in an HTML response or in the serialized query cache.**

**Done when:**
- A deployed login works, and the page shows the `oid` that `/me` returned.
- In the browser's devtools there are **no tokens** in storage, readable cookies or page source. Only `__Host-session` (`HttpOnly`) is present.
- Logout ends the session.
- All the negative tests pass.

## Phase 3: Data layer and isolation
**Learn:** schema design, migrations, Postgres roles and grants, connection pooling, transactions.
- Drizzle schema per spec §5: `watchlist` and `holdings` (with `user_id text not null`, unique on `(user_id, symbol)`), a shared `sentiment` table (symbol, ts, source, source_id, score, raw_snippet, unique on `(source, source_id)` so inserts are idempotent), and an optional `users` table keyed by oid.
- Migrations include role creation and grants for `app_migrator`, `app_api`, and `app_worker`. Least privilege: `app_api` gets no DDL, and read-only access to `sentiment`.
- `server/src/shared/db/withUser()`: the transaction helper every slice repository must use (ADR 002). Feature slices (`server/src/features/<feature>/*.repository.ts`) are the only code that touches the DB, and every function requires a `userId`.
- Decide where the shared Drizzle tables live (likely `packages/db`, since the worker needs them too), and write it up as an ADR.
- Integration tests against real Postgres: user A cannot read or write user B's rows, and calls without a user context are rejected.
- Pipeline: a migration step runs as `app_migrator` against Supabase (pooler string from Container Apps secrets for now), before the API deploys.

**Done when:** migrations apply cleanly to local and Supabase databases, the isolation tests pass in CI, and the deployed API connects as `app_api`.

## Phase 4: Core API
**Learn:** API design, validation, caching, rate limiting, third-party API constraints.
- `packages/types`: zod schemas shared by API and web.
- Routes (spec §8): watchlist CRUD, holdings PUT/GET, and `GET /quotes?symbols=` (batched calls to Finnhub, in-memory 30-60s TTL cache, symbol validation).
- `@fastify/rate-limit` per user and per IP. Generate OpenAPI from the zod schemas with `@fastify/swagger`.
- Read Finnhub's terms and rate limits, and record them in an ADR. This matters for Phase 9.

**Done when:** every route is tested (including auth and isolation), and the OpenAPI docs render.

## Phase 5: Core UI → personal MVP 🎯
- File-based routes (`/`, `/watchlist`, `/ticker/$symbol`, `/holdings`).
  - **Data loading:** route loaders prefetch with `queryClient.ensureQueryData`, using query options whose `queryFn` is a server function. These run on the server for the first load and are hydrated into the client cache. Components read with `useSuspenseQuery`.
  - **Quotes** refetch in the browser every 30-60 seconds through the same server functions.
  - **Search params** (such as the sentiment date range) are validated with zod.
  - **Watch for hydration mismatches:** times, number formatting and locale differences between server and browser.
- Pages: a watchlist page, `/ticker/$symbol` detail (quote and price chart), and holdings with P&L.
- Chart library: recommend **lightweight-charts** for price (designed for financial data) and **Recharts** for sentiment trends later. Record the choice in an ADR.
- Loading, error, and empty states, plus a basic responsive layout.

**Done when:** you use it day to day for a week. Write down the friction you notice; it feeds Phases 7-9.

## Phase 6: RLS defense in depth
**Learn:** Postgres RLS, `set_config` with transaction-local settings under a pooler.
- Migrations enable and force RLS, plus an `owner_only` policy on `watchlist`, `holdings`, and `users`.
- The data-access layer wraps each request in a transaction and calls `set_config('app.user_id', …, true)`.
- Extend the isolation tests: deliberately drop a `WHERE` clause in a test query and show that RLS still blocks the read.

**Done when:** the isolation tests pass with RLS on, and the "forgotten WHERE" test shows that RLS alone blocks the leak.

## Phase 7: Worker and sentiment
**Learn:** queues, idempotency, retries and backoff, cron jobs, NLP basics.
- `worker/`: pg-boss queues. A scheduler job enqueues one job per distinct symbol across all watchlists, and each handler fetches, scores with VADER, and inserts with `ON CONFLICT DO NOTHING`.
- Sources: start with Finnhub company news, and add Reddit only after reviewing its API terms (ADR). Rate-limit and back off per provider.
- Terraform: a Container Apps Job on a cron schedule (~15-30 min), connecting as `app_worker`. Watch whether these writes keep the free Supabase project from pausing.
- API: `GET /sentiment/:symbol?from=&to=`. UI: a sentiment trend chart on the ticker page.

**Done when:** a few days of snapshots build up, rerunning a job adds no duplicate rows, and the chart shows real trends.

## Phase 8: Observability and secrets
**Learn:** structured logging, error tracking, alerting, managed identity.
- Pino request IDs and redaction (never log tokens). Sentry in both web and server, Azure Monitor alerts (5xx rate, auth-failure spikes, job failures), and readiness/liveness probes.
- Move secrets to Key Vault, with Container Apps managed identity reading them: the web client secret, the session-encryption key and the DB connection strings. Remove any plain Container Apps secrets. Plan how to rotate the client secret, or switch to a certificate.

**Done when:** a deliberately thrown error shows up in Sentry with a request ID, a test alert fires, and no secrets remain in Terraform variables or GitHub.

## Phase 9: Hardening and staging/prod split
- **Security headers from the web server:** a nonce-based CSP (SSR hydration scripts need per-request nonces), HSTS and `frame-ancestors 'none'`.
- **CI scanning:** container image scanning (Trivy) and `npm audit` gating.
- **Split into staging and prod:** per-environment tfvars or folders, separate Supabase projects and Entra registrations, and promotion from staging to prod in the pipeline.
- **Domain:** a custom domain for the web app only (`app.`), since the API stays internal.
- **Decide** on Supabase Pro, and on `minReplicas: 1` for the web app to avoid SSR cold starts.
- Add a backup/restore drill to the runbook (`docs/runbook.md`).

**Done when:** a change goes PR → staging → prod with an approval gate, and the restore drill succeeds.

## Phase 10 (later): Opening to others
These items only matter once you have users other than yourself, but they are real blockers:
- **Market-data licensing.** Free-tier quote and news APIs often forbid redistribution or commercial use. Confirm Finnhub and the other providers allow showing their data to other users, or budget for a paid plan.
- **Sign-up controls.** Start invite-only or allowlisted, with per-user limits (watchlist size), so cost and abuse stay bounded.
- **UK GDPR.** A privacy policy, account deletion (cascading through the `users` table), data export, and a retention policy for `raw_snippet`.
- **A "not financial advice" disclaimer and terms of use.**
- **Capacity and cost.** Load test, move the cache to Redis if the API scales beyond one replica, and tighten budget alerts.
- **Onboarding UX and a feedback channel.**

---

## How to use this roadmap
- Every phase has a "Done when" that you can check yourself.
- Phases 1, 2, 3, 7 and 9 end with something verified in Azure, not just locally.
- The open questions in spec §14 are each assigned to a phase: claims (2), MFA methods (2), the Terraform tenant question (2), the chart library (5), sources and terms (4/7), Supabase pausing (7), and the domain (9).
