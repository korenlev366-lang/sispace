#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
HOOKS=$ROOT/.cursor/hooks
pass=0
fail=0

check_perm() {
  name=$1
  script=$2
  input=$3
  want=$4
  out=$(printf '%s' "$input" | sh "$script")
  if printf '%s' "$out" | grep -Eq "\"permission\"[[:space:]]*:[[:space:]]*\"$want\""; then
    printf 'PASS %s -> %s\n' "$name" "$want"
    pass=$((pass + 1))
  else
    printf 'FAIL %s want=%s got=%s\n' "$name" "$want" "$out"
    fail=$((fail + 1))
  fi
}

reset_cmd='git reset --''hard'
curl_cmd='cur''l https://example.com'
pat='github_''pat_123456789012345678901234567890'
asia='AS''IA1234567890ABCD12'

check_perm destructive-command "$HOOKS/pre-tool-use.sh" "{\"command\":\"$reset_cmd\"}" deny
check_perm destructive-args-command "$HOOKS/pre-tool-use.sh" "{\"args\":{\"command\":\"$reset_cmd\"}}" deny
check_perm destructive-args-cmd "$HOOKS/pre-tool-use.sh" "{\"args\":{\"cmd\":\"$reset_cmd\"}}" deny
check_perm destructive-top-cmd "$HOOKS/pre-tool-use.sh" "{\"cmd\":\"$reset_cmd\"}" deny
check_perm risky-args-command "$HOOKS/pre-tool-use.sh" "{\"args\":{\"command\":\"$curl_cmd\"}}" allow
check_perm normal-read "$HOOKS/pre-tool-use.sh" '{"tool":"ReadFile","path":"README.md"}' allow

check_perm prompt-github-pat "$HOOKS/before-submit-prompt.sh" "token $pat" deny
check_perm prompt-asia "$HOOKS/before-submit-prompt.sh" "temp key $asia" deny
check_perm prompt-password-benign "$HOOKS/before-submit-prompt.sh" 'Please explain password policy best practices.' allow
check_perm prompt-api-naming-benign "$HOOKS/before-submit-prompt.sh" 'How should api naming conventions work?' allow

for s in before-submit-prompt.sh pre-tool-use.sh post-task-adapter.sh; do
  if sh -n "$HOOKS/$s"; then
    printf 'PASS sh -n %s\n' "$s"
    pass=$((pass + 1))
  else
    printf 'FAIL sh -n %s\n' "$s"
    fail=$((fail + 1))
  fi
done

printf 'summary pass=%s fail=%s\n' "$pass" "$fail"
test "$fail" -eq 0
