#!/bin/sh
# Report progress against meta-harness readiness milestones.
# Usage: sh harness/scripts/doctor-meta-readiness.sh [PROJECT_ROOT]
# See docs/meta-harness-readiness.md

set -eu

ROOT=${1:-$(pwd)}
ROLLOUT=$ROOT/harness/reports/rollout-log.md
REJECTED=$ROOT/harness/memory/rejected-lessons.md
USERMODEL=$ROOT/harness/memory/user-model.md
OVERRIDE=$ROOT/harness/memory/tool-override-log.md

TARGET_SESSIONS=40
TARGET_REJECTED=15
TARGET_USER_PREFS=3
ROLLING_DAYS=14
MAX_OVERRIDES=0

count_entries() {
  file=$1
  kind=$2
  if [ ! -f "$file" ]; then
    printf '0'
    return
  fi
  n=$(grep -E "^### ${kind}-[0-9]{8}" "$file" 2>/dev/null | wc -l | tr -d ' ')
  printf '%s' "${n:-0}"
}

count_qualified_prefs() {
  if [ ! -f "$USERMODEL" ]; then
    printf '0'
    return
  fi
  awk '
    BEGIN { c=0; ok=0; in_cur=0 }
    /^## Current Preferences$/ { in_cur=1; next }
    !in_cur { next }
    /^### USER-PREF-[0-9]{8}/ {
      if (ok) c++
      ok=0
      next
    }
    /^- Confidence:/ && /medium|high/ && $0 !~ /\|/ { ok=1 }
    END { if (ok) c++; print c+0 }
  ' "$USERMODEL"
}

count_overrides_recent() {
  if [ ! -f "$OVERRIDE" ]; then
    printf '0'
    return
  fi
  today=$(date +%Y%m%d)
  cutoff=$(date -d "$ROLLING_DAYS days ago" +%Y%m%d 2>/dev/null) || cutoff=$(date -v-"${ROLLING_DAYS}"d +%Y%m%d 2>/dev/null) || cutoff=0
  awk -v cutoff="$cutoff" '
    BEGIN { c=0 }
    /^- Date:/ {
      gsub(/[^0-9]/, "", $0)
      d=$0
      if (length(d) >= 8) {
        sub(/.*([0-9]{8}).*/, "\\1", d)
        if (d+0 >= cutoff+0) c++
      }
    }
    END { print c+0 }
  ' "$OVERRIDE"
}

sessions=$(count_entries "$ROLLOUT" "ROLLOUT")
rejected=$(count_entries "$REJECTED" "REJECTED")
prefs=$(count_qualified_prefs)
overrides=$(count_overrides_recent)

pass_all=true

printf 'Meta-harness readiness\n'
printf '  project: %s\n' "$ROOT"
printf '  doc:     docs/meta-harness-readiness.md\n'
printf '\n'

# Milestone 1
if [ "$sessions" -ge "$TARGET_SESSIONS" ]; then
  m1=PASS
else
  m1=FAIL
  pass_all=false
fi
printf '1. Full post-task sessions (1000+ output tokens)\n'
printf '   current: %s / %s  [%s]\n' "$sessions" "$TARGET_SESSIONS" "$m1"
printf '   signal:  %s\n' "$ROLLOUT"
printf '\n'

# Milestone 2
if [ "$rejected" -ge "$TARGET_REJECTED" ]; then
  m2=PASS
else
  m2=FAIL
  pass_all=false
fi
printf '2. Rejected lessons with rubric reasons\n'
printf '   current: %s / %s  [%s]\n' "$rejected" "$TARGET_REJECTED" "$m2"
printf '   signal:  %s\n' "$REJECTED"
printf '\n'

# Milestone 3
if [ "$prefs" -ge "$TARGET_USER_PREFS" ]; then
  m3=PASS
else
  m3=FAIL
  pass_all=false
fi
printf '3. User model idioms (medium/high confidence)\n'
printf '   current: %s / %s  [%s]\n' "$prefs" "$TARGET_USER_PREFS" "$m3"
printf '   signal:  %s\n' "$USERMODEL"
printf '   note:    subjective — confirm preferences appear before repeat corrections\n'
printf '\n'

# Milestone 4
if [ "$overrides" -le "$MAX_OVERRIDES" ]; then
  m4=PASS
else
  m4=FAIL
  pass_all=false
fi
printf '4. Pre-tool-use manual overrides (rolling %s days)\n' "$ROLLING_DAYS"
printf '   current: %s (max %s)  [%s]\n' "$overrides" "$MAX_OVERRIDES" "$m4"
printf '   signal:  %s\n' "$OVERRIDE"
printf '\n'

printf 'Overall: '
if [ "$pass_all" = true ]; then
  printf 'READY for meta-optimization loop\n'
else
  printf 'NOT READY for meta-optimization loop\n'
  printf 'Gaps:\n'
  [ "$sessions" -lt "$TARGET_SESSIONS" ] && printf '  - need %s more rollout-log sessions\n' $((TARGET_SESSIONS - sessions))
  [ "$rejected" -lt "$TARGET_REJECTED" ] && printf '  - need %s more rejected-lesson entries\n' $((TARGET_REJECTED - rejected))
  [ "$prefs" -lt "$TARGET_USER_PREFS" ] && printf '  - need %s more qualified user-model entries\n' $((TARGET_USER_PREFS - prefs))
  [ "$overrides" -gt "$MAX_OVERRIDES" ] && printf '  - reduce pre-tool-use overrides in last %s days\n' "$ROLLING_DAYS"
fi

exit 0
