---
name: phase-retro
description: Close out a roadmap phase by verifying its "Done when" check and writing a short retro note in docs/ROADMAP.md. Use when the user says a phase is finished, asks for a retro, or wants to move on to the next phase.
---

# Closing a roadmap phase

## 1. Check "Done when"
Find the phase in `docs/ROADMAP.md` and check each part of its **Done when** line with evidence, for example:
- `pnpm check` output
- `gh run list --workflow ci.yml --limit 3`
- a URL that responds

If anything isn't met, say so plainly. The phase isn't done.

## 2. Gather facts for the retro
Go back over the phase: commits (`git log --oneline`), PRs (`gh pr list --state merged`), ADRs added, and anything that went wrong or surprised you.

## 3. Ask the owner what they learned
This is a learning project. **The "Learned" section is theirs.** Offer a draft based on the questions they asked during the phase, but let them correct it or replace it.

## 4. Write the note
Add it directly under that phase's **Done when** line:

```markdown
**Retro (YYYY-MM-DD):** ✅ Done.
- **Went well:** …
- **Surprises:** …
- **Learned:** …
- **Carried forward:** … (items for later phases; also add each to the relevant phase's bullets)
```

Keep each bullet to one line. If a "carried forward" item belongs to a later phase, add it to that phase's list too.

## 5. Ship it
Use the `ship` skill, with a commit like `docs: Phase N retro`.
