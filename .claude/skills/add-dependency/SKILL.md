---
name: add-dependency
description: Add or upgrade an npm dependency following repo policy (exact pins, releases at least 14 days old, peer-range checks, Node-matched types). Use before any pnpm add, version bump, or when reviewing a Dependabot PR.
---

# Adding or upgrading a dependency

## Policy
- **Exact versions only.** No `^` or `~`. The lockfile and `package.json` must agree.
- **Releases at least 14 days old.** This gives time for bad or compromised releases to be noticed. Dependabot uses the same 14-day cooldown.
- **Peer ranges must be satisfied.** For example, TypeScript is held at 6.0.x because typescript-eslint requires `typescript <6.1`.
- **`@types/node` matches the Node runtime's major version** (`.nvmrc`).
- Prefer well-maintained, widely used packages. Don't add a dependency for something a few lines of code can do.

## Steps
1. **Check the package is needed.** Is there already something in the repo, or in Node's standard library, that does this?
2. **Find the newest release that's at least 14 days old:**
   ```bash
   npm view <pkg> time --json | node -e '
     let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
       const t=JSON.parse(s),cut=Date.now()-14*864e5;
       const v=Object.keys(t).filter(k=>!["created","modified"].includes(k)&&!k.includes("-")&&new Date(t[k])<cut);
       console.log(v.sort((a,b)=>new Date(t[a])-new Date(t[b])).pop())})'
   ```
3. **Check peer dependencies**, both its own and other packages' ranges that include it:
   ```bash
   npm view <pkg>@<version> peerDependencies
   ```
4. **Add it to the right workspace with an exact pin:**
   ```bash
   pnpm --filter @stock-tracker/<pkg> add -E <name>@<version>      # runtime dep
   pnpm --filter @stock-tracker/<pkg> add -DE <name>@<version>     # dev dep
   pnpm add -wDE <name>@<version>                                  # root tooling
   ```
5. **Verify:** run `pnpm check`. For a major upgrade, read the changelog for breaking changes and mention them in the PR.
6. **Record it.** If the choice is non-trivial (a framework, an ORM, an auth library), write an ADR.

## Reviewing a Dependabot PR
- **Check it against the policy above.** Close PRs that break it, with a comment, and add an `ignore` rule to `.github/dependabot.yml` if it will keep happening.
- **Major bumps:** skim the release notes before merging, even when CI is green.
