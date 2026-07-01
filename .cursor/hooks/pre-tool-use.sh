#!/bin/sh

input=$(cat)

deny() {
  reason=$1
  printf '%s\n' "{\"permission\":\"deny\",\"user_message\":\"Harness blocked this tool call: $reason\",\"agent_message\":\"Fail-closed policy: $reason\"}"
  exit 0
}

warn() {
  reason=$1
  printf '%s\n' "{\"permission\":\"allow\",\"user_message\":\"Harness audit warning: $reason\",\"agent_message\":\"Audit mode: allowed, but proceed carefully.\"}"
  exit 0
}

extract_command() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$input" | jq -r '
      .command
      // .cmd
      // .args.command
      // .args.cmd
      // .args.shell.command
      // .tool_input.command
      // .tool_input.cmd
      // empty
    ' 2>/dev/null
    return
  fi
  printf '%s' "$input" | sed -n \
    -e 's/.*"command"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    -e 's/.*"cmd"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1
}

cmd=$(extract_command)
payload_lc=$(printf '%s' "$input" | tr '[:upper:]' '[:lower:]')
cmd_lc=$(printf '%s' "$cmd" | tr '[:upper:]' '[:lower:]')

s_env='.''env'
s_rsa='id_''rsa'
s_ed='id_''ed25519'
s_cred='credentials.''json'
s_secret='secret.''json'
s_priv='private_''key'

case "$payload_lc" in
  *"$s_env"*|*"$s_rsa"*|*"$s_ed"*|*"$s_cred"*|*"$s_secret"*|*"$s_priv"*)
    deny "secret-bearing file path detected"
    ;;
esac

t_akia='AK''IA'
t_asia='AS''IA'
t_gh='gh''p_'
t_gpat='github_''pat_'
t_xoxb='xo''xb-'
t_sk='s''k-'
t_aiza='AI''za'

if printf '%s' "$cmd" | grep -Eqi \
  "BEGIN (RSA |OPENSSH |EC |DSA )?PRIVATE KEY|${t_akia}[0-9A-Z]{16}|${t_asia}[0-9A-Z]{16}|${t_gh}[A-Za-z0-9]{20,}|${t_gpat}[A-Za-z0-9_]{20,}|${t_xoxb}[A-Za-z0-9-]{10,}|${t_sk}[A-Za-z0-9]{20,}|${t_aiza}[0-9A-Za-z_-]{35}"; then
  deny "secret-like content detected in shell command"
fi

case "$cmd_lc" in
  *"git reset --hard"*|*"git clean -fd"*|*"git clean -fx"*|*"git clean -df"*|*"git push --force"*|*"git push -f"*|*"rm -rf /"*|*"rm -fr /"*|*"rm -rf ~"*|*"rm -fr ~"*|*"chmod -r 777"*|*"chown -r"*|*"mkfs"*|*"wipefs"*|*"dd if="*|*"shred "*)
    deny "destructive shell command detected"
    ;;
esac

case "$cmd_lc" in
  *"sudo "*|*"pacman -s"*|*"yay -s"*|*"curl "*|*"wget "*|*"nc "*|*"docker run"*)
    warn "tool call matches a risky command family; audit mode allows it"
    ;;
esac

case "$input" in
  *".cursor/skills/"*"SKILL.md"*|*"Skill"*"SKILL.md"*)
    warn "in-use skill may be stale; compare it with accepted lessons, rejected lessons, and harness/memory/user-model.md before relying on it"
    ;;
esac

printf '%s\n' '{"permission":"allow"}'
exit 0
