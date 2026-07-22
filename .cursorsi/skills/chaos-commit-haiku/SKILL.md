---
name: chaos-commit-haiku
description: Auto-extracted skill for turning messy diffs into one haiku commit message
source: auto-skill
---

# Chaos Commit Haiku

## When to use
After a sprawling edit session where the diff looks like a raccoon went through the repo.

## Steps
1. Run `git status` and `git diff --stat`.
2. Pick the *one* theme that actually matters (ignore drive-by renames).
3. Write a 3-line haiku commit subject/body:
   - line 1: what changed (5 syllables vibe)
   - line 2: why it mattered (7)
   - line 3: what to watch next (5)
4. Stage only files that match that theme; leave the rest unstaged.
5. Commit with that haiku; do not squash unrelated work into it.

## Anti-patterns
- Do not invent features that are not in the diff.
- Do not use "fix", "wip", or "stuff" as the whole message.
