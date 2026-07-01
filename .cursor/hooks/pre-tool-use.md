# preToolUse Contract

Script: `.cursor/hooks/pre-tool-use.sh`

Mode: Phase 9 controlled enforcement — fail-closed for destructive commands, secret-bearing paths, and secret-like content embedded in shell commands; audit warnings for everything else listed below.

Fail-open warnings:
- Package installation commands such as `pacman -S` or `yay -S`.
- Network command families such as `curl`, `wget`, or `nc`.
- Container launch commands such as `docker run`.
- Privileged commands containing `sudo`.
- In-use skill files such as `.cursor/skills/*/SKILL.md`, which may be stale relative to accepted lessons, rejected lessons, and `harness/memory/user-model.md`.

Fail-closed denials:
- Destructive shell commands such as `git reset --hard`, `git clean -fd`, forced push, recursive root/home deletion, broad ownership or permission changes, disk formatting, wiping, raw disk writes, or shredding.
- Secret-bearing file paths such as `.env`, private SSH keys, credential files, secret JSON files, private key names, `.pem`, and `.key` files.
- Secret-like content inside a shell `command` field (PEM blocks, `AKIA`, `ghp_`, `xoxb-` prefixes). Backtests reject weakening `.env` reads (`TOOL-REJECT-001`) and reject blocking all package installs (`TOOL-REVISE-001`).

Does not enforce:
- It does not grade proposals.
- It does not modify tool input.
- It does not block ordinary reads, edits, or verification commands.
- It does not decide that a skill is stale; it only flags the need to check.

Reason for hook:
- Tool calls are structured risk boundaries. A rule can advise caution, but this hook can stop high-confidence dangerous calls before execution.
