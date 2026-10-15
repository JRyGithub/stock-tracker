@AGENTS.md

## Claude Code specifics
- Project skills live in `.claude/skills/`: `tdd`, `ship`, `adr`, `add-dependency`, `phase-retro`.
- `.claude/settings.local.json` is per-user and gitignored. Never commit it.
- Never run `git push` or `gh pr merge` without asking first in that same turn, even if a push was approved earlier.
