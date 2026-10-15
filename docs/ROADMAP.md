# Stock Tracker: Phased Plan of Action

## Context
`spec.md` (v3) settles the architecture, but no code exists yet and the folder isn't a git repo. The spec's build order (§13) builds locally first and deploys at steps 8-9. This plan changes that order to fit three goals:
- **Learning**: Node API + Postgres, OAuth/OIDC/Entra, and Cloud/IaC/CI-CD are new to you, so these phases include explicit learning goals and "explain why" checkpoints. React/TS is familiar, so UI phases move faster.
- **Personal use**: get to a usable "daily driver" MVP early (end of Phase 5).
- **Opening it to others later**: make choices now that don't block this later (shared sentiment table, per-user isolation, env split), and save the legal and ops work for a final phase.

Decisions from this planning session:
- **Deploy early with a walking skeleton.** A trivial slice goes to Azure via Terraform + GitHub Actions in Phase 1, and every later phase ships through that pipeline.
- **The sentiment table is shared, keyed by symbol** (it is not user-owned and has no RLS). The worker polls the union of all users' watchlists. This resolves an open question in the spec.
- **The frontend is TanStack Start in SPA mode** (`tanstackStart({ spa: { enabled: true } })`). It builds a static `_shell.html` plus assets, which Azure Static Web Apps hosts. **Server functions and server routes are not used:** Fastify stays the only backend, and MSAL + Bearer tokens are unchanged. Moving to SSR with a Backend-for-Frontend auth pattern is possible later and gets its own ADR.

---

## Cross-cutting habits (every phase)
- **Small PRs into `main`** (branch protection on), with CI green before merging.
- **ADRs** in `docs/adr/NNN-title.md` for any non-trivial choice (the spec's "why / alternative" tables are the seed). They are cheap to write and very useful for learning.
- **Tests in the same PR as the code they cover**: Vitest for units and Postgres integration tests (docker compose locally, a service container in CI).
- **TDD from Phase 2 onward, frontend and backend** (see below).

### Test-driven development (Phase 2 onward)
Phases 0-1 are scaffolding and infra, where tests come after the code: config can't be usefully test-driven. From Phase 2, when real behaviour starts, use **red → green → refactor** for both the frontend and the backend:
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
**Learn:** containers, GHCR, Terraform state, GitHub→Azure OIDC federation, Container Apps, Static Web Apps.
- `server/`: Fastify with `GET /healthz` and pino logging. Write a multi-stage Dockerfile.
- `web/`: scaffold TanStack Start, enable SPA mode, and add one route that calls `/healthz` and shows the result. Add `staticwebapp.config.json` with the navigation fallback to `/_shell.html`. Check that a deep link survives a refresh in the deployed app.
- Bootstrap Terraform remote state by hand (a one-off script or small `infra/bootstrap` stack: storage account + container), and document it.
- `infra/`: resource group, Container Apps environment (Consumption), API container app (scale-to-zero), Static Web App, budget alert. Use UK South.
- GitHub Actions: Entra app registration with a federated credential, so Actions logs in to Azure without a stored secret.
- Pipeline: build and push the image to GHCR, run `terraform plan` on PRs, `apply` on main, then deploy the SWA. Set strict CORS on the API (frontend origin only).
- Create the Supabase project (London) now, by hand or with the provider, so the region choice and connection strings are settled. It isn't used yet.

**Done when:** merging to main updates the live site, the site shows the API's health response, and `terraform plan` on a clean main shows no changes.

## Phase 2: Identity end-to-end (OAuth 2.0 / OIDC)
**Learn:** auth code + PKCE, access vs ID tokens, JWKS, `iss`/`aud`/`scp` claims. This is the key learning phase, so go slowly.
- By hand: create the Entra External ID tenant and user flow (email OTP or password, non-SMS MFA). Record every setting in `docs/auth-setup.md`.
- Terraform (`azuread`): the SPA registration (localhost + SWA redirect URIs) and the API registration (`api://stock-tracker-api`, `access_as_user` scope, `requestedAccessTokenVersion = 2`). Check that the provider can authenticate to the external tenant; if not, document a manual fallback.
- `web/`: MSAL (`@azure/msal-react`) login/logout, created client-side only (not during the shell prerender). Use `acquireTokenSilent` for the API scope and a fetch wrapper that adds the Bearer header. Keep sessionStorage as the token cache. Gate authenticated routes with TanStack Router's `beforeLoad`, with the auth state passed in through router context.
- `server/`: an auth plugin using `jose` (remote JWKS, cached) that checks signature, `iss`, `aud`, `exp`/`nbf`, and the `scp` scope, and returns 401 or 403. It decorates the request with `userId = oid`.
- `GET /api/v1/me` returns `{ oid }`. Use it to answer the spec's open question: do `oid` and `scp` appear as expected in the tokens?
- First TDD exercise: write these tests *before* the auth plugin. Sign test tokens with a locally generated key pair, then cover the negative cases: wrong audience, wrong issuer, expired, missing scope, an ID token sent as an access token, and a missing header.

**Done when:** a deployed login works, `/me` returns your oid, and all the negative tests pass.

## Phase 3: Data layer and isolation
**Learn:** schema design, migrations, Postgres roles and grants, connection pooling, transactions.
- Drizzle schema per spec §5: `watchlist` and `holdings` (with `user_id text not null`, unique on `(user_id, symbol)`), a shared `sentiment` table (symbol, ts, source, source_id, score, raw_snippet, unique on `(source, source_id)` so inserts are idempotent), and an optional `users` table keyed by oid.
- Migrations include role creation and grants for `app_migrator`, `app_api`, and `app_worker`. Least privilege: `app_api` gets no DDL, and read-only access to `sentiment`.
- `server/src/data/`: the only module that touches the DB. Every function requires a `userId`.
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
- File-based routes (`/`, `/watchlist`, `/ticker/$symbol`, `/holdings`). Route loaders prefetch with `queryClient.ensureQueryData`, and components read with `useSuspenseQuery`. Validate search params (such as the sentiment date range) with zod.
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
- Move secrets to Key Vault, with Container Apps managed identity reading them. Remove any plain Container Apps secrets.

**Done when:** a deliberately thrown error shows up in Sentry with a request ID, a test alert fires, and no secrets remain in Terraform variables or GitHub.

## Phase 9: Hardening and staging/prod split
- Strict CSP and security headers on the SWA, container image scanning (Trivy) in CI, and `npm audit` gating.
- Split into staging and prod: per-environment tfvars or folders, separate Supabase projects and Entra registrations, and promotion from staging to prod in the pipeline.
- Custom domains (`app.` / `api.`). Decide on Supabase Pro.
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
