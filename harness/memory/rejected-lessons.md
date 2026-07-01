# Rejected Lessons

Rejected lessons prevent the harness from rediscovering unsafe, contradicted, or low-value changes.

## Required Fields

Each rejected entry must include:
- Source task:
- Reason:
- Target layer:
- Date:
- Rollback note:

## Template

```markdown
### REJECTED-YYYYMMDD-001: [Short Title]

- Source task:
- Reason:
- Target layer:
- Date:
- Rollback note:
- Rejected proposal:
- Reconsider only if:
```

## Entries

### REJECTED-20260603-001: Bulk distill PATTERN-20260602-230 retro burst

- Source task: PENDING-CURATE-MEMORY-DISTILL (original bundled scope); harness-curate session 6637b8ce-82dd-4757-8bef-cb328c31b855; re-grade split 2026-06-03
- Reason: Rubric 58/100 — Evidence 14/20 (grep count only, no proof distillation preserves recall). Safety 12/15 (deleting or merging 35 session-specific patterns loses per-session globs used by retroactive-reflect). Reversibility 2/5 (mass deletion hard to undo). Backtest 4/15 (no verify script; doctor does not measure pattern recall). Layer fit 8/10. Narrow revision (template-only) supersedes this scope.
- Target layer: memory
- Date: 2026-06-03
- Rollback note: n/a — never applied
- Rejected proposal: Merge 35 `PATTERN-20260602-230*` entries in `reasoning-patterns.md` into a single appendix table and remove line-level duplicates to reduce token load on reflection intake.
- Reconsider only if: A verified index-only approach is proposed (links to existing headings, zero deletions) with `verify-harness-commands.sh` or doctor check proving pattern count unchanged.

### REJECTED-20260603-002: Superpowers TDD vs useful-tests stance merge

- Source task: PENDING-CURATE-SUPERPOWERS-TRIM (original bundled scope); harness-curate session 6637b8ce; re-grade split 2026-06-03
- Reason: Hard gate — contradicts explicit user rule ("Useful tests only — Only add tests if requested") and project constraint-based coding (no trivial tests). Rubric would be reject regardless; score 42/100 if scored: Evidence 10/20 (no user correction asked for TDD). Contradiction 0/10.
- Target layer: skills
- Date: 2026-06-03
- Rollback note: n/a — never applied
- Rejected proposal: Resolve `test-driven-development` skill against user useful-tests-only by editing TDD skill frontmatter or archiving TDD in favor of a single stance document under superpowers.
- Reconsider only if: User explicitly requests TDD skill changes for this repo and updates user rules accordingly.

### REJECTED-20260603-003: Archive all non-core superpowers skills

- Source task: PENDING-CURATE-SUPERPOWERS-TRIM (original bundled scope); harness-curate session 6637b8ce; re-grade split 2026-06-03
- Reason: Rubric 61/100 — Generality 8/15 (blended keep/archive without measured overlap per skill). Backtest 5/15 (no agent smoke that archived paths are not still discovered via plugin cache). Cost control 6/10 (broad archive may break sessions that legitimately use subagent-driven-development paths). Revised proposal archives only two git-specific skills with explicit keep list (83/100, pending apply).
- Target layer: skills
- Date: 2026-06-03
- Rollback note: n/a — never applied
- Rejected proposal: Archive most `.agents/skills/` superpowers bundle except systematic-debugging, verification-before-completion, brainstorming; add orchestration README overlapping harness-workflow.
- Reconsider only if: Per-skill `du -sh` and discovery-path audit shows zero references from project rules and a table maps each archived skill to a replacement.
