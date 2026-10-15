---
name: ship
description: Get a change into main through a PR. Covers branch, safe staging, commit, push, opening the PR, waiting for CI and squash-merging. Use whenever work is ready to commit or the user says ship it, commit, open a PR, or merge.
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

## 5. Push and open the PR
```bash
git push -u origin HEAD
gh pr create --fill --body "<why, what changed, how it was tested>"
```

## 6. Wait for CI, then merge
```bash
gh pr checks --watch
gh pr merge --squash --delete-branch
git switch main && git pull --ff-only
```
- Merge only on green.
- **Confirm with the user before merging** unless they've already said to merge.
- If CI fails, fix it on the branch and push again. Don't bypass the check.

## Dependabot PRs
Merge them one at a time. Each merge makes the others out of date; Dependabot rebases them itself, or comment `@dependabot rebase`. Close any PR that breaks repo policy (for example a major `@types/node` bump that doesn't match Node) and explain why in a comment.
