### ACCEPTED-CURATE-SUPERPOWERS-TRIM:: Git-only superpowers archived

- Source task: /harness-apply PENDING-CURATE-SUPERPOWERS-TRIM (harness-curate re-grade 2026-06-03)
- Reason: Non-git workspace; git worktree skills mislead agents; narrow apply per grade 83
- Target layer: skills
- Date: 2026-06-03
- Rollback note: `mv archive/skills/superpowers-git/* .agents/skills/`; remove `.agents/skills/superpowers-scope.md`
- Applied change: Moved `using-git-worktrees` and `finishing-a-development-branch` to `archive/skills/superpowers-git/`; added `superpowers-scope.md` keep list
- Verification evidence: `test ! -d .agents/skills/using-git-worktrees`; `test -f .agents/skills/superpowers-scope.md`
