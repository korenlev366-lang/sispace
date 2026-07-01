#!/bin/sh
# Verify harness-install.sh in a temporary directory.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
INSTALL=$ROOT/harness/scripts/harness-install.sh
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT INT TERM

pass=0
fail=0
ok() { printf 'PASS %s\n' "$1"; pass=$((pass + 1)); }
bad() { printf 'FAIL %s\n' "$1"; fail=$((fail + 1)); }

mkdir -p "$TMP/project"
# Isolate memory scaffold in the temp project (avoid writing to live ~/sispace).
(cd "$TMP/project" && sh "$INSTALL" --sispace-home "$TMP/project") >/tmp/harness-install-out.txt 2>&1 || true

check_file() {
  label=$1
  path=$2
  if [ -f "$path" ]; then ok "$label"; else bad "$label"; fi
}

check_exec() {
  label=$1
  path=$2
  if [ -x "$path" ]; then ok "$label"; else bad "$label"; fi
}

check_file 'hooks.json copied' "$TMP/project/.cursor/hooks.json"
check_file 'before-submit hook copied' "$TMP/project/.cursor/hooks/before-submit-prompt.sh"
check_file 'pre-tool hook copied' "$TMP/project/.cursor/hooks/pre-tool-use.sh"
check_file 'post-task hook copied' "$TMP/project/.cursor/hooks/post-task-adapter.sh"
check_file 'obsidian lesson python copied' "$TMP/project/.cursor/hooks/obsidian-lesson-context.py"
check_file 'post-task chain doc copied' "$TMP/project/.cursor/hooks/lib/post-task-auto-chain.md"
check_file 'obsidian sync doc copied' "$TMP/project/.cursor/hooks/lib/obsidian-sync.md"
check_file 'tool fixtures copied' "$TMP/project/.cursor/hooks/fixtures/tool-events.md"
check_file 'prompt fixtures copied' "$TMP/project/.cursor/hooks/fixtures/prompt-events.md"

check_exec 'before-submit hook executable' "$TMP/project/.cursor/hooks/before-submit-prompt.sh"
check_exec 'pre-tool hook executable' "$TMP/project/.cursor/hooks/pre-tool-use.sh"
check_exec 'post-task hook executable' "$TMP/project/.cursor/hooks/post-task-adapter.sh"

check_file 'harness-apply command copied' "$TMP/project/.cursor/commands/harness-apply.md"
check_file 'harness-grade command copied' "$TMP/project/.cursor/commands/harness-grade.md"
check_file 'grading agent copied' "$TMP/project/.cursor/agents/harness-grading-agent.md"
check_file 'rollout agent copied' "$TMP/project/.cursor/agents/harness-rollout-agent.md"
check_file 'harness-workflow skill copied' "$TMP/project/.cursor/skills/harness-workflow/SKILL.md"
check_file 'harness-reflection skill copied' "$TMP/project/.cursor/skills/harness-reflection/SKILL.md"

check_file 'harness/config/harness.yaml scaffolded' "$TMP/project/harness/config/harness.yaml"
check_file 'harness/config/obsidian.yaml scaffolded' "$TMP/project/harness/config/obsidian.yaml"
check_file 'project-index created' "$TMP/project/harness/memory/project-index.md"
check_file 'accepted-lessons scaffolded' "$TMP/project/harness/memory/accepted-lessons.md"
check_file 'rejected-lessons scaffolded' "$TMP/project/harness/memory/rejected-lessons.md"
check_file 'user-model scaffolded' "$TMP/project/harness/memory/user-model.md"
check_file 'rollout-log scaffolded' "$TMP/project/harness/reports/rollout-log.md"
check_file 'latest-reflection scaffolded' "$TMP/project/harness/reports/latest-reflection.md"
check_file 'latest-grade scaffolded' "$TMP/project/harness/reports/latest-grade.md"
check_file 'doctor script copied' "$TMP/project/harness/scripts/harness-doctor.sh"
check_file 'meta doctor script copied' "$TMP/project/harness/scripts/doctor-meta-readiness.sh"
check_file 'retroactive-reflect script copied' "$TMP/project/harness/scripts/retroactive-reflect.sh"
check_file 'ralph-goal script copied' "$TMP/project/harness/scripts/ralph-goal.sh"
check_exec 'ralph-goal script executable' "$TMP/project/harness/scripts/ralph-goal.sh"

check_file 'post-task-chain compiled copied' "$TMP/project/harness/scripts/dist/post-task-chain.js"
check_file 'panel-actions compiled copied' "$TMP/project/harness/scripts/dist/panel-actions.js"
check_file 'proposal-ledger compiled copied' "$TMP/project/harness/scripts/dist/lib/proposal-ledger.js"
check_file 'ralph-agent-loop compiled copied' "$TMP/project/harness/scripts/dist/lib/ralph-agent-loop.js"

if grep -q 'post-task-chain.js' "$TMP/project/.cursor/hooks/post-task-adapter.sh"; then
  ok 'post-task invokes SDK chain script'
else
  bad 'post-task invokes SDK chain script'
fi

if grep -q 'SISPACE_HOME' "$TMP/project/.cursor/hooks/post-task-adapter.sh"; then
  ok 'post-task adapter references SISPACE_HOME'
else
  bad 'post-task adapter references SISPACE_HOME'
fi

if grep -q 'HARNESS_POSTTASK_AUTO_CHAIN' "$TMP/project/.cursor/hooks/post-task-adapter.sh"; then
  bad 'post-task must not inject AUTO_CHAIN'
else
  ok 'post-task no AUTO_CHAIN injection'
fi

if ! [ -f "$TMP/project/.cursor/commands/harness-sync.md" ]; then
  ok 'harness-sync command removed'
else
  bad 'harness-sync command removed'
fi

if grep -q 'Accept' "$TMP/project/.cursor/commands/harness-apply.md" && grep -q 'Apply all' "$TMP/project/.cursor/commands/harness-apply.md"; then
  ok 'harness-apply documents accept/reject/apply-all'
else
  bad 'harness-apply documents accept/reject/apply-all'
fi

if grep -q 'args.command' "$TMP/project/.cursor/hooks/fixtures/tool-events.md"; then
  ok 'tool fixture covers args.command variant'
else
  bad 'tool fixture covers args.command variant'
fi

if grep -q 'github_pat_' "$TMP/project/.cursor/hooks/fixtures/prompt-events.md"; then
  ok 'prompt fixture covers github_pat pattern'
else
  bad 'prompt fixture covers github_pat pattern'
fi

if grep -q 'Summary' /tmp/harness-install-out.txt && grep -q 'Restart Cursor' /tmp/harness-install-out.txt; then
  ok 'install prints summary and restart reminder'
else
  bad 'install prints summary and restart reminder'
fi

(cd "$TMP/project" && sh "$INSTALL" --sispace-home "$TMP/project") >/tmp/harness-install-out2.txt 2>&1
if [ "$(grep -c '^SKIP' /tmp/harness-install-out2.txt || true)" -gt 0 ]; then
  ok 'second run skips existing files'
else
  bad 'second run skips existing files'
fi

if sh -n "$INSTALL"; then ok 'sh -n harness-install.sh'; else bad 'sh -n harness-install.sh'; fi

printf 'summary pass=%s fail=%s\n' "$pass" "$fail"
test "$fail" -eq 0
