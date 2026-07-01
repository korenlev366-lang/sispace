---
source: "cursor-harness"
tags: "harness"
proposal_id: "t_bb735bec"
date: "2026-06-03"
---

Researcher confirmed Obsidian Local REST healthy (127.0.0.1:27123, HTTP 200) and global ~/.cursor/mcp.json had a working obsidian entry, yet mcp_get_tools returned zero servers. Root cause: harness-install seeds an empty project `.cursor/mcp.json` (`mcpServers: {}`) that overrides global MCP in this workspace. harness-doctor reported HEALTHY because it only greps config files—it did not detect runtime MCP absence. Architect chose surgical populate-with-env-ref over delete-project-file; coder replaced empty mcpServers with obsidian HTTP server using ${env:OBSIDIAN_API_KEY} (already in ~/.config/environment.d/cursor.conf). Static backend and config checks pass; runtime MCP cannot activate until Cursor reload—expected for config-only MCP changes. Remaining uncertainty: subagent MCP parity after reload, global literal-bearer vs project env-ref drift, sidecar Agent.create still lacks inline Obsidian MCP (SISPACE_PLAN #6), and harness-doctor.md text claiming empty project mcp is normal when global has Obsidian contradicts observed behavior.