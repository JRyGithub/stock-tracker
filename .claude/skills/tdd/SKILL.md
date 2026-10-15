---
name: tdd
description: Test-driven development loop (red → green → refactor) for this repo's frontend and backend. Use when implementing any new behaviour, API route, data-layer function, worker job, UI component, or bug fix. Always TDD; only pure scaffolding, config and Terraform are exempt.
---

# TDD in Stock Tracker

Follow this loop for every behaviour. Show the owner each step: it's a learning project.

## 1. Red: write one failing test
- Put the test next to the code: `foo.ts` → `foo.test.ts`.
  - **Backend:** inside the feature slice, for example `server/src/features/watchlist/watchlist.routes.test.ts` (ADR 002).
  - **Frontend:** inside the component folder, for example `web/src/components/molecules/QuoteCell/QuoteCell.test.tsx` (ADR 003). Atoms, molecules and templates are props-only, so their tests don't need MSW or a router.
- Name it after behaviour, not implementation: `rejects a token with the wrong audience`, not `calls jwtVerify`.
- Run **only that package's tests** and confirm the test fails **for the right reason**: an assertion failure or a missing export, not a typo or a config error.
  ```bash
  pnpm --filter @stock-tracker/<pkg> test
  ```
- If it passes straight away, the test is wrong or the behaviour already exists. Investigate before going on.

## 2. Green: write the minimum code to pass
- No extra features or speculative options. Ugly is fine at this stage.
- Re-run and confirm green.

## 3. Refactor
- Improve names, remove duplication, and pull out helpers while staying green.
- Run `pnpm check` (lint, format, typecheck, all tests) before committing.

## 4. Repeat
One behaviour per cycle. A good order: rejection and error cases first, then the happy path, then edge cases.

## What to test, and with what

| Layer | Tooling | Notes |
|---|---|---|
| Shared schemas (`packages/types`) | Vitest | `it.each` tables of valid and invalid inputs |
| API routes (`server`) | Vitest + Fastify `app.inject()` | Assert status, body shape (parse with the zod schema), and 401/403 cases. No real network. |
| Auth plugin | Vitest + `jose` `generateKeyPair` | Sign your own test tokens. Cover every rejection case: wrong `aud`/`iss`, expired, missing `scp`, ID token, no header. |
| Data layer | Vitest + real Postgres (`pnpm db:up`) | **Never mock the DB.** Always include a cross-user isolation case: user A can't read or write user B's rows. |
| Worker jobs | Vitest + faked HTTP (MSW or injected client) | Running the same job twice must create no duplicates. Cover retry and backoff. |
| BFF (`web/src/server`) | Vitest, with `@azure/msal-node` and the API client faked; a real Postgres session store | Cookie flags, session rotation on login, `state` mismatch rejected, cross-origin POST rejected, expired session redirects, and **no token in any response or serialized cache** |
| UI (`web`) | Vitest + React Testing Library + MSW | Query by role or label, the way a user would. Cover loading, error and empty states. |
| E2E (Phase 5+) | Playwright | Only a few critical journeys |

## Rules
- Make tests deterministic: use `vi.useFakeTimers()` for TTLs, cron and backoff, and fixed dates.
- No real third-party calls (Finnhub, Reddit, Entra) in tests.
- **Bug fix:** reproduce the bug with a failing test first, then fix it.
- Don't weaken or delete a failing test to get to green. Fix the code, or explain why the test was wrong.
