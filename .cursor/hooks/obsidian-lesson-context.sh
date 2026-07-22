#!/bin/sh
# Query Obsidian for relevant harness lessons; emit beforeSubmitPrompt JSON.
# Auth via OBSIDIAN_API_KEY only — never commit tokens in this repo.

set -eu

input=$(cat)
ROOT=$(HOOK_INPUT="$input" sh "$(dirname "$0")/lib/workspace-root.sh")
export HARNESS_HOOK_INPUT=$input
export HARNESS_ROOT=$ROOT

exec python3 "$(dirname "$0")/obsidian-lesson-context.py"
