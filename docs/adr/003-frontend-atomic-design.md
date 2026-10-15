# ADR 003: Atomic design for the frontend

- Status: accepted
- Date: 2026-10-15

## Context
The UI reuses many small pieces: price-change badges, symbol inputs, quote cells and charts. Without a clear structure, components grow ad hoc and data fetching leaks into presentational components, which makes them hard to test and reuse.

## Decision
Organize `web/src/components/` by **atomic design** level, with TanStack Start's file routes as the pages:

```
web/src/
  routes/                  pages: thin route files (loaders, search-param validation, composition)
  components/
    atoms/                 Button, Input, Badge, PriceChange: smallest units, props only
    molecules/             SymbolSearchField, QuoteCell: a few atoms combined, props only
    organisms/             WatchlistTable, HoldingsSummary, PriceChart: page sections; may use query hooks
    templates/             AppShell, TickerLayout: page layouts with slots (children); no data
  api/                     TanStack Query queryOptions/hooks per resource; queryFn calls server functions
  server/                  server-only BFF code (session, msal-node, API client, server functions); see ADR 004
```

Rules:
- **Imports flow downward only:**

  | Level | May import |
  |---|---|
  | `routes` | anything |
  | `templates` | organisms, molecules, atoms |
  | `organisms` | molecules, atoms |
  | `molecules` | atoms |
  | `atoms` | no other components |

  Nothing imports upward or sideways within the same level, except atoms, which may use other atoms.
- **Data fetching happens only in routes and organisms,** through `api/` hooks. Atoms, molecules and templates are pure and take props only.
- **Components never import from `server/` directly.** They reach it only through server functions, so server-only code can't end up in the client bundle.
- **One folder per component:** `Component.tsx` and `Component.test.tsx`, plus an optional `index.ts`.
- **If a component's level isn't obvious, choose the lower one,** and move it up when it gains responsibilities.

## Alternatives
- **Feature folders on the frontend too:** they would mirror the backend slices, but shared UI pieces would have no obvious home.
- **Flat `components/`:** fine at first, but it gets messy, and nothing separates presentational components from connected ones.

## Consequences
- Presentational components (atoms, molecules, templates) can be tested without MSW or a router, because they only take props.
- The boundaries are easy to argue about, so the "choose the lower level" rule settles it.
- When `web/` is scaffolded (Phase 1), enforce the import direction with ESLint `no-restricted-imports` overrides per folder, so the rule is checked automatically.
