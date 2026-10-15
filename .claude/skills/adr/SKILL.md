---
name: adr
description: Write an Architecture Decision Record in docs/adr/. Use when making or changing a non-trivial technical choice (library, tool, hosting, data model, auth, pattern), or when the user asks to record or document a decision.
---

# Writing an ADR

ADRs record **why** a decision was made, so later you, or another agent, don't undo it by accident. They are short. Aim for one screen.

## Steps
1. Find the next number:
   ```bash
   ls docs/adr/
   ```
   Numbers are zero-padded to three digits.
2. Create `docs/adr/NNN-kebab-title.md` using the template below.
3. If the decision changes anything in `spec.md`, update the spec in the same PR and add a line to its change log.
4. If it replaces an earlier ADR, mark the old one `Status: superseded by NNN`. Never delete ADRs.
5. Ship it through a PR (`ship` skill), ideally with the code it describes.

## Template
```markdown
# ADR NNN: <Decision as a short phrase>

- Status: proposed | accepted | superseded by NNN
- Date: YYYY-MM-DD

## Context
What problem or force led to this decision? What are the constraints (cost, learning goals, free tiers, single developer)?

## Decision
What was chosen, stated plainly. Include versions or config where relevant.

## Alternatives
- **Option**: why it wasn't chosen (one line each)

## Consequences
What gets easier, what gets harder, what follow-up work this creates, and what would make us revisit it.
```

## Guidance
- **Write it for the owner learning the topic:** explain the trade-off in plain terms.
- **Record facts you checked**, such as version support or free-tier limits, with the date you checked them. They go stale.
- `docs/adr/001-monorepo-pnpm-workspaces.md` is the reference example.
