# ADR 004: SSR with TanStack Start as a Backend-for-Frontend

- Status: accepted
- Date: 2026-10-15
- Replaces the "TanStack Start in SPA mode on Static Web Apps" decision in spec v4.

## Context
Spec v4 used TanStack Start in SPA mode: a static shell on Azure Static Web Apps, with MSAL in the browser holding tokens. That setup gets almost all of its value from TanStack Router, so Start added little, and its build-time shell prerender caused a "no `window`" problem for MSAL.

The owner wants SSR from the start, mainly to learn SSR and the **Backend-for-Frontend (BFF)** auth pattern. BFF is the current best-practice recommendation for browser apps: tokens stay on a server, so an XSS bug in the page can't steal them. It also gives a stronger security model before the app is opened to other users (Phase 10).

What doesn't help this app: SSR's SEO and first-paint benefits. All pages are behind login and personal to each user.

## Decision
- **TanStack Start with SSR** runs as a Node server in a **second Container App** (`web`), with public ingress, in the same environment and pipeline as the API.
- **The web server is the OAuth client (BFF).**
  - `@azure/msal-node` acts as a **confidential client**: auth code + PKCE, with a client secret to start, a certificate later, and the secret in Key Vault.
  - The browser holds only a `__Host-session` cookie (`HttpOnly`, `Secure`, `SameSite=Lax`). The session ID is rotated on login, with idle and absolute timeouts.
  - The token cache is stored encrypted in Postgres `web_sessions`, through an `app_web` role that can access only that table.
  - CSRF: `SameSite=Lax` plus an `Origin` check on state-changing requests.
- **Server functions are thin proxies.** They load the session, get an access token silently, and call Fastify with a Bearer token. They hold no business logic and touch no database other than the session store. **Fastify stays the only business backend.**
- **Fastify gets internal-only ingress** and is unchanged otherwise: it still validates every access token (`iss`, `aud`, `exp`, `scp`).
- **Static Web Apps is dropped.**

## Alternatives
- **Vite + TanStack Router SPA with MSAL in the browser:** simplest, with all the routing benefits and one container. But tokens sit in browser storage, and there's no SSR to learn.
- **Start in SPA mode (v4):** the extra framework layer for almost no benefit, plus the prerender problem.
- **Next.js:** more mature SSR and a larger ecosystem, but heavier and more opinionated, and it moves away from TanStack Router's type-safe routing.
- **Session in an encrypted cookie only:** stateless, but the MSAL token cache (ID, access and refresh tokens) is too big for a 4 KB cookie.

## Consequences
- **Gets easier and safer:**
  - Tokens are out of reach of page JavaScript.
  - The API has no public surface, and CORS disappears.
  - Moving to another OIDC provider later only changes server code.
  - Server functions give end-to-end types.
- **Gets harder:**
  - **Phase 1:** a second container, plus SSR and hydration issues (code runs in two environments).
  - **Phase 2:** confidential-client flow, session store, cookie security and CSRF.
  - **SSR cold starts:** the first page after idle waits for the web container to start. That's accepted for personal use, and `minReplicas: 1` fixes it for money.
  - **More Container Apps usage** within the free grant.
- **New risk:** the web server holds refresh tokens. Session-store encryption, key handling and the `app_web` role's least privilege become security-critical, and get their own tests.
- **Follow-ups:** confirm the session-store design in a Phase 2 ADR. Verify the TanStack Start deployment output and the Router–Query SSR integration when scaffolding (Phase 1).
