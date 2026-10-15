---
name: ship
description: Get a change into main through a PR. Covers branch, safe staging, commit, confirmed push, opening the PR, waiting for CI and confirmed squash-merge. Use whenever work is ready to commit, push or merge, or the user says ship it, commit, open a PR, or merge.
---

# Shipping a change

`main` is protected: a PR is required, the CI `check` must pass, the branch must be up to date, and only squash merges are allowed. Admins aren't exempt, so never push to `main` directly.

## 1. Branch
```bash
git switch main && git pull --ff-only
git switch -c <type>/<short-kebab-description>   # feat/, fix/, chore/, docs/, test/, refactor/
```

## 2. Verify
```bash
pnpm check
```
Don't continue on red. Report the failure.

## 3. Stage carefully (the repo has been bitten by this before)
```bash
git status --short
git add <explicit paths>      # never `git add -A`, `git add .`, or `git commit -a` blindly
git diff --cached --stat      # review exactly what's going in
```
Check the staged files for:
- temp files, `.env*`, `.claude/settings.local.json`, build output, or secrets
- unrelated changes, which belong in their own PR

## 4. Commit
- Summary: imperative mood, ≤ 72 characters ("Add watchlist route", not "Added…").
- Body: **why** the change was made and any trade-offs. The diff already shows what changed.
- Add any attribution lines the environment requires.

## 5. STOP: get the owner's confirmation to push
**Every push needs explicit confirmation, every time**: new branches, follow-up pushes and force-pushes. Show:
```bash
git log --oneline origin/main..HEAD     # or origin/<branch>..HEAD for a follow-up push
git diff --stat origin/main...HEAD
```
Then ask, "OK to push `<branch>` (N commits) and open a PR?" and wait for a yes. An earlier yes doesn't cover this push.

## 6. Push and open the PR (only after the yes)
```bash
git push -u origin HEAD
gh pr create --fill --body "<why, what changed, how it was tested>"
```

## 7. Wait for CI, then STOP again before merging
```bash
gh pr checks --watch
```
- Report the result, and ask before merging, because merging is a push to `main`.
- Merge only on green and only after a yes:
  ```bash
  gh pr merge --squash --delete-branch
  git switch main && git pull --ff-only
  ```
- If CI fails, fix it on the branch, then go back to step 5 before pushing the fix.

## Dependabot PRs
Merging these also needs the owner's confirmation. Merge them one at a time. Each merge makes the others out of date; Dependabot rebases them itself, or comment `@dependabot rebase`. Close any PR that breaks repo policy (for example a major `@types/node` bump that doesn't match Node) and explain why in a comment.
