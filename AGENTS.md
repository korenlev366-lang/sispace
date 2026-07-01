# Agent Instructions
## Memory
Before starting any task, ALWAYS call obsidian_search with keywords from the user's message. 
The Obsidian vault contains accepted lessons and patterns from past sessions that are 
critical context. You MUST search it before responding to any technical question.

## Identity

You are a coding agent working in Lev's monorepo on Arch Linux (CachyOS, Hyprland, Fish shell). Primary projects: GNUClient (Minecraft 1.8.9 Forge ghost client, JVMTI/JNI), SISpace (GTK4+Rust coding workspace), cursorsi CLI (Node.js/Ink TUI agent harness).

## Harness Integration (most important)

This repo uses a self-learning harness. Before starting any non-trivial task:

1. Search Obsidian vault for relevant accepted lessons (use MCP if available, or read `harness/memory/accepted-lessons/` directly)
2. Check `harness/memory/user-model.md` for preferences and known patterns
3. Check `harness/memory/reasoning-patterns.md` for past architectural decisions

After completing a task, write a brief Obsidian note (`SISpace/tasks/` or `GNUClient/tasks/`) covering: what changed, why, and any decisions made. This feeds the reflection chain.

## Code Discipline

- Read before edit — always read the file before modifying it
- Surgical changes only — touch only what the task requires, nothing else
- No speculative abstractions — solve what is asked, not hypothetical future needs
- Verify before claiming complete — run the test, build the project, check the output
- If an approach fails, diagnose root cause before retrying
- Match existing conventions — style, naming, error handling patterns in the file

## Project Conventions

### GNUClient (Minecraft 1.8.9 Forge)

- JVMTI/JNI native agent (.so), hooks glXSwapBuffers for ImGui rendering
- SRG obfuscated field names — look up at https://mcp.thiakil.com/#/search (always select 1.8.9)
- No magic numbers for hitboxes — use named constants
- Null-check all entity/world references before use
- Always write an Obsidian note for any module change (vault: `/home/lev/linux minecraft thing/gnu client`)

### SISpace (GTK4 + Rust)

- Pure Rust GTK4 binary (`sispace-gtk`), shared library (`sispace-core`)
- VTE terminals for embedded cursorsi panes — no xterm.js, no WebKit
- GLib main loop for all UI mutations from background threads (`glib::MainContext::invoke`)
- Follow `SISPACE_GTK4_PLAN.md` phase structure

### cursorsi CLI (Node.js/TypeScript/Ink)

- Cold start target <300ms — no eager imports at top level
- Pi-style context compaction — auto-trigger at threshold
- Harness auto-reflection on every session end — no manual trigger needed
- Follow `CURSORSI_CLI_PLAN.md`

## Tech Stack

- Arch Linux, Fish shell (no bash-isms, no `&&`, use `set` not `export`)
- Rust (`cargo`), TypeScript (Node.js), Java (Forge 1.8.9 + JVMTI)
- vim over nano always
- pacman/yay only — no apt, brew, etc.

## Communication

- Concise and direct — lead with the answer, not the reasoning
- No emojis
- When referencing code, include `file:line_number`
- State assumptions explicitly before acting on them
- If genuinely stuck after 3 attempts, say so explicitly rather than spinning
