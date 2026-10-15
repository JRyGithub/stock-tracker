# Agent guide: Stock Tracker

These rules are for any AI agent or new contributor working in this repo. Read them before making changes.

## Read first
- `spec.md`: architecture and decisions, with the reason for each and the alternatives considered. **Don't re-litigate decisions recorded there.** If something seems wrong, raise it and propose an ADR.
- `docs/ROADMAP.md`: phased plan. Work only on the current phase unless asked otherwise. Each phase has a "Done when" check.
- `docs/adr/`: decision records. Check them before proposing tooling or architecture changes.

## This is a learning project
The owner is learning **Node APIs and Postgres, OAuth/OIDC with Entra, and cloud/IaC/CI-CD** (they're comfortable with React and TypeScript).
- **Explain why**, not just what, for choices in those areas. Give short explanations with concrete examples.
- Don't hand over large unexplained diffs. Prefer small, reviewable steps.
- When there's a real trade-off, give a recommendation, and keep the alternatives brief.

## Commands
Node 24 (`.nvmrc`). Run pnpm through corepack; the version is pinned in `package.json`. In non-interactive shells, nvm may need loading first: `source ~/.nvm/nvm.sh && nvm use`.

```bash
pnpm install
pnpm check            # lint + format:check + typecheck + test (exactly what CI runs)
pnpm test             # all workspace tests
pnpm --filter @stock-tracker/types test   # one package
pnpm format           # apply prettier
pnpm db:up / db:down  # local Postgres 17 via docker compose
```

**Run `pnpm check` before saying any work is done.** Report failures as they are; don't hide them.

## Layout
pnpm monorepo:
- `web/`: TanStack Start, SPA mode
- `server/`: Fastify API
- `worker/`: pg-boss jobs
- `packages/types/`: shared zod schemas and types
- `infra/`: Terraform

Shared packages export TypeScript source directly (`exports` points to `src/index.ts`); they have no build step.

## TypeScript rules
- `strict` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, and `erasableSyntaxOnly`. ESLint uses typescript-eslint `strictTypeChecked`. **Don't loosen these, and don't silence errors** with `any`, `as` casts, `@ts-ignore` or `eslint-disable` unless you leave a comment justifying it.
- `erasableSyntaxOnly`: no `enum`, `namespace` or constructor parameter properties. Use `as const` objects or union types instead. This lets Node 24 run `.ts` files directly through type stripping.
- Relative imports include the `.ts` extension: `import { x } from './x.ts'`.
- API contracts live in `packages/types` as zod schemas. Derive TS types with `z.infer`. Never define the same shape twice.
- ESM only (`"type": "module"`).

## Testing: TDD from Phase 2 onward
Use red → green → refactor for frontend and backend alike. Use the `tdd` skill. Infra and scaffolding are the exception.
- Tests sit next to the code as `*.test.ts`.
- Data-layer tests run against real Postgres, never mocks.
- No real third-party network calls in tests. Fake them with MSW or injected clients.
- Every bug fix starts with a failing regression test.

## Git and PRs
- **`main` is protected:** every change goes through a PR, with CI's `check` passing, squash-merged. Use the `ship` skill.
- **Before every commit, run `git status` and review exactly what's staged.** Stage files explicitly; never stage everything blind. Temp files have already leaked into history once.
- Never commit secrets or `.env` files. Never force-push `main`.
- Commit messages: an imperative summary line, then a body explaining *why*.

## Dependencies
Use the `add-dependency` skill:
- Pin exact versions only, with no `^` or `~`.
- Only use releases at least 14 days old.
- Check peer dependency ranges before upgrading.
- Keep `@types/node` on the same major as the Node runtime.

## Security rules (from spec §6-7, non-negotiable)
- The API accepts **only access tokens** issued for it. Check signature, `iss`, `aud`, `exp`/`nbf` and the `scp` scope. Never accept ID tokens.
- **All DB access goes through the data-access layer**, and every function takes a verified `userId`. Route handlers never query the DB directly.
- Validate every input with zod. Use only parameterized queries (Drizzle).
- Configuration comes from environment variables. Secrets never go in the repo, images or logs, and tokens are never logged.

## Docs to keep current
- **A non-trivial decision** gets a new ADR (`adr` skill). If it changes the architecture, update `spec.md` too.
- **Finishing a phase:** tick its "Done when" and add a retro note in `docs/ROADMAP.md` (`phase-retro` skill).

## Ask before
- Anything outward-facing or hard to reverse: repo settings, deleting things, pushing to `main`, cloud resources, `terraform apply`, anything that costs money.
- Changing architecture recorded in `spec.md`.
