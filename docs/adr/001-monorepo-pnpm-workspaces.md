# ADR 001: Monorepo with pnpm workspaces

- Status: accepted
- Date: 2026-10-15

## Context
The frontend, API, worker and shared types change together. API contracts (zod schemas) should be one source of truth. There is a single developer.

## Decision
- **One repo, pnpm workspaces:** `web`, `server`, `worker`, `packages/*`.
- **Shared code as TypeScript source:** shared packages export their source directly (no build step). This works with Vite, Vitest and a bundled server build.
- **Tooling:** ESLint (typescript-eslint strict, type-checked) and Prettier. Vitest in every package.
- **TypeScript is pinned to 6.0.x** because typescript-eslint does not yet support TS 7.
- **Dependencies are pinned to exact versions** that are at least two weeks old. Dependabot uses a 14-day cooldown.

## Alternatives
- **Separate repos:** independent histories, but shared types would have to be published and versioned.
- **Turborepo / Nx:** task caching and graph tooling, which is unnecessary at this size and can be added later.
- **Biome instead of ESLint + Prettier:** faster and one tool, but a smaller plugin ecosystem (React hooks, TanStack rules).

## Consequences
- Per-path CI filters will be needed so each app deploys only when it changes (Phase 1).
- **Server container options for Phase 1:** run the TS directly with Node 24's built-in type stripping, or bundle with esbuild/tsup.
  - The base tsconfig sets `erasableSyntaxOnly` and allows `.ts` import extensions to keep the first option open (no enums, namespaces or parameter properties).
  - Verified 2026-10-15: `node` on Node 24.18 imports `@stock-tracker/types` from `server/` through the workspace symlink, with no build step.
