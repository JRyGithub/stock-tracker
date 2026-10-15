# ADR 002: Vertical slice architecture for the backend

- Status: accepted
- Date: 2026-10-15

## Context
The usual layered layout (`routes/`, `services/`, `repositories/`) spreads one feature across many folders, so a single change touches all of them. The API is built feature by feature (watchlist, holdings, quotes, sentiment), which matches how the roadmap delivers it. Spec §6 requires that a forgotten `WHERE user_id = …` can't leak data. Slices must keep that guarantee.

## Decision
Organize `server/` (and `worker/`) by **feature**, not by technical layer:

```
server/src/
  index.ts                 starts the server
  app.ts                   builds the Fastify app: registers shared plugins and each feature's routes
  shared/                  cross-cutting code only
    auth/                  access-token validation plugin (jose)
    db/                    client, withUser(userId, fn) transaction helper (sets app.user_id for RLS)
    config.ts, errors.ts
  features/
    watchlist/
      watchlist.routes.ts        Fastify plugin with this slice's routes
      watchlist.repository.ts    this slice's queries, always run through withUser()
      watchlist.service.ts       only once logic outgrows the route handler
      watchlist.routes.test.ts   tests live inside the slice
    holdings/  quotes/  sentiment/  me/
worker/src/
  jobs/<job-name>/               the same idea applied to each job
```

Rules:
- **Slices don't import from each other.** If two slices need the same thing, move it to `shared/`, but only when that duplication actually exists.
- **Route handlers never touch the DB.** Each slice's `*.repository.ts` is its data access, and every repository function takes a verified `userId` and runs inside `withUser()`. This is how spec §6's "data-access layer" works in this layout: a shared contract and helper rather than a single module.
- **API contracts (zod) live in `packages/types/src/<feature>.ts`,** so the web app can share them.
- **Drizzle table definitions are shared, not per-slice:** the worker needs them too, and migrations have to be generated from one place. The exact location (likely `packages/db`) is decided in Phase 3.

## Alternatives
- **Layered (routes/services/repositories):** familiar, but a feature is scattered across folders, and layers tend to grow for their own sake.
- **Clean or hexagonal architecture:** strong boundaries, but too much ceremony for an app this size.

## Consequences
- A feature can be added, changed or deleted inside one folder. This also suits TDD, since the tests sit next to the slice.
- There's some deliberate duplication between slices. That's accepted until a real shared need appears.
- `withUser()` is the security choke point, so it gets its own isolation tests.
