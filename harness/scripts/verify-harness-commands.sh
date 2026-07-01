#!/bin/sh
# Verify /harness-ralph, /harness-goal, /harness-workflow integration.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
cd "$ROOT"
pass=0
fail=0
RALPH=$ROOT/harness/scripts/ralph-goal.sh
TMP=$ROOT/harness/reports/.verify-ralph-marker

ok() { printf 'PASS %s\n' "$1"; pass=$((pass + 1)); }
bad() { printf 'FAIL %s\n' "$1"; fail=$((fail + 1)); }

# POSIX syntax
for f in \
  .cursor/hooks/post-task-adapter.sh \
  .cursor/hooks/before-submit-prompt.sh \
  .cursor/hooks/pre-tool-use.sh \
  .cursor/hooks/obsidian-lesson-context.sh \
  harness/scripts/ralph-goal.sh \
  harness/scripts/retroactive-reflect.sh; do
  if sh -n "$f" 2>/dev/null; then
    ok "sh -n $f"
  else
    bad "sh -n $f"
  fi
done

# Command + skill docs exist
for f in \
  .cursor/commands/harness-ralph.md \
  .cursor/commands/harness-goal.md \
  .cursor/commands/harness-workflow.md \
  .cursor/skills/harness-workflow/SKILL.md \
  harness/memory/ralph-goal.md \
  harness/memory/goals.md; do
  if [ -f "$f" ]; then ok "exists $f"; else bad "exists $f"; fi
done

# Harness SDK subagent definitions
for f in \
  .cursor/agents/harness-reflection-agent.md \
  .cursor/agents/harness-grading-agent.md \
  .cursor/agents/harness-rollout-agent.md \
  .cursor/agents/harness-ralph-agent.md \
  .cursor/agents/harness-workflow-agent.md \
  .cursor/agents/researcher-agent.md \
  .cursor/agents/architect-agent.md \
  .cursor/agents/coder-agent.md \
  .cursor/agents/reviewer-agent.md \
  .cursor/agents/tester-agent.md \
  .cursor/agents/debugger-agent.md \
  .cursor/agents/documenter-agent.md \
  .cursor/agents/checker-researcher.md \
  .cursor/agents/checker-architect.md \
  .cursor/agents/checker-coder.md \
  .cursor/agents/checker-reviewer.md \
  .cursor/agents/checker-tester.md; do
  if [ -f "$f" ] && grep -q '^name:' "$f" && grep -q '^model:' "$f"; then
    ok "agent $f"
  else
    bad "agent $f"
  fi
done

# Layer 3 checker agents forbid spawning
for f in .cursor/agents/checker-*.md; do
  if [ -f "$f" ] && grep -qi 'Do not spawn subagents' "$f"; then
    ok "checker no-spawn $f"
  else
    bad "checker no-spawn $f"
  fi
done

# architect uses best available model
if grep -q '^model: composer-2.5' .cursor/agents/architect-agent.md; then
  ok 'architect-agent model'
else
  bad 'architect-agent model'
fi

# post-task chain uses Agent.create + subagents
if grep -q 'createHarnessOrchestrator' harness/scripts/src/post-task-chain.ts \
  && grep -q 'dispatchToSubagent' harness/scripts/src/post-task-chain.ts \
  && grep -q 'runWorkflowSubtasksParallel' harness/scripts/src/lib/workflow-sdk.ts \
  && grep -q 'runSpecialistPipeline' harness/scripts/src/lib/workflow-sdk.ts \
  && grep -q 'runSpecialistWithChecker' harness/scripts/src/lib/workflow-sdk.ts \
  && grep -q 'SPECIALIST_CHECKER_MAP' harness/scripts/src/lib/agent-definitions.ts \
  && grep -q 'loadWorkflowAgents' harness/scripts/src/lib/agent-definitions.ts; then
  ok 'SDK subagent orchestration sources'
else
  bad 'SDK subagent orchestration sources'
fi

# workflow skill task-type sequences
if grep -q 'researcher-agent' .cursor/skills/harness-workflow/SKILL.md \
  && grep -q 'debugger-agent' .cursor/skills/harness-workflow/SKILL.md \
  && grep -q 'documenter-agent' .cursor/skills/harness-workflow/SKILL.md; then
  ok 'workflow skill specialist orchestration'
else
  bad 'workflow skill specialist orchestration'
fi

# goals.md reflection hook doc
if grep -q 'goals.md' .cursor/hooks/lib/post-task-auto-chain.md \
  && grep -q 'Goal advancement' .cursor/skills/harness-reflection/reflection-template.md; then
  ok 'goal tracker wired into reflection'
else
  bad 'goal tracker wired into reflection'
fi

# workflow: no nested spawn
if grep -qE 'not.*spawn further subagents' .cursor/skills/harness-workflow/SKILL.md \
  && grep -q 'rollout-log.md' .cursor/commands/harness-workflow.md; then
  ok 'workflow skill constraints'
else
  bad 'workflow skill constraints'
fi

# panel apply-all implements via workflow agent (not readonly rollout logger)
if grep -q 'harness-workflow-agent' harness/scripts/src/panel-actions.ts \
  && grep -q 'evaluatePanelApplyGate' harness/scripts/src/panel-actions.ts \
  && grep -q 'needsPanelReapply' harness/scripts/src/lib/proposal-ledger.ts \
  && grep -q 'buildPanelApplySubagentInput' harness/scripts/src/lib/prompts.ts; then
  ok 'panel apply-all uses workflow implementation agent'
else
  bad 'panel apply-all uses workflow implementation agent'
fi

# Ralph: reject set without verify
if sh "$RALPH" set --goal 'Build the feature completely' 2>/dev/null; then
  bad 'ralph rejects set without --verify'
else
  ok 'ralph rejects set without --verify'
fi

# Ralph: reject placeholder verify
if sh "$RALPH" set --goal 'Ensure all tests pass for module X' --verify 'true' 2>/dev/null; then
  bad 'ralph rejects placeholder verify'
else
  ok 'ralph rejects placeholder verify'
fi

# Ralph: reject unbalanced quotes in verify
if sh "$RALPH" set --goal 'Ensure verify quoting is validated' --verify "grep -v '^0" 2>/dev/null; then
  bad 'ralph rejects unbalanced verify quotes'
else
  ok 'ralph rejects unbalanced verify quotes'
fi

# Ralph: reject complex inline verify (prefer script path)
inline_verify="cd /tmp && jar tf foo.jar | grep -E 'PacketEvent|LagrangeModule' | wc -l | grep -v '^0$'"
if sh "$RALPH" set --goal 'Ensure complex inline verify is rejected' --verify "$inline_verify" 2>/dev/null; then
  bad 'ralph rejects complex inline verify'
else
  ok 'ralph rejects complex inline verify'
fi

# Ralph: accept harness verify script path
if sh "$RALPH" cancel >/dev/null 2>&1; then :; fi
if sh "$RALPH" set --goal 'Ensure verify script path is accepted' --verify "test -f $TMP" --max 1 2>/dev/null; then
  ok 'ralph accepts verify script path'
  sh "$RALPH" cancel >/dev/null 2>&1 || true
else
  bad 'ralph accepts verify script path'
fi

# Ralph: reject max > 25
sh "$RALPH" cancel >/dev/null 2>&1 || true
if sh "$RALPH" set --goal 'Ensure marker file exists for Ralph' --verify "test -f $TMP" --max 30 2>/dev/null; then
  bad 'ralph rejects max > 25'
else
  ok 'ralph rejects max > 25'
fi

# Ralph: active loop + post-task failure re-injects
rm -f "$TMP"
sh "$RALPH" cancel >/dev/null 2>&1 || true
sh "$RALPH" set --goal 'Create Ralph verify marker file' --verify "test -f $TMP" --max 3 >/dev/null
msg=$(HARNESS_PROJECT_ROOT=$ROOT sh "$RALPH" post-task 2>/dev/null || true)
if printf '%s' "$msg" | grep -q 'HARNESS_RALPH_CONTINUE'; then
  ok 'ralph post-task re-injects on verify failure'
else
  bad 'ralph post-task re-injects on verify failure'
fi
it=$(awk '/^current_iteration:/ { sub(/^[^:]+:[[:space:]]*/, ""); print; exit }' harness/memory/ralph-goal.md)
if [ "$it" = "1" ]; then
  ok 'ralph increments iteration on failure'
else
  bad "ralph increments iteration on failure (got $it)"
fi

# Ralph: success completes
touch "$TMP"
msg2=$(HARNESS_PROJECT_ROOT=$ROOT sh "$RALPH" post-task 2>/dev/null || true)
if printf '%s' "$msg2" | grep -q 'HARNESS_RALPH_COMPLETE'; then
  ok 'ralph exits cleanly on verify success'
else
  bad 'ralph exits cleanly on verify success'
fi
st=$(awk '/^status:/ { sub(/^[^:]+:[[:space:]]*/, ""); print; exit }' harness/memory/ralph-goal.md)
if [ "$st" = "complete" ]; then
  ok 'ralph status complete after success'
else
  bad "ralph status after success (got $st)"
fi
if grep -q 'ACCEPTED-RALPH-' harness/memory/accepted-lessons.md; then
  ok 'ralph writes accepted-lessons entry'
else
  bad 'ralph writes accepted-lessons entry'
fi

# Ralph: max iterations -> failed
sh "$RALPH" cancel >/dev/null 2>&1 || true
rm -f "$TMP"
sh "$RALPH" set --goal 'Never succeed Ralph max test' --verify "test -f $TMP" --max 2 >/dev/null
HARNESS_PROJECT_ROOT=$ROOT sh "$RALPH" post-task >/dev/null 2>&1 || true
HARNESS_PROJECT_ROOT=$ROOT sh "$RALPH" post-task >/dev/null 2>&1 || true
st2=$(awk '/^status:/ { sub(/^[^:]+:[[:space:]]*/, ""); print; exit }' harness/memory/ralph-goal.md)
if [ "$st2" = "failed" ]; then
  ok 'ralph respects max iterations'
else
  bad "ralph respects max iterations (got $st2)"
fi

# post-task-adapter JSON valid with long session tokens
out=$(printf '%s' '{"session_id":"cmd-verify","output_tokens":1500}' | sh .cursor/hooks/post-task-adapter.sh)
if printf '%s' "$out" | grep -q 'HARNESS_POSTTASK_AUTO_CHAIN'; then
  bad 'post-task-adapter must not inject auto-chain'
else
  ok 'post-task-adapter SDK chain (no injection)'
fi
if printf '%s' "$out" | python3 -c 'import json,sys; json.load(sys.stdin)' 2>/dev/null; then
  ok 'post-task-adapter JSON parseable'
else
  bad 'post-task-adapter JSON parseable'
fi

# RETRO-DONE-GUARD: session-scoped completion in retroactive-reflect.sh
if HARNESS_RETRO_SELFTEST=1 sh "$ROOT/harness/scripts/retroactive-reflect.sh" >/dev/null 2>&1; then
  ok 'retroactive-reflect session-scoped done guard'
else
  bad 'retroactive-reflect session-scoped done guard'
fi

# Token optimizer (Ghost Token Hunter + Headroom bridge)
if [ -f harness/config/token-optimizer.yaml ]; then
  ok 'token-optimizer config'
else
  bad 'token-optimizer config'
fi
for f in \
  harness/scripts/dist/lib/ghost-token-hunter.js \
  harness/scripts/dist/lib/headroom-bridge.js \
  harness/scripts/dist/lib/context-optimizer.js; do
  if [ -f "$f" ]; then ok "token-opt dist $f"; else bad "token-opt dist $f"; fi
done
if (cd harness/scripts && node --test dist/lib/context-optimizer.test.js >/dev/null 2>&1); then
  ok 'token optimizer unit tests'
else
  bad 'token optimizer unit tests'
fi

sh "$RALPH" cancel >/dev/null 2>&1 || true
rm -f "$TMP"
# Remove test ACCEPTED-RALPH entries appended during verify
if [ -f "$ROOT/harness/memory/accepted-lessons.md" ]; then
  awk '/^### ACCEPTED-RALPH-/{exit} {print}' "$ROOT/harness/memory/accepted-lessons.md" > "$ROOT/harness/memory/accepted-lessons.md.tmp" \
    && mv "$ROOT/harness/memory/accepted-lessons.md.tmp" "$ROOT/harness/memory/accepted-lessons.md"
fi

printf 'summary pass=%s fail=%s\n' "$pass" "$fail"
test "$fail" -eq 0
