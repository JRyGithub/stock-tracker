# Stock Tracker: Architecture Spec

Status: design agreed, no code written yet.
Purpose of this file: give a fresh context everything needed to continue (scaffolding, schema, infra) without re-deriving decisions.

Change log:
- v6: the frontend is now **TanStack Start with SSR, acting as a Backend-for-Frontend (BFF)**, on Azure Container Apps (ADR 004). Auth moved from MSAL in the browser to a confidential client on the web server (`@azure/msal-node`), so tokens never reach the browser; the browser holds only an `httpOnly` session cookie. The API now has internal-only ingress. Static Web Apps dropped.
- v5: code organisation decided: vertical slices on the backend (ADR 002) and atomic design on the frontend (ADR 003). The §6 data-access layer is now per-slice repositories using a shared `withUser()` helper. House rules (arrow functions only, always TDD, confirmed pushes) are in `AGENTS.md`.
- v4: frontend moved to TanStack Start in SPA mode (static shell on Static Web Apps; server functions/routes unused, Fastify remains the only backend). Sentiment table decided as shared by symbol. Phased delivery plan lives in `docs/ROADMAP.md`.
- v3: auth moved to Microsoft Entra External ID using standard OAuth 2.0 / OIDC (auth code + PKCE, access tokens with audience and scope). Clerk dropped because it uses its own session-token model rather than standard OAuth flows.
- v2: auth switched from Supabase Auth (and briefly Entra External ID) to Clerk. Supabase is now used only as managed Postgres. Added security baseline and data-access/RLS design.

## 1. Goal

A personal stock-following web app that:
- Tracks a watchlist and holdings
- Shows live quotes (fetched, not stored)
- Gathers sentiment from around the web (news headlines, Reddit), scores it, and stores snapshots so trends can be charted

Secondary goal: mimic a production-grade setup (multi-user-ready auth, stateless API, queue-backed jobs, CI/CD, IaC, observability, defense-in-depth security) with potential to scale, while staying cheap (target $0-5/month on free tiers, ~$25-30/month once Supabase Pro is needed). It is also a learning project, so production habits and standards-based auth (OAuth 2.0 / OIDC) are preferred over shortcuts.

Non-goals for now: multi-region, Kubernetes, public API for third parties, real-time websockets.

## 2. Architecture overview

```
Browser (React, hydrated from server-rendered HTML)
   |   only ever holds an httpOnly session cookie, never tokens
   |-- pages, assets, server functions (cookie) --> Azure Container Apps: web (TanStack Start, SSR + BFF)  [public ingress]
          |-- login: OAuth 2.0 auth code + PKCE as a confidential client (@azure/msal-node)
          |       --> Microsoft Entra External ID (issues ID, access and refresh tokens to the web server)
          |-- session store: Postgres web_sessions (encrypted token cache, app_web role)
          '-- calls the API server-to-server with the user's access token (Authorization: Bearer)
                 --> Azure Container Apps: Fastify API  [internal-only ingress]
                       (validates access token: signature, issuer, audience, scope; scopes every query to the user)
                       |-- Supabase Postgres (pooler connection, non-owner role)
                       '-- in-memory quote cache
Azure Container Apps Job: worker (pg-boss, cron-triggered)
   |-- Supabase Postgres (pooler, separate worker role)
   '-- Finnhub + news/Reddit APIs

GitHub Actions --> builds/pushes images to GHCR, runs Terraform plan/apply
Terraform --> provisions Azure resources (and the Supabase project via provider)
```

- **One public hostname** (e.g. `app.example.com`) serves the web app. The Fastify API uses **internal ingress**: it's reachable only from inside the Container Apps environment, so it has no public attack surface and needs no CORS.
- **Container Apps has a managed reverse proxy** (HTTPS, TLS termination, load balancing) built in, so no Caddy or nginx is run.
- **This is the Backend-for-Frontend (BFF) pattern.** The web server is the OAuth client and holds the tokens. The browser authenticates to it with a cookie, and it calls the API with a Bearer token.

## 3. Stack and decisions

Each choice lists the reason and one alternative considered.

### Frontend
| Choice | Why | Alternative |
|---|---|---|
| TanStack Start (SSR) + React + TypeScript | Type-safe file-based routing (TanStack Router), server-run loaders paired with TanStack Query, server functions as the BFF layer, Vite under the hood, shares types with API. Learning value: SSR, hydration and the BFF auth pattern | Vite + TanStack Router SPA (simpler, but tokens live in the browser); Next.js (more mature SSR, heavier and more opinionated) |
| TanStack Query (with Router SSR integration) | Server-prefetched data handed to the client cache on hydration, then client refetch for live quotes (30-60s) | Plain loaders only (no client cache or refetch) |
| Azure Container Apps (web app, Consumption) | Runs the Start Node server in the same environment and pipeline as the API; scale-to-zero | Azure App Service (always-on, simpler, costs from the first day) |
| Charts: Recharts or lightweight-charts | Price and sentiment trends | (undecided) |
| `@azure/msal-node` (confidential client on the web server) | Official library for auth code + PKCE against Entra from a server, with a token cache and silent refresh | `openid-client` (generic OIDC, provider-neutral); MSAL in the browser (tokens exposed to the page's JavaScript) |

TanStack Start notes:
- **SSR is on.** Route loaders run on the server for the first request and in the browser during client-side navigation. Code that must only run on the server (sessions, MSAL, the API client, secrets) lives in server-only modules (`web/src/server/`) and is reached through `createServerFn`, never imported into components directly.
- **Server functions are thin BFF proxies only.** They read the session, get an access token, call Fastify, and return the result. They contain no business logic and don't touch the database (apart from the session store). **Fastify stays the one business backend.**
- **Hydration:** the server-rendered HTML must match what the client renders first. Keep values like `Date.now()`, random IDs and browser-only APIs out of the first render, or render them inside a client-only boundary.
- **Data flow:** loaders call `queryClient.ensureQueryData(...)` with query options whose `queryFn` is a server function. The Router–Query SSR integration serializes the cache into the HTML, and quote refetches in the browser go through the same server functions.
- **Pin the TanStack Start version**, because it's evolving quickly. Verify the Router–Query SSR integration package and API against the current docs when scaffolding.

### API and jobs
| Choice | Why | Alternative |
|---|---|---|
| Node + Fastify + TypeScript + zod | Shared types with React, structured, fast | .NET minimal APIs (better background services, loses shared types) |
| Azure Container Apps (Consumption, scale-to-zero) | Managed HTTPS/routing; monthly free grant (180k vCPU-s, 360k GiB-s, 2M requests per subscription) | Fly.io (simpler, cheaper always-on) |
| Worker as Container Apps Job + pg-boss | Cron runs billed only while executing; retries via Postgres-backed queue; no Redis needed | BullMQ on Redis (faster, more tooling, extra service to pay for) |
| In-memory quote cache (30-60s TTL) | Fine at low instance counts | Redis/Upstash once scaled out |

API rules: versioned routes (`/api/v1`), zod validation, per-user rate limiting (`@fastify/rate-limit`), health endpoint, OpenAPI spec, idempotent retryable jobs, per-provider rate limiting in the worker.

### Data
| Choice | Why | Alternative |
|---|---|---|
| Supabase Postgres, used only as managed Postgres (pooler connection string) | Managed, multi-instance safe, free to start | Azure Database for PostgreSQL (~$12-15+/month minimum) |
| Drizzle ORM + migrations | Typed schema, lightweight | Prisma (better tooling, heavier runtime) |

Notes:
- Do not use Supabase Auth, its auto-generated REST API, its client libraries for data access, or Edge Functions. Fastify is the backend and Microsoft Entra External ID is the identity provider. (Supabase RLS helpers like `auth.uid()` therefore do not apply; see section 6.)
- Use the pooler connection string, not the direct one, because scaling containers open many short-lived connections.
- Put Azure and Supabase in the same region (UK South and Supabase London) to keep DB latency low.
- Supabase free projects auto-pause after 7 days of inactivity (data kept, but unreachable until resumed). Scheduled writes may keep it active but verify; plan to move to Pro ($25/month) before relying on it daily.

### Authentication: Microsoft Entra External ID (OAuth 2.0 / OIDC)
| Choice | Why | Alternative |
|---|---|---|
| Microsoft Entra External ID (external tenant) | Real OAuth 2.0 / OIDC: auth code + PKCE, access tokens with audience and scopes, refresh tokens. Azure-native, free for the first 50,000 monthly active users, strong learning value | Auth0 (standards-first, hosted, easier setup, MAU pricing later); Keycloak (self-hosted OIDC, another container to run and secure); Clerk (fastest, but its own session-token model, dropped for that reason) |

Setup in the external tenant:
- **Two app registrations:**
  - **Web** (a *confidential* client): platform "Web", redirect URI `https://app.example.com/auth/callback` (plus `http://localhost:3000/auth/callback` for dev), and a client credential. Start with a client secret stored as a Container Apps secret, then move it to Key Vault (Phase 8). A certificate is preferred over a secret long term. The web registration is granted the API scope.
  - **API:** exposes a scope such as `access_as_user`, with an Application ID URI like `api://stock-tracker-api`.
- Set the API registration to issue v2 access tokens (`requestedAccessTokenVersion: 2`); verify this in the manifest.
- **Sign-in methods via a user flow** (email + password or email one-time passcode). Enable MFA, and prefer non-SMS methods because SMS/phone events are billed. Confirm which MFA methods external tenants currently support.

Flow (BFF, ADR 004):
1. **Login.** `GET /auth/login` on the web server generates the PKCE verifier, `state` and `nonce`, stores them in a short-lived signed cookie, and redirects to Entra. Never use implicit flow.
2. **Callback.** `GET /auth/callback` checks `state`, then redeems the code with `@azure/msal-node` (client credential + PKCE verifier). MSAL validates the ID token. The server creates a **new** session ID (rotated on every login, to prevent session fixation), stores the MSAL token cache in the session store, sets the session cookie, and redirects to the app.
3. **Requests.** For each request that needs the API, a server function loads the session, calls `acquireTokenSilent` for the API scope (MSAL refreshes it using the refresh token when needed), and calls Fastify with `Authorization: Bearer <access token>`. **Access and refresh tokens never reach the browser.**
4. **Logout.** `POST /auth/logout` deletes the session row, clears the cookie, and redirects to Entra's end-session endpoint.
5. **Session lifetime:** idle timeout plus absolute timeout. When a refresh fails, the session ends and the user signs in again.

Session cookie: `__Host-session`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`. It contains only a random session ID.

Session store: a Postgres `web_sessions` table holding the session ID hash, `user_id` (`oid`), the MSAL token cache **encrypted with a key from config/Key Vault**, `created_at`, `last_seen_at` and `expires_at`. The web server connects as a dedicated `app_web` role that can access **only** this table. A cookie-only session isn't possible because the token cache is too large for a cookie. **Confirm this design in a Phase 2 ADR.**

CSRF: `SameSite=Lax` blocks most cross-site writes. In addition, every non-GET server function and auth route checks that the `Origin` header matches the app origin. GETs never change state.

API (Fastify):
- **Validate every request's access token with `jose`.** Fetch and cache the JWKS from the tenant's OIDC metadata (`.well-known/openid-configuration`).
- **Checks:** signature, `iss`, `aud` (the API's client ID or Application ID URI), `exp`/`nbf`, and the required scope in the `scp` claim.
- **Reject everything else:** 401 for a bad token, 403 for a missing scope.
- **This is the same whether the caller is the BFF or, later, another client.** Internal ingress is defense in depth, not a replacement for token checks.
- **Never accept ID tokens at the API.** ID tokens are for the web server's login. The API only accepts access tokens issued for it.
- User identifier: the access token's `oid` claim (stable object ID for the user in the tenant), stored as `text` in `user_id` columns. No foreign key to an auth table. Verify the claim is present in tokens from the external tenant.
- Optional: a small local `users` table keyed by `oid` for profile data and account-deletion cleanup.

Cost and caveats:
- Free for the first 50,000 monthly active users; SMS/phone MFA events are billed per event.
- Setup is heavier than Clerk or Auth0 and the portal/docs can be fiddly.
- Terraform: the `azuread` provider manages app registrations, API scopes, web redirect URIs and the client secret (`azuread_application_password`) as code (it must authenticate against the external tenant and have Graph permissions). I have not verified that the external tenant itself, or its user flows, can be created via Terraform. Plan on creating the tenant and user flows once by hand, documenting the settings in the repo, and managing the app registrations in `/infra`.
- Lock-in: the API depends only on standard OIDC metadata plus a few claims, so moving to another OIDC provider later means changing the issuer/audience config, the web server's OIDC client, and mapping user IDs. Because the OIDC client is on the server, the browser code doesn't change at all.

### Data sources
| Choice | Why | Alternative |
|---|---|---|
| Finnhub (quotes, news) | Generous free tier; fetch live, cache, don't store prices | Twelve Data / Financial Modeling Prep; yahoo-finance2 (unofficial, can break) |
| VADER lexicon scoring, store raw snippet + score | Cheap and fast; raw text allows re-scoring later | LLM scorer (better on finance language and sarcasm; adds cost and latency) |

Check provider terms and rate limits (free tiers may be delayed ~15 min). Batch symbol lookups. Sentiment APIs rarely give history, so the stored snapshots are the valuable dataset.

### Delivery and operations
| Choice | Why | Alternative |
|---|---|---|
| GitHub Actions | Test, build, push, deploy per environment | Azure DevOps Pipelines |
| TDD (red → green → refactor) from the first feature code, frontend and backend: Vitest everywhere, Fastify `inject` for routes, real Postgres for data-layer tests, React Testing Library + MSW for UI, Playwright for a few end-to-end journeys | Learning project: tests define behaviour before code and make refactoring safe. See `docs/ROADMAP.md` | Test-after (faster to start, weaker design feedback) |
| Terraform | Cloud-agnostic, transferable skill | Bicep (Azure-native, no state file) |
| GitHub Container Registry (GHCR) | Free for private images | Azure Container Registry (~$5/month Basic) |
| pino + Sentry + Azure Monitor | Structured logs, error tracking, built-in metrics | OpenTelemetry + Grafana Cloud |
| Azure Key Vault + managed identity (target) | Audit logs, rotation, no secrets in config | Container Apps secrets (simpler, fine to start) |
| Monorepo with shared types | One source of truth for API contracts | Separate repos (independent deploys, no shared types) |

## 4. Terraform notes

- Providers: `azurerm` (use `azapi` where Container Apps features lag), `azuread` (Entra app registrations and scopes), and `supabase/supabase`.
- Remote state in an Azure Storage blob container with locking. Never keep state in git or only locally.
- GitHub Actions authenticates to Azure via OIDC federation (no stored client secret).
- Pipeline: `terraform plan` on pull requests, `terraform apply` on merge to main.
- Image flow: Actions builds and pushes images to GHCR, then Terraform (or `az containerapp update`) points apps at the new tag.
- Layout: `/infra` with `main.tf`, `variables.tf`, and per-environment folders or tfvars (`staging`, `prod`).
- **Scope:**
  - **Container Apps environment** containing:
    - the **web app**: public ingress, custom domain
    - the **API app**: internal ingress only
    - the **worker job**
  - **Secrets / Key Vault:** the web client secret, the session-encryption key, and DB connection strings.
  - **Supabase:** the project and its settings.
  - **Entra:** app registrations, scopes and the web client secret, via `azuread`. The external tenant and user flows are likely one-time manual setup (see the auth section).
- **The web app calls the API by its internal FQDN.** The API's address is passed to the web app as an environment variable.

## 5. Data model (initial)

Every user-owned table carries `user_id text not null` (the access token's `oid` claim, see the auth section).

- `watchlist`: id, user_id, symbol, added_at, notes
- `holdings`: id, user_id, symbol, quantity, avg_cost
- `sentiment` (shared by symbol, not user-owned): id, symbol, ts, source, source_id, score, raw_snippet. Unique on `(source, source_id)` so worker inserts are idempotent (`ON CONFLICT DO NOTHING`). Shared so each symbol is scraped once regardless of how many users track it; the worker polls the distinct symbols across all watchlists.
- `web_sessions` (owned by the web app, accessed only through the `app_web` role): id (hash of the cookie's session ID), user_id, token_cache (encrypted), created_at, last_seen_at, expires_at. A cleanup job deletes expired rows.
- Prices are not stored. Quotes are fetched live and cached (30-60s). Historical price charts are fetched on demand.
- pg-boss manages its own schema for queue tables.

## 6. Authorization: data-access layer and RLS

Goal: a forgotten `WHERE user_id = ...` must not be able to leak another user's data.

Layer 1, application scoping (build first):
- All DB access goes through each feature slice's repository (`server/src/features/<feature>/*.repository.ts`, ADR 002). Every repository function requires a verified `userId` and runs inside the shared `withUser(userId, fn)` helper in `server/src/shared/db/`. No route handler talks to the DB directly. `withUser()` is the single security choke point, so it has its own isolation tests.
- Every query on user-owned tables filters by that `userId`.

Layer 2, Postgres Row Level Security (add once the schema settles, as defense in depth):

```sql
ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist FORCE ROW LEVEL SECURITY;

CREATE POLICY owner_only ON watchlist
  USING (user_id = current_setting('app.user_id', true))
  WITH CHECK (user_id = current_setting('app.user_id', true));
```

Per request, the data-access layer opens a transaction and sets the caller:

```ts
await db.transaction(async (tx) => {
  await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
  // every query in this transaction is filtered by the policy
});
```

Rules that make this safe:
- The third argument `true` makes the setting transaction-local. This is required with Supabase's pooler, where connections are shared between requests; a session-level setting could leak one user's ID into another request.
- RLS is bypassed by table owners and roles with `BYPASSRLS` (hence `FORCE`). The API connects as a dedicated non-owner role.
- Use separate roles:
  - `app_api`: RLS enforced.
  - `app_worker`: legitimately needs cross-user reads for polling.
  - `app_web`: can access only `web_sessions`, nothing else.
  - `app_migrator`: schema changes.
- Policies live in migrations alongside the schema.
- RLS applies to user-owned tables only (`watchlist`, `holdings`, `users`). The shared `sentiment` table has no RLS; `app_api` gets read-only access to it and only `app_worker` can insert.
- Add an integration test, run against the real policies, proving user A cannot read or write user B's rows. Also test that a request without a user context returns nothing.
- Cost of RLS: some overhead, and failures look like silently empty results, so debugging is harder.

## 7. Security baseline

- Access token validation on every request: signature, issuer, audience, expiry, required scope. Reject anything else with 401/403. Never accept ID tokens at the API.
- Authorization on every query via the data-access layer (+ RLS).
- **Tokens never reach the browser.** Access and refresh tokens live only in the encrypted server-side session store, and nothing token-related goes in `localStorage`, `sessionStorage` or readable cookies.
- **Session cookie:** `__Host-` prefix, `HttpOnly`, `Secure`, `SameSite=Lax`. The session ID is rotated on login. Sessions have idle and absolute timeouts and are deleted on logout.
- **CSRF:** `SameSite=Lax`, plus an `Origin` check on every state-changing request. GETs never change state.
- **API not publicly reachable:** internal ingress only, and the API still validates every token (defense in depth). CORS isn't needed, so it's disabled.
- **Strict security headers set by the web server:** a nonce-based Content-Security-Policy (SSR inlines hydration scripts, so they need a per-request nonce), HSTS, `X-Content-Type-Options`, `Referrer-Policy` and `frame-ancestors 'none'`.
- **Never send server-only data to the client:** keep secrets, tokens and session internals out of loader return values and the serialized query cache.
- MFA enabled in the Entra user flow, using non-SMS methods where possible.
- Per-user and per-IP rate limiting; log auth failures and alert on spikes.
- Secrets: Key Vault with Container Apps managed identity as the target; never in the repo or image.
- Least-privilege DB roles as above.
- CI: Dependabot, secret scanning, container image scanning, `npm audit`.
- Input validation with zod on every route; parameterized queries only (Drizzle).
- Respect data-source terms of service for scraping and caching.

## 8. API surface (initial sketch)

- `GET /api/v1/watchlist`, `POST /api/v1/watchlist`, `DELETE /api/v1/watchlist/:symbol`
- `GET /api/v1/holdings`, `PUT /api/v1/holdings/:symbol`
- `GET /api/v1/quotes?symbols=AAPL,MSFT` (batched, cached)
- `GET /api/v1/sentiment/:symbol?from=&to=`
- `GET /healthz`

All routes except `/healthz` require a valid Entra-issued access token carrying the `access_as_user` scope.

These routes are internal. The browser never calls them directly; it goes through the web app's server functions (for example `getWatchlist`, `addToWatchlist`, `getQuotes`), which call these routes on the user's behalf.

The web app's own HTTP surface is:
- the SSR pages
- the server function endpoints, managed by TanStack Start
- `GET /auth/login`, `GET /auth/callback`, `POST /auth/logout`
- `GET /healthz`

## 9. Worker jobs

- Sentiment poll: every ~15-30 minutes per tracked symbol. Fetch headlines/Reddit posts, score with VADER, insert a `sentiment` row.
- Jobs must be idempotent and retryable, with per-provider rate limiting and backoff.
- Runs as a Container Apps Job on a cron schedule, connecting as the `app_worker` role.

## 10. Repo layout

```
/web              TanStack Start app (SSR + BFF, ADR 004)
  src/routes/                 pages (file routes): thin; auth routes (/auth/login, /auth/callback, /auth/logout)
  src/components/{atoms,molecules,organisms,templates}/   atomic design (ADR 003)
  src/api/                    TanStack Query options/hooks whose queryFn calls server functions
  src/server/                 server-only BFF code: session store, msal-node client, API client, server functions
/server           Fastify API
  src/features/<feature>/     vertical slices: routes, repository, service, tests (ADR 002)
  src/shared/                 auth plugin, db + withUser(), config, errors
/worker           pg-boss worker
  src/jobs/<job>/             one slice per job
/packages/types   shared TypeScript types and zod schemas (one file per feature)
/infra            Terraform
/.github/workflows  CI/CD
```

Drizzle table definitions are shared between server and worker, so they don't live in a slice. Their location (likely `packages/db`) is decided in Phase 3.

## 11. Environments and config

- `staging` and `prod`, separated by Terraform environment config. Use separate Entra app registrations (or external tenants) and separate Supabase projects per environment.
- 12-factor: config via environment variables, secrets via Key Vault/Container Apps secrets, nothing assumes a single machine.
- Never commit API keys.

## 12. Cost expectations

- **Container Apps:** near $0 with scale-to-zero and the monthly free grant, now shared by two apps (web and API) plus the worker job. Always-on replicas will exceed the grant.
- **SSR cold starts:** if the web app scales to zero, the first visitor after an idle period waits for a cold start before seeing *any* page. Accept that while it's personal use. Setting `minReplicas: 1` on the web app removes it but costs a few dollars a month, so verify the price before turning it on.
- Supabase: Free ($0, 500 MB DB, 2 projects, pauses after 7 days idle) or Pro ($25/month, 8 GB, no pause).
- Entra External ID: free for the first 50,000 monthly active users (SMS/phone MFA events are billed, so avoid SMS).
- GHCR, GitHub Actions (personal use): free.
- Total: roughly $0-5/month on free tiers, ~$25-30/month on Supabase Pro.

Pricing and free-tier limits change. Re-verify before committing.

## 13. Suggested build order

1. Supabase project (Postgres only), schema with `user_id text`, Drizzle migrations, DB roles
2. Entra external tenant + app registrations, BFF login on the web server (`@azure/msal-node`, session store, cookie), Fastify access-token validation (`jose`)
3. Data-access layer scoped by `userId` (with the cross-user isolation test)
4. API: watchlist, holdings, quotes (Finnhub + cache)
5. TanStack Start UI (SSR): watchlist, ticker detail, holdings P&L
6. Add RLS policies on top of the data-access layer
7. Worker: sentiment polling via pg-boss, scoring, snapshots
8. Dockerfiles, GitHub Actions CI, GHCR push
9. Terraform for Azure (+ Supabase) with remote state and OIDC
10. Observability: pino, Sentry, health checks, Azure Monitor; Key Vault migration
11. Hardening: rate limits, OpenAPI, CSP, staging/prod split

Doing everything at once will stall the actual product. Steps 1-5 deliver a usable app.

The actual delivery order is in `docs/ROADMAP.md`: it deploys a walking skeleton (steps 8-9 in minimal form) first, then grows the app through that pipeline.

## 14. Open questions

- Chart library choice
- Whether free Supabase stays active given scheduled writes, or go to Pro immediately
- Which news/Reddit sources to use and their terms of use
- Custom domain and DNS provider
- Whether Terraform can create the Entra external tenant and user flows, or they stay one-time manual setup
- Which MFA methods external tenants support (avoid billed SMS)
- Confirm `oid` and `scp` claims appear as expected in access tokens from the external tenant
- Pin and verify the current stable TanStack Start version, its Node/Docker deployment output, and the Router–Query SSR integration before scaffolding
- Session store: confirm a Postgres `web_sessions` table with the `app_web` role (vs. another store), the encryption approach for the token cache, and the idle/absolute timeout values (Phase 2 ADR)
- Web client credential: a client secret to start; when to switch to a certificate
- Whether to accept SSR cold starts or run the web app with `minReplicas: 1`
- Confirm Container Apps internal ingress and internal FQDN behaviour for web → API calls
