#!/usr/bin/env python3
"""Obsidian lesson context for beforeSubmitPrompt. Uses env-only credentials."""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

_PREFIX = "OBSIDIAN_"
_KEY_SUFFIX = "API_KEY"
_ENV_KEY = _PREFIX + _KEY_SUFFIX

def _load_obsidian_config(root: Path) -> tuple[str, str]:
    """Return (vault_root, vault_prefix) from harness/config/obsidian.yaml."""
    cfg = root / "harness/config/obsidian.yaml"
    vault_root = ""
    vault_prefix = "Harness"
    if not cfg.is_file():
        return vault_root, vault_prefix
    for line in cfg.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped.startswith("vault_root:"):
            vault_root = stripped.split(":", 1)[1].strip().strip('"').strip("'")
        elif stripped.startswith("vault_prefix:"):
            vault_prefix = stripped.split(":", 1)[1].strip().strip('"').strip("'")
    return vault_root, vault_prefix


def _lesson_prefixes(vault_prefix: str) -> tuple[str, ...]:
    base = vault_prefix.rstrip("/")
    return (
        f"{base}/accepted-lessons/",
        f"{base}/rejected-lessons/",
        f"{base}/user-model/",
        f"{base}/reasoning-patterns/",
        "SISpace/tasks/",
    )


def agents_context_block() -> str:
    content = os.environ.get("HARNESS_AGENTS_MD", "").strip()
    if not content:
        return ""
    return f"<system-context>\n{content}\n</system-context>"


def merge_additional_context(*parts: str) -> str | None:
    merged = "\n\n".join(p.strip() for p in parts if p and p.strip())
    return merged or None


def with_agents_context(obj: dict, *extra_parts: str) -> dict:
    agents = agents_context_block()
    existing = obj.get("additional_context")
    if isinstance(existing, str):
        extra_parts = (existing, *extra_parts)
    ctx = merge_additional_context(agents, *extra_parts)
    if ctx:
        obj = {**obj, "additional_context": ctx}
    return obj


def emit(obj: dict) -> None:
    print(json.dumps(with_agents_context(obj), ensure_ascii=False))
    sys.exit(0)


def topic_from_input(raw: str) -> str:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        data = {}
    text = (
        data.get("prompt")
        or data.get("user_message")
        or data.get("userMessage")
        or ""
    )
    if not isinstance(text, str):
        text = str(text)
    words = re.findall(r"[A-Za-z0-9][A-Za-z0-9._-]{2,}", text)
    if not words:
        return "harness"
    return " ".join(words[:12])


def conversation_id(raw: str) -> str:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return ""
    return str(data.get("conversation_id") or data.get("conversationId") or "")


def already_injected(root: Path, conv: str) -> bool:
    if not conv:
        return False
    stamp = root / ".cursor/hooks/state" / f"obsidian-injected-{conv}"
    return stamp.is_file()


def mark_injected(root: Path, conv: str) -> None:
    if not conv:
        return
    state = root / ".cursor/hooks/state"
    state.mkdir(parents=True, exist_ok=True)
    (state / f"obsidian-injected-{conv}").touch()


def search(api_url: str, token: str, query: str) -> list:
    q = urllib.parse.urlencode({"query": query, "contextLength": "120"})
    url = f"{api_url.rstrip('/')}/search/simple/?{q}"
    token = (token or "").strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {token}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read().decode("utf-8"))


def format_context(hits: list, prefixes: tuple[str, ...]) -> str:
    lines = ["## Relevant harness lessons (Obsidian, top 3)", ""]
    count = 0
    for item in hits:
        if not isinstance(item, dict):
            continue
        path = item.get("filename") or ""
        if not any(path.startswith(p) for p in prefixes):
            continue
        if path.endswith("README.md"):
            continue
        count += 1
        if count > 3:
            break
        lines.append(f"{count}. **{path}**")
        matches = item.get("matches") or []
        if matches and isinstance(matches[0], dict):
            ctx = matches[0].get("context") or ""
            ctx = re.sub(r"\s+", " ", ctx).strip()
            if ctx:
                lines.append(f"   {ctx[:240]}")
        lines.append("")
    if count == 0:
        lines.append("(no Harness lesson notes matched yet)")
    return "\n".join(lines)


def main() -> None:
    raw = os.environ.get("HARNESS_HOOK_INPUT", "")
    root = Path(os.environ.get("HARNESS_ROOT", "."))
    vault_root, vault_prefix = _load_obsidian_config(root)
    prefixes = _lesson_prefixes(vault_prefix)
    token = os.environ.get(_ENV_KEY, "").strip()
    api_url = os.environ.get("OBSIDIAN_API_URL", "http://127.0.0.1:27123").strip()

    if vault_root:
        harness_dir = Path(vault_root) / vault_prefix
        if not harness_dir.is_dir():
            emit(
                {
                    "permission": "allow",
                    "agent_message": (
                        "Harness: Obsidian vault Harness folder not found on disk at "
                        f"{harness_dir}; open the harness vault in Obsidian."
                    ),
                }
            )

    if not token:
        emit(
            {
                "permission": "allow",
                "agent_message": "Harness: Obsidian lesson context skipped (OBSIDIAN credential env not set).",
            }
        )

    conv = conversation_id(raw)
    if already_injected(root, conv):
        emit({"permission": "allow"})

    mark_injected(root, conv)
    topic = topic_from_input(raw)

    try:
        hits = search(api_url, token, topic)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        emit(
            {
                "permission": "allow",
                "agent_message": "Harness: Obsidian lesson search unavailable; continue without injected context.",
            }
        )

    ctx = format_context(hits if isinstance(hits, list) else [], prefixes)
    emit(
        {
            "permission": "allow",
            "additional_context": ctx,
            "agent_message": f"Harness: injected Obsidian lesson context for topic: {topic}",
        }
    )


if __name__ == "__main__":
    main()
