# Accepted Lessons

Accepted lessons are durable harness guidance. Add an entry only after a proposal is graded and accepted.

## Required Fields

Each **ACCEPTED-*** entry must include:
- Source task:
- Reason:
- Target layer:
- Date:
- Rollback note:
- Applied change:
- Verification evidence: (when apply has been run or backtest exists)

Optional when useful for recall:
- Scope:
- Recall globs:

**PENDING-*** stubs (pre-apply grading notes) use the same heading fields; `Reason` may embed rubric scores until rolled into a short ACCEPTED entry after apply.

## Template

```markdown
### ACCEPTED-YYYYMMDD-NNN: [Short Title]

- Source task:
- Reason:
- Target layer:
- Date:
- Rollback note:
- Applied change:
- Verification evidence:
- Scope: (optional)
- Recall globs: (optional)
```

## Entries

### ACCEPTED-20260529-GNU-001: RENDER thread context classloader for JAVA_READY bootstrap

- Source task: GNUClient native bootstrap reaches JAVA_READY
- Reason: Migrated from `~/.cursor/rules/lessons/forge-injection.mdc`. Duplicate LaunchClassLoader instances caused Forge/EventBus init failures during JVMTI inject.
- Target layer: memory
- Date: 2026-05-29
- Rollback note: Delete this entry and Obsidian mirror `Harness/accepted-lessons/ACCEPTED-20260529-GNU-001.md`; restore source `.mdc` from backup if needed.
- Scope: **GNUClient project-local** — recall only when working in GNUClient / native-agent / gnu-client related files.
- Recall globs: `**/GNUClient/**`, `**/native-agent/**`, `**/gnu/client/**`, `**/*jni_bridge*`, `**/*glx_hook*`
- Applied change:

## [2026-05-29] Task: GNUClient native bootstrap reaches JAVA_READY

- ✅ DO: For addURL + class definition + init, capture the RENDER thread's context classloader (`Thread.currentThread().getContextClassLoader()`), inside the glXSwapBuffers hook.
- ❌ AVOID: Using `net.minecraft.launchwrapper.Launch.classLoader` — it can be a DUPLICATE LaunchClassLoader (e.g. @4dfa3a9d) with un-deobfuscated MC and uninitialized Forge/Loader/EventBus state; `EventBus.register` then NPEs in `Loader.<init>`.
- 💡 WHY: The live game runs on a different LaunchClassLoader (e.g. @1750fbeb) that is fully deobfuscated and has initialized FML state; only that loader works.

- Verification evidence: Migrated from validated project lesson file `forge-injection.mdc` (2026-05-29).

### ACCEPTED-20260529-GNU-002: Reflection anchor for MC classes in injected jar

- Source task: MC class references in an injected jar
- Reason: Migrated from `~/.cursor/rules/lessons/forge-injection.mdc`. Static SRG/notch refs in payload jars bypass FML deobf remapping.
- Target layer: memory
- Date: 2026-05-29
- Rollback note: Delete this entry and Obsidian mirror `Harness/accepted-lessons/ACCEPTED-20260529-GNU-002.md`; restore source `.mdc` from backup if needed.
- Scope: **GNUClient project-local** — recall only when working in GNUClient / native-agent / gnu-client related files.
- Recall globs: `**/GNUClient/**`, `**/native-agent/**`, `**/gnu/client/**`, `**/*jni_bridge*`, `**/*glx_hook*`
- Applied change:

## [2026-05-29] Task: MC class references in an injected jar

- ✅ DO: Keep the injected payload free of compile-time `net.minecraft.*` refs; resolve MC by reflection anchored on the non-obfuscated `net.minecraftforge.fml.client.FMLClientHandler.getClient()` (gives both instance and runtime Class, no hardcoded notch/SRG names).
- ❌ AVOID: Static SRG refs like `Minecraft.func_71410_x()` in the payload — the jar is NOT run through FML's deobf remapper, so `net.minecraft.client.Minecraft` → `NoClassDefFoundError` (real class is notch `bao`).
- 💡 WHY: addURL'd jars bypass deobf remapping; Forge classes (`net.minecraftforge.*`) are never obfuscated and load by name, so use them as the reflection anchor.

- Verification evidence: Migrated from validated project lesson file `forge-injection.mdc` (2026-05-29).

### ACCEPTED-20260529-GNU-003: Fresh JVM after native-agent rebuild

- Source task: Iterating on native-agent builds
- Reason: Migrated from `~/.cursor/rules/lessons/forge-injection.mdc`. `Agent_OnAttach` and mapped `.so` prevent hot-reload of rebuilt native agent in live JVM.
- Target layer: memory
- Date: 2026-05-29
- Rollback note: Delete this entry and Obsidian mirror `Harness/accepted-lessons/ACCEPTED-20260529-GNU-003.md`; restore source `.mdc` from backup if needed.
- Scope: **GNUClient project-local** — recall only when working in GNUClient / native-agent / gnu-client related files.
- Recall globs: `**/GNUClient/**`, `**/native-agent/**`, `**/gnu/client/**`, `**/*jni_bridge*`, `**/*glx_hook*`
- Applied change:

## [2026-05-29] Task: Iterating on native-agent builds

- ✅ DO: Restart Minecraft for every native-agent (.so) rebuild before re-injecting; verify the target pid is a fresh, rendering JVM (`libGLX_nvidia` mapped).
- ❌ AVOID: Re-injecting `--native` into a live JVM expecting new behavior — `Agent_OnAttach`'s `call_once` guard + the already-mapped .so + cached classes make it a no-op.
- 💡 WHY: One native agent load per JVM session; a fresh MC process is the only way to load a rebuilt .so/jar.

- Verification evidence: Migrated from validated project lesson file `forge-injection.mdc` (2026-05-29).

### ACCEPTED-20260529-GNU-004: Static Nunito TTFs for ImGui overlay

- Source task: Embedding Nunito in the native ImGui overlay
- Reason: Migrated from `~/.cursor/rules/lessons/imgui-overlay-fonts-and-verification.mdc`. Variable fonts and broken Google Fonts static paths break ImGui weight rendering.
- Target layer: memory
- Date: 2026-05-29
- Rollback note: Delete this entry and Obsidian mirror `Harness/accepted-lessons/ACCEPTED-20260529-GNU-004.md`; restore source `.mdc` from backup if needed.
- Scope: **GNUClient project-local** — recall only when working in GNUClient / native-agent / ImGui overlay paths.
- Recall globs: `**/GNUClient/**`, `**/native-agent/**`, `**/imgui_gui*`
- Applied change:

## [2026-05-29] Task: Embedding Nunito in the native ImGui overlay

- ✅ DO: Pull *static* weight TTFs from the `@expo-google-fonts/nunito` npm mirror via jsDelivr (`https://cdn.jsdelivr.net/npm/@expo-google-fonts/nunito/Nunito_400Regular.ttf`, `_600SemiBold`, `_700Bold`). Verify magic `00 01 00 00` and size (~132 KB).
- ❌ AVOID: `github.com/google/fonts/.../ofl/nunito/static/*.ttf` (404 — that dir now ships ONLY the variable font `Nunito[wght].ttf`). stb_truetype (ImGui) loads a variable font as a single default weight, so Bold/SemiBold won't differ.
- 💡 WHY: ImGui's stb_truetype has no variable-font axis support; you need one static TTF per weight. Resolve the font dir at runtime relative to the `.so` (`dladdr` → `<soDir>/../fonts`) and guard with `access()` + `AddFontDefault()` fallback so a missing file never asserts.

- Verification evidence: Migrated from validated project lesson file `imgui-overlay-fonts-and-verification.mdc` (2026-05-29).

### ACCEPTED-20260529-GNU-005: Hyprland overlay screenshot and menu toggle

- Source task: Screenshotting the in-game overlay for verification (Hyprland + XWayland)
- Reason: Migrated from `~/.cursor/rules/lessons/imgui-overlay-fonts-and-verification.mdc`. Overlay uses libevdev, not X11 key events; multi-workspace Hyprland needs focus before grim.
- Target layer: memory
- Date: 2026-05-29
- Rollback note: Delete this entry and Obsidian mirror `Harness/accepted-lessons/ACCEPTED-20260529-GNU-005.md`; restore source `.mdc` from backup if needed.
- Scope: **GNUClient project-local** — recall only when working in GNUClient / native-agent / ImGui overlay paths.
- Recall globs: `**/GNUClient/**`, `**/native-agent/**`, `**/imgui_gui*`
- Applied change:

## [2026-05-29] Task: Screenshotting the in-game overlay for verification (Hyprland + XWayland)

- ✅ DO: Toggle the menu with an evdev-level key via the already-running `ydotoold` virtual device (`ydotool key 110:1 110:0`, KEY_INSERT=110). It works because the overlay's libevdev reader enumerates `/dev/input/event*` ONCE at startup and the persistent `ydotoold virtual device` predates inject.
- ✅ DO: Find MC's Hyprland workspace/address (`hyprctl clients -j`), `hyprctl dispatch focuswindow address:<addr>` + `bringactivetotop`, then `grim`. Refocus the editor (`hyprctl dispatch focuswindow address:<cursor-addr>`) afterward.
- ❌ AVOID: `xdotool key INSERT` to toggle the menu — the overlay reads raw evdev, not X events, so XWayland key injection never reaches it. Also avoid plain `grim` with no focus management: it captures the active workspace/output, which may be a different monitor/app.
- 💡 WHY: The toggle path is evdev (uinput), not the windowing system; and on multi-workspace Hyprland the target window is often occluded/on another workspace, so you must raise it before capture.

- Verification evidence: Migrated from validated project lesson file `imgui-overlay-fonts-and-verification.mdc` (2026-05-29).

### ACCEPTED-CURATE-MEMORY-DISTILL: Accepted-lessons template alignment

- Source task: /harness-apply PENDING-CURATE-MEMORY-DISTILL (harness-curate re-grade 2026-06-03)
- Reason: Required Fields block did not match live entry shape; template-only fix per grade 86
- Target layer: memory
- Date: 2026-06-03
- Rollback note: Revert `## Required Fields` and `## Template` in accepted-lessons.md from git
- Applied change: Updated Required Fields and Template; Applied change and Verification evidence required; Scope/Recall optional
- Verification evidence: `grep -q 'Applied change:' harness/memory/accepted-lessons.md`; `grep -q 'Verification evidence:' harness/memory/accepted-lessons.md`

### ACCEPTED-CURATE-SUPERPOWERS-TRIM: Git-only superpowers archived

- Source task: /harness-apply PENDING-CURATE-SUPERPOWERS-TRIM (harness-curate re-grade 2026-06-03)
- Reason: Non-git workspace; git worktree skills mislead agents; narrow apply per grade 83
- Target layer: skills
- Date: 2026-06-03
- Rollback note: `mv archive/skills/superpowers-git/* .agents/skills/`; remove `.agents/skills/superpowers-scope.md`
- Applied change: Moved `using-git-worktrees` and `finishing-a-development-branch` to `archive/skills/superpowers-git/`; added `superpowers-scope.md` keep list
- Verification evidence: `test ! -d .agents/skills/using-git-worktrees`; `test -f .agents/skills/superpowers-scope.md`

### PENDING-20260601-RALPH-VERIFY: Accepted proposal

- Source task: post-task SDK chain
- Reason: Hard gates pass: no secrets exposure, no contradiction with user/project rules or empty accepted-lessons ledger, no undocumented APIs, no hook fail-closed broadening, no MCP expansion, and no hook runtime change. Evidence quality 19/20: Ralph iterations 12–18 failed with documented shell EOF from truncated verify_command in harness/memory/ralph-goal.md (unclosed quote on grep -v '^0); verify-gnu-packet-modules.sh exits 0 with 8 JAR class entries, matching rollout ROLLOUT-20260601-WF-PKT-001 — root cause is harness storage/quoting, not missing implementation. Generality 12/15: preferring harness/scripts/verify-*.sh over inline shell is durable, but the immediate fix names a project-specific script. Layer fit 5/10: targetLayer is memory yet the summary also requires ralph-agent-loop set-path validation (scripts/TS), blending layers beyond a single memory edit. Safety 14/15: strengthens verify integrity without weakening destructive-command or approval hooks. Backtest 6/15: script-path verify is proven; proposed quote/complexity rejection is not covered by verify-harness-commands.sh. Contradiction check 10/10: no conflicts with accepted or rejected lessons. Cost control 9/10: bounded set-time validation and shorter stored command. Reversibility 5/5: rollback note is explicit. Total 81 → accept with human review: apply the ralph-goal.md script-path normalization under memory auto-apply; land quote/complexity validation in ralph-agent-loop via /harness-apply with verify-harness-commands backtests.
- Target layer: memory
- Date: 2026-06-01
- Rollback note: Revert ralph-goal.md verify_command to prior inline shell string and remove quote/complexity validation from ralph-goal.sh set path.
- Applied change:

Normalize Ralph verify storage: `harness/memory/ralph-goal.md` uses `sh harness/scripts/verify-gnu-packet-modules.sh`. `validateVerifyCommandShape()` in `ralph-state.ts` rejects unbalanced quotes, commands over 200 chars, and complex inline shell (pipes, nested single quotes); `/harness-apply` landed this in `ralph-agent-loop.ts` cmdSet.

### PENDING-20260602-AIMASSIST-HUMANIZE: Accepted proposal

- Source task: post-task SDK chain
- Reason: Hard gates pass: no secrets exposure, no contradiction with user/project rules or empty rejected-lessons ledger, no undocumented APIs, no hook fail-closed broadening, no MCP expansion, and no hook runtime change. Evidence quality 18/20: reflection documents four iterative AimAssist passes with live anticheat feedback; ./gradlew shadowJar BUILD SUCCESSFUL and AimAssistModule.java final state match every cited constant and technique (verticalSpeed 1.2f, maxPitchStep = v * 0.15f, EASE_REACH 8.0f, JITTER_AMP 0.018f, 15%/10% skip-tick gates, yawOvershot under 3°, SPEED_LERP_ALPHA 0.20f, roundGcd on steps); minor gap is no explicit logged Vulcan all-clear after the final pass. Generality 14/15: fixed-multiplier pitch cap vs live mouse GCD in injected runtimes and the layered humanization checklist generalize to combat-parity and anticheat tuning beyond this session, though numeric defaults are tunable starting points. Layer fit 10/10: targetLayer memory correctly appends a focused AimAssist entry to harness/memory/reasoning-patterns.md and fills a gap left by PATTERN-20260602-225850 from the same session (lag/sprint only). Safety 14/15: memory-only guidance within existing GNUClient/Vulcan project scope; no hook or policy weakening. Backtest 12/15: build and repo state verify the pattern; live AC regression confirmation remains user-side. Contradiction check 10/10: no conflicts with accepted or rejected lessons; complements lag/sprint and setsid patterns without duplicating them. Cost control 10/10: single bounded memory append. Reversibility 5/5: rollback note is explicit. Total 92 → accept.
- Target layer: memory
- Date: 2026-06-02
- Rollback note: Remove the AimAssist humanization pattern entry from harness/memory/reasoning-patterns.md.
- Applied change:

Append reasoning pattern for Vulcan AimAssist rotation flags: cap pitch with fixed multiplier (verticalSpeed * 0.15f) not mouse GCD; humanization checklist — separate vertical speed (~40% horizontal), easeFactor(1-exp(-angDist/8)), sin-phase jitter, speed lerp, skip-tick probabilities, overshoot correction, GCD rounding on steps — for reuse in combat-parity and anticheat tuning sessions.

### PENDING-20260602-RETRO-DONE-GUARD: Accepted proposal

- Source task: post-task SDK chain
- Reason: Hard gates pass: no secrets exposure, no contradiction with user/project rules or empty rejected-lessons ledger, no undocumented APIs, no hook fail-closed broadening, no MCP expansion, no background-cost increase, and change stays in POSIX sh. Evidence quality 20/20: post-task-chain.log line 211 starts 65239e03-retro while line 212 reasoning and line 216 done belong to session 6637b8ce; retroactive-reflect.log lines 95–96 show false skip (already completed) — matches generation_completed() lines 66–71 matching any done rollout= after -retro start. Generality 14/15: session-scoped completion is durable for multiplexed post-task-chain.log batch replay, slightly coupled to reasoning-before-done log ordering. Layer fit 8/10: scripts/retroactive-reflect.sh is correct, but generation_in_progress() lines 54–55 share the same any-done grep and should be updated in the same rollout. Safety 15/15: tightens skip logic without weakening approvals or destructive-command protections; reduces false skip of substantive sessions (9158 tokens). Backtest 7/15: failure is reproducible from committed logs but no verify-harness-commands or retroactive-reflect fixture test is proposed. Contradiction check 10/10: complements PATTERN-20260602-225449 (setsid detachment) without conflicting accepted/rejected lessons. Cost control 10/10: bounded grep logic only. Reversibility 5/5: explicit rollback note. Total 89 → accept with human review: apply session-scoped retro-window check to both generation_completed() and generation_in_progress(), and add a minimal log-fixture backtest when landing.
- Target layer: scripts
- Date: 2026-06-02
- Rollback note: Revert generation_completed() retro-window check to prior behavior that matches any done rollout= after -retro start.
- Applied change:

`harness/scripts/retroactive-reflect.sh`: session-scoped completion via `session_completed_in_window()` — only `reasoning pattern appended session=${gen}` counts (bare interleaved `done rollout=` from another chain ignored). `log_window_after_line()` scopes original and `-retro` windows. `HARNESS_RETRO_SELFTEST=1` + `harness/scripts/fixtures/retro-done-guard.log`; wired in `verify-harness-commands.sh`. Applied 2026-06-03 via `/harness-apply PENDING-20260602-RETRO-DONE-GUARD`.
- Verification evidence: `HARNESS_RETRO_SELFTEST=1 sh harness/scripts/retroactive-reflect.sh` exit 0; `verify-harness-commands.sh` PASS `retroactive-reflect session-scoped done guard`.

### PENDING-20260603-CURATE-DRAFT-LEDGER: Accepted proposal

- Source task: post-task SDK chain
- Reason: Hard gates pass: no secrets exposure, no contradiction with user/project rules or accepted/rejected lessons, no undocumented APIs, no hook fail-closed broadening, no MCP expansion, and no hook runtime change. Evidence quality 19/20: session 6637b8ce documents grading five PENDING-CURATE items while pending-proposals.md was empty until post-grade draft; harness/memory/pending-proposals.md now holds five dated stubs (three applied 81/87/90, two on_hold 70/75); PATTERN-20260603-020242 and latest-reflection.md repeat ledger friction as a failed pattern. Generality 14/15: inventory→ledger stubs→grade→apply generalizes across harness curation cycles, slightly coupled to PENDING-CURATE-* naming. Layer fit 7/10: targetLayer command is correct for harness-curate.md, but summary also requires harness-project-intake checklist/skill text (skills layer); commands category is locked per harness.yaml. Safety 15/15: codifies inactive stub drafting only—aligns with harness-curate.md line 14 (changes become inactive pending proposals) without weakening approvals, hooks, or permitting skill/archive edits during curate. Backtest 7/15: end-state ledger and successful grade/apply cycle verify manually; no verify-harness-commands or doctor fixture proposed to enforce stubs-before-grade. Contradiction check 9/10: complements PATTERN-20260603-020242 and existing curate apply gate; minor tension with read-only framing should clarify memory ledger drafting is allowed curate output, not /harness-apply. Cost control 10/10: bounded stub template reduces transcript-only grading friction. Reversibility 5/5: explicit rollback note. Total 86 → accept with human review: land command (+ intake checklist) text via /harness-apply on locked commands/skills layers; optionally add a doctor or verify-harness-commands check that curate output includes pending-proposals stubs before grade.
- Target layer: command
- Date: 2026-06-02
- Rollback note: Revert harness-curate.md and harness-project-intake skill text to omit mandatory pending-proposals drafting step.
- Applied change:

Require /harness-curate (and harness-project-intake skill) to draft inactive PENDING-CURATE-* stubs in harness/memory/pending-proposals.md as part of read-only curation output, before /harness-grade. Session 6637b8ce graded from transcript-only evidence because the ledger was empty until post-grade apply, adding friction noted in the grade report.

### PENDING-20260603-GNUCLIENT-LAG-DRAIN-CHECKLIST: Accepted proposal

- Source task: post-task SDK chain
- Reason: Hard gates pass: no secrets exposure, no undocumented APIs, no hook fail-closed broadening, no MCP expansion, and no hook runtime change; proposal explicitly supersedes stale batch-drain wording in PROP-20260603-LAGRANGE-TICK-DRAIN-SKILL accepted-lessons rather than conflicting with user/project rules. Evidence quality 19/20: multi-day session with ./gradlew shadowJar BUILD SUCCESSFUL and gnu-client.jar staged; user videos and feedback document Simulation/BadPackets improvements and remaining Timer/Reach at 309ms; LagrangeModule.java matches proposed invariants (onTickStart try/finally with drainOutboundQueueIfIdle, session-only flushLag, releaseExpiredLimited 2/tick-start and 1/send, drainUpTo 2/pass, flushLagBeforeAttack without full FIFO burst); gnu client/Decision - Lagrange 309ms staggered C03.md and OutboundLagQueue.java present; minor gap — staggered-release Grim all-clear and rubberband resolution remain user-verify after final re-inject. Generality 14/15: try/finally drain, session-only flushLag, ≥300ms stagger caps, attack-path ordering, and Raven diff-before-hybrid checklist generalize across GNUClient lag modules on Grim/Vulcan, though numeric caps are 309ms-profile starting points. Layer fit 7/10: summary correctly targets .agents/skills/gnuclient-dev/SKILL.md but targetLayer agents is invalid per harness.yaml locked categories — should be skills at apply. Safety 15/15: skill-only guidance reinforcing shadowJar+re-inject before live AC claims without weakening hooks or approvals. Backtest 10/15: build, jar staging, and final code paths verified; verify-gnu-packet-modules.sh does not assert stagger semantics; live AC regression for stagger build remains user-side. Contradiction check 9/10: resolves drift between prior accepted-lessons batch releaseExpiredPackets text and final staggered code; apply must supersede PROP-20260603-LAGRANGE-TICK-DRAIN-SKILL subsection and cross-link Decision - Lagrange 309ms staggered C03.md. Cost control 10/10: bounded checklist subsection. Reversibility 5/5: explicit rollback note. Total 89 → accept with human review: apply via /harness-apply on locked skills layer with targetLayer corrected to skills; supersede stale tick-and-drain batch-drain wording; confirm post-re-inject Grim/Vulcan at 309ms before treating stagger guidance as settled.
- Target layer: agents
- Date: 2026-06-03
- Rollback note: Remove the Lag module parity checklist section from .agents/skills/gnuclient-dev/SKILL.md.
- Applied change:

Extend .agents/skills/gnuclient-dev/SKILL.md with a Lag module parity checklist: (1) onTickStart combat in try/finally that always drains when not lagging; (2) flushLag ends session only—no sync full FIFO drain; (3) at delay ≥300ms cap releaseExpired and post-flush drain per tick (stagger 1–2 C03) to avoid Grim Timer bursts; (4) attack path: session flush only, never pre-drain C03 before C02; (5) diff raven-bS tick hook + BiTrackLagNodeQueue before applying AC-safe hybrid patches.

### PENDING-20260603-GNUCLIENT-LAG-SKILL-REVISE-STAGGER: Accepted proposal

- Source task: post-task SDK chain
- Reason: Hard gates pass: no secrets exposure, no undocumented APIs, no hook fail-closed broadening, no MCP expansion, and no hook runtime change; proposal is skill-only guidance that corrects harmful stagger-cap text before PENDING-20260603-GNUCLIENT-LAG-DRAIN-CHECKLIST is applied to .agents/skills/gnuclient-dev/SKILL.md. Evidence quality 19/20: multi-day session with repeated ./gradlew shadowJar BUILD SUCCESSFUL and gnu-client.jar staged; user video 03-28-05 and reflection outcome document stagger/C03-only/gradual-drain made Grim flags worse than prior build; final code uses LagrangeOutboundTrack with batch releaseExpired (LagrangeModule.java, LagrangeOutboundTrack.java) matching revert decision; gnu client/Decision - Lagrange UnifiedLagTrack revert stagger.md, blatant Raven parity, tick and drain parity, and AC-safe hybrid notes corroborate velocity-dummy gate (currentTarget != null only, no sendSwing on C02) and blatant anti-patterns; minor gap — post–LagrangeOutboundTrack live Grim/Vulcan all-clear still user-verify after re-inject. Generality 14/15: velocity-dummy benchmark invariants, blatant anti-pattern table, and prerequisite session-marker/flushLag/LOWEST-last ordering generalize across GNUClient raven-bS lag ports on Grim/Vulcan, though scoped to 1.8.9 JVMTI packet path. Layer fit 10/10: targetLayer skills correctly names gnuclient-dev/SKILL.md (fixes prior DRAIN-CHECKLIST agents mis-tag) and sequences revise-before-apply. Safety 15/15: reinforces shadowJar+re-inject before live AC claims and blocks AC-safe hybrid paths without weakening hooks or approvals. Backtest 11/15: build, jar staging, decision docs, and final code paths verified; verify-gnu-packet-modules.sh does not assert lag queue semantics; live AC regression remains user-side. Contradiction check 10/10: explicitly deletes ≥300ms stagger-cap bullets that conflict with accepted-lessons DRAIN-CHECKLIST applied-change text and PROP-20260603-LAGRANGE-TICK-DRAIN-SKILL batch-drain guidance; cross-links revert-stagger decision; apply must supersede DRAIN-CHECKLIST stagger wording and merge into one checklist subsection. Cost control 10/10: bounded Lag parity checklist revision. Reversibility 5/5: explicit rollback note. Total 93 → accept with human review: apply via /harness-apply on locked skills layer; merge revised checklist instead of raw DRAIN-CHECKLIST stagger bullets; confirm post-re-inject velocity-dummy benchmark before treating parity guidance as settled.
- Target layer: skills
- Date: 2026-06-03
- Rollback note: Remove the revised Lag module parity subsection from .agents/skills/gnuclient-dev/SKILL.md and restore prior checklist wording.
- Applied change:

Revise .agents/skills/gnuclient-dev/SKILL.md Lag parity checklist before applying PENDING-20260603-GNUCLIENT-LAG-DRAIN-CHECKLIST: delete ≥300ms stagger-cap bullets (03-28-05 proved worse); add velocity-dummy benchmark invariants (gate on currentTarget != null only per raven-bS LagRange, no sendSwing on C02 intercept); add blatant anti-patterns (no C03-only queue, no 1/tick release cap, no queue cap/eviction, no cancel-on-KB abort, no KD abortLagNow on every S12); require LagrangeOutboundTrack session marker + session-only flushLag + forward PacketEvents LOWEST-last before any stagger experiment; cross-link Decision - Lagrange UnifiedLagTrack revert stagger.md.

### PENDING-20260603-GNUCLIENT-QUEUE-POLICY: Accepted proposal

- Source task: post-task SDK chain
- Reason: Hard gates pass: no secrets exposure, no undocumented APIs, no hook fail-closed broadening, no MCP expansion, and no hook runtime change; proposal explicitly supersedes stale FIFO-drain text in the prior accepted-lessons entry rather than conflicting with user/project rules. Evidence quality 19/20: session 6637b8ce documents Grim PacketOrderB/F root-cause analysis, eliminated Simulation and PacketOrderB pre-attack flags, ./gradlew compileJava/shadowJar BUILD SUCCESSFUL across iterations, user-confirmed lower flag rate on velocity-dummy test, LagrangeModule.java matches hold-only semantics (flushQueueNow→cancelLagQueue discard-only, no releaseExpiredPackets/drainMovementQueueNow, cancel on attack/block/S12/S27 explosion/self-hurt, oldestQueuedPosition for Server ESP, trade-range start with requireHitMark off/onlyWhileClicking on/closeLag off, STOP sprint on lag start+attack); minor gaps — rubberband severity and brief Simulation while lagging remain user-verify after re-inject. Generality 14/15: Grim hold-only C03 invariants and default Grim tuning generalize across Lagrange/Blink/Backtrack on GNUClient 1.8.9 JVMTI parity, though numeric defaults are Grim-scoped starting points. Layer fit 10/10: targetLayer skills correctly extends .agents/skills/gnuclient-dev/SKILL.md where PacketHelper centralization and cancelLagQueue anti-pattern exist but lack the full hold-only policy table agents rediscovered. Safety 15/15: reinforces never-inject queued C03 and shadowJar+re-inject before live AC claims without weakening hooks or approvals. Backtest 11/15: build, jar staging, and final code paths verified; gnu client/Decision - Lagrange C03-only queue.md cross-linked but §3 still mentions drainMovementQueueNow — align at apply; live rubberband regression remains user-side. Contradiction check 9/10: resolves contradiction between prior accepted-lessons FIFO wording and final hold-only code; complements PATTERN-20260602-225155 and gnuclient-dev anti-patterns. Cost control 10/10: bounded short subsection. Reversibility 5/5: explicit rollback note. Total 93 → accept with human review: apply via /harness-apply on locked skills layer; replace FIFO-drain table with hold-only semantics and sync decision-doc drain wording.
- Target layer: skills
- Date: 2026-06-02
- Rollback note: Remove the packet-queue policy subsection from .agents/skills/gnuclient-dev/SKILL.md.
- Applied change:

Revise gnuclient-dev packet-queue policy at /harness-apply: replace accepted FIFO-drain wording with final Grim hold-only semantics from session end — never inject or per-tick-release queued C03; cancel queue on attack/KB/S12/S27; flushQueueNow equals discard only; Server ESP reads oldest queued position; default trade-range start (Require hit mark off, Only while clicking on, Closing lag off on Grim); STOP sprint on lag start and attack; cross-link gnu client/Decision - Lagrange C03-only queue.md and shadowJar+re-inject before live AC claims.

### PROP-20250603-001: Accepted proposal (Obsidian vault)

- Source task: Obsidian vault mirror (`Harness/accepted-lessons/PROP-20250603-001.md`)
- Reason: Ported accepted-lesson substance from harness vault for SISpace canonical memory.
- Target layer: (see vault tags / rollout-log)
- Date: 2026-06-03
- Rollback note: Delete this entry and Obsidian mirror `Harness/accepted-lessons/PROP-20250603-001.md`.
- Applied change:

Add a harness-workflow or architecture-planning skill rule: when the user names an explicit output file (e.g. SISPACE_PLAN.md), write the completed plan directly to that path after research; use CreatePlan only when the user asks for interactive approval or does not name a deliverable path.

### PROP-20250603-002: Accepted proposal (Obsidian vault)

- Source task: Obsidian vault mirror (`Harness/accepted-lessons/PROP-20250603-002.md`)
- Reason: Ported accepted-lesson substance from harness vault for SISpace canonical memory.
- Target layer: (see vault tags / rollout-log)
- Date: 2026-06-03
- Rollback note: Delete this entry and Obsidian mirror `Harness/accepted-lessons/PROP-20250603-002.md`.
- Applied change:

Add a harness-workflow skill rule: before running destructive greenfield scaffolders (e.g. create-tauri-app --force) in a repo with .cursor/ and harness/, prefer manual integration into the existing tree; if --force is unavoidable, run harness-install.sh --force immediately after and verify hooks/agents restored before continuing.

### PROP-20250603-003: Accepted proposal (Obsidian vault)

- Source task: Obsidian vault mirror (`Harness/accepted-lessons/PROP-20250603-003.md`)
- Reason: Ported accepted-lesson substance from harness vault for SISpace canonical memory.
- Target layer: (see vault tags / rollout-log)
- Date: 2026-06-03
- Rollback note: Delete this entry and Obsidian mirror `Harness/accepted-lessons/PROP-20250603-003.md`.
- Applied change:

Add a harness integration doc describing the desktop sidecar SSE bridge pattern: Node sidecar wraps HARNESS_HOME dist with SSE endpoints; Rust blocking reqwest consumer uses explicit Accept: text/event-stream + manual JSON body (not .json()); events persist locally and relay via Tauri/framework events to React UI. Reference SISpace pipeline_client.rs + scripts/pipeline-lib.mjs as canonical example.

### PROP-20250603-004: Accepted proposal (Obsidian vault)

- Source task: Obsidian vault mirror (`Harness/accepted-lessons/PROP-20250603-004.md`)
- Reason: Ported accepted-lesson substance from harness vault for SISpace canonical memory.
- Target layer: (see vault tags / rollout-log)
- Date: 2026-06-03
- Rollback note: Delete this entry and Obsidian mirror `Harness/accepted-lessons/PROP-20250603-004.md`.
- Applied change:

Add a feature-task skill rule for CSS/modal surface bugs: run verify-and-close first when source already matches spec (zero app diff). Require a verify script that parses CSS rules, asserts TSX className contracts (no reliance on unstyled semantic classes), includes fail-before-fix simulation, and optionally adds Playwright computed-style checks per verify-test-html.mjs when full Tauri/E2E is impractical.

### PROP-20250603-007: Accepted proposal (Obsidian vault)

- Source task: Obsidian vault mirror (`Harness/accepted-lessons/PROP-20250603-007.md`)
- Reason: Ported accepted-lesson substance from harness vault for SISpace canonical memory.
- Target layer: (see vault tags / rollout-log)
- Date: 2026-06-03
- Rollback note: Delete this entry and Obsidian mirror `Harness/accepted-lessons/PROP-20250603-007.md`.
- Applied change:

Extend Obsidian verification so sync cross-link changes require E2E proof: add a `--require-sync-links` mode to verify-obsidian-vault-graph.mjs (or a verify-obsidian-integration.sh step) that fails when OBSIDIAN_API_KEY is set but no rollout/reasoning/accepted-lesson note under Harness/ contains `## Related`, and document in obsidian-sync.md that after post-task-chain link-logic changes developers must run one graded post-task chain to populate links (pre-existing synced notes are not auto-backfilled).
- [[Harness/rollout-log/ROLLOUT-20260603-070753-sdk]]

### PROP-20260603-004: Accepted proposal (Obsidian vault)

- Source task: Obsidian vault mirror (`Harness/accepted-lessons/PROP-20260603-004.md`)
- Reason: Ported accepted-lesson substance from harness vault for SISpace canonical memory.
- Target layer: (see vault tags / rollout-log)
- Date: 2026-06-03
- Rollback note: Delete this entry and Obsidian mirror `Harness/accepted-lessons/PROP-20260603-004.md`.
- Applied change:

Add a harness/memory architecture note documenting SISpace model routing: tasks store one model_id; DEFAULT_MODEL_ID is composer-2.5-fast in TS, Rust, YAML, and harness-orchestrator; OpenClaw hybrid steps in sidecar/handlers/pipeline.mjs pass opts.model to every runCursorAgentStep and ignore .cursor/agents model frontmatter; no subagent_model_id or context-window variant exists yet—cost bugs should trace this map before implementing UI fixes.

## Related

- [[Harness/rollout-log/ROLLOUT-20260603-151711-sdk]]

### PROP-20260603-005: Accepted proposal (Obsidian vault)

- Source task: Obsidian vault mirror (`Harness/accepted-lessons/PROP-20260603-005.md`)
- Reason: Ported accepted-lesson substance from harness vault for SISpace canonical memory.
- Target layer: (see vault tags / rollout-log)
- Date: 2026-06-03
- Rollback note: Delete this entry and Obsidian mirror `Harness/accepted-lessons/PROP-20260603-005.md`.
- Applied change:

Add a harness-workflow port checklist bullet: when copying verify scripts from another project, replace project-specific test fixtures (e.g. minecraft jar class greps) with neutral examples and remove stale memory placeholder lines (e.g. '') when entries already exist below.

### PROP-20260603-006: Accepted proposal (Obsidian vault)

- Source task: Obsidian vault mirror (`Harness/accepted-lessons/PROP-20260603-006.md`)
- Reason: Ported accepted-lesson substance from harness vault for SISpace canonical memory.
- Target layer: (see vault tags / rollout-log)
- Date: 2026-06-03
- Rollback note: Delete this entry and Obsidian mirror `Harness/accepted-lessons/PROP-20260603-006.md`.
- Applied change:

Add a harness-workflow troubleshooting bullet: when Obsidian MCP tools are missing despite healthy REST (127.0.0.1:27123), check project `.cursor/mcp.json` first—empty `mcpServers: {}` seeded by harness-install can override global config; fix by populating the obsidian HTTP entry with `${env:OBSIDIAN_API_KEY}` or deleting the project file; treat harness-doctor file-grep HEALTHY as necessary not sufficient; require Cursor reload before declaring runtime `mcp_get_tools` pass; use vault filesystem path for task notes while MCP is unavailable.

### PROP-20260603-008: Accepted proposal (Obsidian vault)

- Source task: Obsidian vault mirror (`Harness/accepted-lessons/PROP-20260603-008.md`)
- Reason: Ported accepted-lesson substance from harness vault for SISpace canonical memory.
- Target layer: (see vault tags / rollout-log)
- Date: 2026-06-03
- Rollback note: Delete this entry and Obsidian mirror `Harness/accepted-lessons/PROP-20260603-008.md`.
- Applied change:

Extend researcher-agent.md with a harness-knowledge-graph research checklist: before recommending link rules, read post-task-chain.ts syncObsidianEntries block and obsidian.ts appendLinksSection; compare repo entity IDs (ROLLOUT-*, PROP-*, PATTERN-*, session UUID) to vault paths; MCP-read at least one well-formed and one stale vault note; output allowed edges and explicit non-links separately, flagging schema/code drift as planned vs implemented.

## Related

- [[Harness/rollout-log/ROLLOUT-20260603-160845-sdk]]

### PROP-20260603-009: Accepted proposal (Obsidian vault)

- Source task: Obsidian vault mirror (`Harness/accepted-lessons/PROP-20260603-009.md`)
- Reason: Ported accepted-lesson substance from harness vault for SISpace canonical memory.
- Target layer: (see vault tags / rollout-log)
- Date: 2026-06-03
- Rollback note: Delete this entry and Obsidian mirror `Harness/accepted-lessons/PROP-20260603-009.md`.
- Applied change:

Add a short 'Pipeline runtime path' invariant to SISPACE_PLAN.md (or README): Tauri spawns lib/node-server.mjs → lib/pipeline-run.mjs; scripts/pipeline-lib.mjs is shared helpers only and is not the live sidecar entry; any pipeline behavior change must touch lib/ and pass tests/pipeline-model.test.mjs assertions on lib/ wiring.

## Related

- [[Harness/rollout-log/ROLLOUT-20260603-162714-sdk]]

### PROP-20260603-010: Accepted proposal (Obsidian vault)

- Source task: Obsidian vault mirror (`Harness/accepted-lessons/PROP-20260603-010.md`)
- Reason: Ported accepted-lesson substance from harness vault for SISpace canonical memory.
- Target layer: (see vault tags / rollout-log)
- Date: 2026-06-03
- Rollback note: Delete this entry and Obsidian mirror `Harness/accepted-lessons/PROP-20260603-010.md`.
- Applied change:

Update tests/verify-cursorsi-phase0b.mjs to assert stable Phase 0b wiring markers (Agent.create SDK loop, real slash router handlers, bootstrapCredential in bin/cursorsi.mjs) instead of grepping the ephemeral help banner phase string that drifts every milestone (currently fails with 'bin help mentions Phase 0b' while banner says Phase 1d).

## Related

- [[Harness/rollout-log/ROLLOUT-20260603-185932-sdk]]

### PROP-20260603-LAGRANGE-TICK-DRAIN-SKILL: Accepted proposal

- Source task: post-task SDK chain
- Reason: Hard gates pass: no secrets exposure, no undocumented APIs, no hook fail-closed broadening, no MCP expansion, and no hook runtime change; proposal explicitly supersedes stale hold-only/FIFO text in prior PENDING-20260603-GNUCLIENT-QUEUE-POLICY accepted-lessons entries rather than conflicting with user/project rules. Evidence quality 19/20: multi-day session with ./gradlew shadowJar BUILD SUCCESSFUL verified in-session and at reflection time; gnu-client.jar staged; user videos reviewed and user confirmed reduced Simulation flags (transcript L2478); LagrangeModule.java matches final semantics (onTickStart combat before C03, session-only flushLag, batch releaseExpiredPackets, no pre-attack C03 burst); gnu client/Decision - Lagrange tick and drain parity.md and InboundLagCoordinator.java present; minor gap — post-tick-parity live Grim all-clear and rubberband resolution remain user-verify after re-inject. Generality 14/15: tick-timing, flush/drain lifecycle, attack-path ordering, blatant Raven all-outbound vs AC-safe hybrid, and InboundLagCoordinator inbound ownership generalize across GNUClient lag modules on Grim/Vulcan, though scoped to 1.8.9 JVMTI/raven-bS parity. Layer fit 10/10: targetLayer skills correctly extends .agents/skills/gnuclient-dev/SKILL.md, which lacks a packet-queue policy subsection beyond a cancelLagQueue anti-pattern. Safety 15/15: reinforces shadowJar+re-inject before live AC claims and correct packet order without weakening hooks or approvals. Backtest 11/15: build, jar staging, and code paths verified; verify-gnu-packet-modules.sh does not assert queue semantics; live AC regression remains user-side. Contradiction check 9/10: resolves drift between prior accepted-lessons FIFO (90) and hold-only (93) wording and final blatant Raven tick-and-drain code; complements session reasoning-patterns and decision notes; apply should retire/supersede PENDING-20260603-GNUCLIENT-QUEUE-POLICY stub to avoid duplicate ledger entries. Cost control 10/10: bounded short subsection. Reversibility 5/5: explicit rollback note. Total 93 → accept with human review: apply via /harness-apply on locked skills layer; supersede stale PENDING-20260603-GNUCLIENT-QUEUE-POLICY at apply; cross-link Decision - Lagrange tick and drain parity.md; confirm post-re-inject Grim/Vulcan on velocity-dummy before treating rubberband guidance as settled.
- Target layer: skills
- Date: 2026-06-03
- Rollback note: Remove the packet-queue / tick-and-drain policy subsection from .agents/skills/gnuclient-dev/SKILL.md.
- Applied change:

Extend .agents/skills/gnuclient-dev/SKILL.md with a packet-queue policy subsection reflecting final session semantics: Lagrange combat on onTickStart (before C03), flushLag session-only (Raven forceTimeOut), releaseExpiredPackets drains all FIFO-expired per tick, no pre-attack C03 burst; blatant Raven all-outbound queue (not AC-safe hybrid); InboundLagCoordinator inbound ownership; cross-link gnu client/Decision - Lagrange tick and drain parity.md. Supersedes stale hold-only wording in PENDING-20260603-GNUCLIENT-QUEUE-POLICY at apply time.

### PROP-20260604-003: Accepted proposal (Obsidian vault)

- Source task: Obsidian vault mirror (`Harness/accepted-lessons/PROP-20260604-003.md`)
- Reason: Ported accepted-lesson substance from harness vault for SISpace canonical memory.
- Target layer: (see vault tags / rollout-log)
- Date: 2026-06-04
- Rollback note: Delete this entry and Obsidian mirror `Harness/accepted-lessons/PROP-20260604-003.md`.
- Applied change:

Add a harness-workflow skill rule for Ralph-style goal loops in CursorSI/harness integrations: run the goal verify command only after an agent turn produces actual worktree changes (e.g. git diff --quiet / hasGitWorktreeChanges()), not on every message; inject active goal context only on explicit user /goal or /goal resume, never automatically on session mount from harness/memory/goals.md.

## Related

- [[Harness/rollout-log/ROLLOUT-20260604-194408-sdk]]

### PROP-20260604-004: Accepted proposal (Obsidian vault)

- Source task: Obsidian vault mirror (`Harness/accepted-lessons/PROP-20260604-004.md`)
- Reason: Ported accepted-lesson substance from harness vault for SISpace canonical memory.
- Target layer: (see vault tags / rollout-log)
- Date: 2026-06-04
- Rollback note: Delete this entry and Obsidian mirror `Harness/accepted-lessons/PROP-20260604-004.md`.
- Applied change:

Add a SISPACE_V2_PLAN.md architecture-decision subsection: (1) Unix-socket pane IPC (--event-socket NDJSON + PaneIpcHub) is the orchestration boundary—embedded xterm vs external kitty is a display/transport choice, not an orchestrator requirement; (2) when PTY stdin is removed, document the *.ctrl.sock inject pattern (cli/src/pane/control.ts); (3) Phase 7 Linux notifications use a pending-focus queue (notification_focus_pending + window focus) because desktop notification click callbacks are unreliable.

## Related

- [[Harness/rollout-log/ROLLOUT-20260604-195200-sdk]]

### PROP-20260604-005: Accepted proposal (Obsidian vault)

- Source task: Obsidian vault mirror (`Harness/accepted-lessons/PROP-20260604-005.md`)
- Reason: Ported accepted-lesson substance from harness vault for SISpace canonical memory.
- Target layer: (see vault tags / rollout-log)
- Date: 2026-06-04
- Rollback note: Delete this entry and Obsidian mirror `Harness/accepted-lessons/PROP-20260604-005.md`.
- Applied change:

Fix sessionHasReflectableContent in cli/src/harness/transcript.ts to exclude the actual Phase 0b startup banner ("ready — type a message or /help" or a sess_* ready-line regex) and add a behavioral assertion in tests/verify-cursorsi-phase1a.mjs that boilerplate-only sessions (ready + Obsidian prefetch lines, no you>/agent> turns) return false, preventing empty cursorsi exits from launching post-task-chain.

## Related

- [[Harness/rollout-log/ROLLOUT-20260604-200016-sdk]]

### PROP-20260604-006: Accepted proposal (Obsidian vault)

- Source task: Obsidian vault mirror (`Harness/accepted-lessons/PROP-20260604-006.md`)
- Reason: Ported accepted-lesson substance from harness vault for SISpace canonical memory.
- Target layer: (see vault tags / rollout-log)
- Date: 2026-06-04
- Rollback note: Delete this entry and Obsidian mirror `Harness/accepted-lessons/PROP-20260604-006.md`.
- Applied change:

Add a single harness-workflow skill bullet for Tauri+Node sidecar debugging: before fixing pipeline/sidecar bugs, read src-tauri/src/services/node_host.rs to confirm the spawned script (SISpace: lib/node-server.mjs → lib/pipeline-run.mjs, not scripts/pipeline-lib.mjs); apply Node changes to the live lib/ path; cross-link accepted PROP-20260604-001 docs troubleshooting for SSE/truncation/restart details; instruct user that Node fixes need full SISpace quit (sidecar reload) and Rust/UI fixes need npm run build + cargo rebuild before declaring verified.

## Related

- [[Harness/rollout-log/ROLLOUT-20260604-200640-sdk]]

### PROP-20260604-compaction-cutpoint-tests: Accepted proposal (Obsidian vault)

- Source task: Obsidian vault mirror (`Harness/accepted-lessons/PROP-20260604-compaction-cutpoint-tests.md`)
- Reason: Ported accepted-lesson substance from harness vault for SISpace canonical memory.
- Target layer: (see vault tags / rollout-log)
- Date: 2026-06-04
- Rollback note: Delete this entry and Obsidian mirror `Harness/accepted-lessons/PROP-20260604-compaction-cutpoint-tests.md`.
- Applied change:

Add runtime unit tests for exported compaction pure functions (findCompactionCutPoint, shouldAutoCompact, estimateSessionContextTokens, trimLinesAfterCompaction) in tests/cursorsi-compaction-unit.mjs — the session required a mid-implementation cut-point fix while verify:cursorsi-compaction only static-greps source, leaving boundary edge cases unguarded.

## Related

- [[Harness/rollout-log/ROLLOUT-20260604-224625-sdk]]

### PENDING-YYYYMMDD-001: Accepted proposal

- Source task: harness panel accept
- Reason: Manually accepted via harness panel (2026-06-04)
- Target layer: 
- Date: 2026-06-04
- Rollback note: Revert the applied change per proposal text.
- Applied change:



### PENDING-LAGRANGE-AC-CHECKLIST: Accepted proposal

- Source task: harness panel accept
- Reason: Manually accepted via harness panel (2026-06-04)
- Target layer: skills
- Date: 2026-06-04
- Rollback note: Revert the applied change per proposal text.
- Applied change:

Extend `.agents/skills/combat-parity/SKILL.md` with a Raven-only lag-module anticheat checklist: (1) grep audit for per-tick multi-packet drain paths, (2) C03-only queue vs mixed outbound tradeoffs, (3) tick-capped release constants, (4) mandatory pre-C02 drain, (5) self-S12 velocity abort, (6) staggered post-combat flush—sourced from session 6637b8ce Grim Simulation x1–x7 and Vulcan Speed flag cycles after user mandated Raven-only lag references.

### ACCEPTED-20250603-PIPELINE-RUNTIME: Live Node sidecar path (PROP-20250603-004)

- Source task: harness panel apply-all (session sispace-panel-apply-PROP-20250603-004-1780607448654)
- Reason: Verified user regression from editing scripts/pipeline-lib.mjs while runtime uses lib/pipeline-run.mjs; durable verify/memory rule prevents repeat.
- Target layer: memory
- Date: 2026-06-05
- Rollback note: Delete harness/memory/pipeline-runtime.md and remove index line in project-index.md.
- Applied change:

Added harness/memory/pipeline-runtime.md architecture note: live path is package.json `node-host` → lib/node-server.mjs → lib/pipeline-run.mjs (spawned by node_host.rs); pipeline SSE/model-split/OOM fixes must edit lib/ and pass tests/pipeline-model.test.mjs; scripts/pipeline-lib.mjs alone does not affect the running sidecar.
- Verification evidence: `node --experimental-strip-types --test tests/pipeline-model.test.mjs` — 19 passed; `grep -q 'node-host' harness/memory/pipeline-runtime.md`; project-index.md links pipeline-runtime.md.
- Scope: **SISpace project-local** — recall when editing pipeline, sidecar, or SSE behavior.
- Recall globs: `**/lib/pipeline-*.mjs`, `**/lib/node-server.mjs`, `**/scripts/pipeline-lib.mjs`, `**/node_host.rs`, `**/pipeline-model.test.mjs`

### PROP-20250603-008: Accepted proposal

- Source task: harness panel accept
- Reason: Manually accepted via harness panel (2026-06-04)
- Target layer: docs
- Date: 2026-06-04
- Rollback note: Revert the applied change per proposal text.
- Applied change:

Add a SISpace pipeline operator section to README.md (or SISPACE_PLAN.md) documenting the live Node runtime map (node_host.rs spawns lib/node-server.mjs → lib/pipeline-run.mjs, not scripts/), the slim SSE contract (step_content for DB only; metadata-only step_done to webview), the requirement that cargo build --release include default custom-protocol to avoid localhost:1420, and a restart checklist (full quit, npm run build, cargo build --release) after pipeline or UI fixes.

### PROP-20260604-001: Accepted proposal

- Source task: harness panel accept
- Reason: Manually accepted via harness panel (2026-06-04)
- Target layer: skill
- Date: 2026-06-04
- Rollback note: Revert the applied change per proposal text.
- Applied change:

Add a gtk-app / Rust-GTK workflow rule: before importing gtk4-rs or libadwaita prelude traits, grep the installed crate's prelude.rs and auto/*.rs under ~/.cargo/registry; use inherent widget methods when no extension trait exists; never use gtk::prelude::* when adw::prelude::* is in scope—import only required traits (BoxExt, ButtonExt, WidgetExt, etc.); enable version features in gtk-app/Cargo.toml (e.g. libadwaita v1_5 for AdwDialog) before using version-gated APIs.


### PENDING-20260605-GTK-CARGO-ALIAS: Accepted proposal

- Source task: post-task SDK chain
- Reason: Hard gates pass: documentation-only skill subsection; no secrets, hook/MCP/cost/runtime violations. Evidence 19/20: Phase 2 session 88c27d55 cites first-build unresolved-import failure from gtk4/libadwaita Cargo keys vs use gtk::/use adw:: imports; live gtk-app/Cargo.toml uses gtk = { package = "gtk4" } and adw = { package = "libadwaita" } and main.rs imports adw::/gtk::; cargo build -p sispace-gtk and verify-sispace-gtk4-phase2.mjs exit 0 per reflection. Generality 13/15: standard gtk4-rs Cargo alias pattern, not SISpace-specific logic. Layer fit 10/10: complements existing .cursor/skills/gtk-app/SKILL.md (PROP-20260604-001 prelude/feature guidance) without blending layers. Safety 15/15. Backtest 13/15: session compile-fix backtest passes; gap—no static verify asserts Cargo alias keys (unlike prelude conventions). Contradiction 9/10: no conflict with accepted gtk-app lesson; fresh proposalId; fills documented repeated friction. Cost 10/10; reversibility 5/5 with explicit rollback. Total 91; skills layer locked per harness.yaml—requires /harness-apply despite accept-band score.
- Target layer: skill
- Date: 2026-06-04
- Rollback note: Revert the added subsection in .cursor/skills/gtk-app/SKILL.md.
- Applied change:

Add a 'Cargo.toml dependency aliases' subsection to .cursor/skills/gtk-app/SKILL.md: dependency keys must be `gtk` and `adw` with `package = "gtk4"` / `package = "libadwaita"` to match `use gtk::` and `use adw::` imports; using bare gtk4/libadwaita keys causes first-build unresolved-import failures (observed in Phase 2 session).

### PROP-20260605-GTK-VERIFY: Accepted proposal

- Source task: post-task SDK chain
- Reason: Hard gates pass: no secrets, hook/MCP/runtime violations, or contradiction with accepted gtk-app prelude/Cargo-alias lessons. Evidence 18/20: session 88c27d55 documents verify:sispace-gtk4-phase5 exit 0 while cargo build -p sispace-gtk exit 101 (E0277 TabPage/*mut c_void and Rc<RefCell<...>> not Send in std::thread::spawn at gtk-app/src/main.rs:97); live re-check confirms the same compile failure and verify-sispace-gtk4-phase5.mjs is grep-only (no cargo step). Generality 13/15: GTK non-Send startup marshaling via mpsc + glib::idle_add_local_once is standard gtk4-rs guidance; per-phase cargo gate is SISpace-scoped but matches existing harness pattern ('static verify + npm/cargo build gates' in reasoning-patterns). Layer fit 7/10: proposal tags memory but also edits tests/verify-sispace-gtk4-phase*.mjs (backtests layer)—apply should split or explicitly cover both categories. Safety 15/15. Backtest 13/15: proposed cargo build gate would fail on current tree and close the verified gap; optional timeout-5 launch smoke is untested and may be flaky headless. Contradiction 9/10: complements PENDING-20260605-GTK-CARGO-ALIAS and PROP-20260604-001 without duplicating them. Cost 8/10: six compile gates add bounded but non-trivial verify time—justified by demonstrated false-green static verifies. Reversibility 5/5 with explicit rollback. Total 88 → accept with human review; memory auto-apply eligible per harness.yaml but dual-layer scope needs human apply review.
- Target layer: memory
- Date: 2026-06-05
- Rollback note: Remove the new ACCEPTED entry from harness/memory/accepted-lessons.md and delete any added cargo-build lines from tests/verify-sispace-gtk4-phase*.mjs.
- Applied change:

Add a GTK4 startup lesson and extend gtk4 phase verify scripts: (1) never capture gtk/adw widget handles in std::thread::spawn—init AppState on a background thread but marshal only Arc<AppState> back via mpsc + glib::idle_add_local_once on the main loop; (2) append `cargo build -p sispace-gtk` (and optionally `timeout 5 target/debug/sispace-gtk`) to every tests/verify-sispace-gtk4-phase*.mjs so static grep cannot pass while E0277 compile regressions land.

### PENDING-20260605-GTK-TILE-001: Accepted proposal

- Source task: post-task SDK chain
- Reason: Hard gates pass: no secrets, hook/MCP/cost/runtime violations, or conflict with user or project rules. Evidence quality 18/20: user GTK-CRITICAL/GTK_IS_WIDGET + SIGSEGV logs tied to GtkFixed remove/put; live gtk-app/src/ui/sispace/terminal_column.rs uses three Box columns with col.append/col.remove and .tiled-pane CSS; gtk-app/src/main.rs implements PrebuiltTabs + mpsc background init + idle attach; cargo build -p sispace-gtk exit 0 at grade time; 10–15s stability runs cited post-refactor. Generality 13/15: GtkFixed anti-pattern and Box-column VTE tiling generalize within GTK4 multi-pane work; startup bullets are appropriately scoped to sispace-gtk/libadwaita. Layer fit 8/10: memory is correct for GtkFixed/tiling and PrebuiltTabs startup deltas, but bundling gtk4-rs LabelExt/ListBoxExt duplicates skill-layer content (.cursor/skills/gtk-app/SKILL.md, PATTERN-20260604-223112). Safety 15/15: memory-only guidance. Backtest 12/15: structural fix and build corroborated in tree; user has not confirmed post-fix pane interactability and no verify script asserts GtkFixed avoidance. Contradiction check 7/10: bullets (2) and (3) substantially overlap PATTERN-20260605-034534/034651/033753 and gtk-app skill—not contradictory but redundant; stale SISPACE_V2_PLAN.md still documents GtkFixed, so the net-new tiling lesson helps resolve agent/plan drift. Cost control 10/10: single bounded memory entry. Reversibility 5/5: clear rollback note. Total 88: accept with human review—land the GtkFixed→Box-column lesson and PrebuiltTabs off-tree nuance; trim or cross-link duplicate prelude/startup bullets instead of repeating accepted patterns.
- Target layer: memory
- Date: 2026-06-05
- Rollback note: Delete PENDING/ACCEPTED memory entry and Obsidian mirror; revert to prior terminal_column.rs if GtkPaned grid refactor supersedes column Box approach.
- Applied change:

Add accepted-lesson for sispace-gtk: (1) Do not tile VTE panes with GtkFixed drag remove/put—use Box column layout with col.append/col.remove on close. (2) Prebuild AdwTabView tab widgets off-tree before first present(); deliver AppState from background thread via mpsc; attach tabs on glib idle. (3) gtk4-rs: LabelExt/ListBoxExt are not in prelude—use inherent gtk4 APIs.

### PROP-20260605-GTK-HARNESS-MAP: Accepted proposal

- Source task: post-task SDK chain
- Reason: Hard gates pass: no secrets, hook/MCP/cost/runtime violations, or contradiction with accepted GTK lessons (PROP-20260605-GTK-VERIFY, PENDING-20260605-GTK-TILE-001) or user rules. Evidence quality 19/20 — session 88c27d55 documents GDB gtk_widget_show recursion during TabView attach, harness-only bisect isolating ListBox row-selected → rebuild_right_pane reentrancy, and post-fix four 18s runs without overflow; live gtk-app/src/ui/harness/harness_panel.rs confirms SelectionMode::None at lines 191–192, idle-deferred rebuild_right_pane + Single enable at 301–307, and in_rebuild guard at 267/511–534; reflection-time cargo build -p sispace-gtk exit 0. Minor gap: user-display 15s+ GUI smoke and BridgeSpace panes remain unverified. Generality 13/15 — ListBox selection deferral + rebuild guard generalizes to any GTK4 sidebar panel attached to AdwTabView during first map, appropriately scoped to libadwaita harness/sidebar patterns. Layer fit 8/10 — memory is correct for the operational lesson; optional verify-sispace-gtk4-phase5.mjs grep for SelectionMode::None/in_rebuild is a backtests-layer delta (same dual-layer pattern as PROP-20260605-GTK-VERIFY). Safety 15/15: memory-only guidance preserves existing safeguards. Backtest 12/15: structural fix and compile corroborated in tree; proposed static asserts would pass on current harness_panel.rs; no automated CI reproduction of stack-overflow regression. Contradiction check 9/10: complements PATTERN-20260605 deferred-present/mpsc and reasoning-patterns 'harness startup idle select_row during map' failure note — net-new prescription (SelectionMode::None → idle rebuild → in_rebuild → enable Single) not yet in accepted-lessons; fresh proposalId with no collision. Cost control 10/10: one bounded memory bullet plus optional one-line grep. Reversibility 5/5: explicit rollback note. Total 90 → accept; memory auto-apply eligible per harness.yaml — apply optional phase5 assert under backtests category if included.
- Target layer: memory
- Date: 2026-06-05
- Rollback note: Remove the new ACCEPTED entry from harness/memory/accepted-lessons.md and any added static assert line from tests/verify-sispace-gtk4-phase5.mjs; harness_panel.rs behavioral guards can remain as code fixes independent of memory.
- Applied change:

Append accepted-lesson bullet for GTK4 harness/sidebar panels attached to AdwTabView: start ListBox with SelectionMode::None so row-selected does not fire during first map; defer initial rebuild_right_pane (or equivalent pane swap) to glib::idle_add_local_once; guard rebuild with an in_rebuild Cell; enable SelectionMode::Single only after the deferred first rebuild. Cross-link existing deferred-present + mpsc startup lessons. Optionally add a one-line assert to tests/verify-sispace-gtk4-phase5.mjs that harness_panel.rs contains SelectionMode::None and in_rebuild.

### PROPOSAL-20260606-GTK-LAZY-KEEPALIVE: Accepted proposal

- Source task: post-task SDK chain
- Reason: Hard gates pass: no secrets, hook/MCP/cost/runtime violations, or substantive conflict with accepted GTK lessons (PROP-20260605-GTK-VERIFY, PROP-20260605-GTK-HARNESS-MAP, PENDING-20260605-GTK-TILE-001) or user rules. Evidence quality 19/20 — session 88c27d55 documents SISpace/SICanvas lazy-select crash from storing only tab.widget().clone() without Rc<TabController>; live gtk-app/src/main.rs:133–253 confirms TabKeepalive enum, LazyTabSlot.keepalive, and the inline comment that GTK widgets alone do not keep Rust IPC/state alive; grade-time cargo build -p sispace-gtk exit 0; harness_panel.rs:308 wires refresh_snapshot on first idle. Minus points: reflection-time 15s DISPLAY launch and swarm E2E not re-confirmed; verify-sispace-gtk4-phase6.mjs still exit 1 (attach_panes_and_focus_last vs attach_siswarm_panes string drift, unrelated to TabKeepalive). Generality 13/15 — Rc controller retention for lazy-loaded AdwTabView pages generalizes to any gtk4-rs tab with IPC/CDP/background polls, appropriately scoped to gtk-app/. Layer fit 7/10 — targetLayer memory is correct for the TabKeepalive accepted-lesson; proposal also bundles backtests deltas (phase6/7 verify + cargo build) that belong partly to the backtests layer and partly duplicate PROP-20260605-GTK-VERIFY cargo-gate substance. Safety 15/15 — memory-only diagnostic guidance; prevents controller-drop regressions. Backtest 11/15 — proposed TabKeepalive grep in phase7 and cargo build in phase6/7 are sensible but not yet in tree; phase6 grep failure shows verify fragility independent of this lesson. Contradiction 7/10 — fresh proposalId with no ledger collision; TabKeepalive is net-new versus reasoning-patterns lazy-Stack entries and PENDING-20260605-GTK-MAP-001 (lazy-load without Rc retention); apply should cross-link/merge with GTK-MAP-001 rather than fragment GTK memory; optional cargo-build backtest overlaps accepted PROP-20260605-GTK-VERIFY. Cost control 10/10 — single scoped memory entry plus small optional verify asserts. Reversibility 5/5 — rollbackNote is explicit. Total 87 → accept with human review: land TabKeepalive lesson via /harness-apply; fold optional verify deltas with GTK-VERIFY cargo gate where already pending; fix phase6 attach_siswarm_panes string separately.
- Target layer: memory
- Date: 2026-06-05
- Rollback note: Delete ACCEPTED entry from harness/memory/accepted-lessons.md and Obsidian mirror; revert gtk-app/src/main.rs TabKeepalive/LazyTabSlot if lesson applied as code comment only.
- Applied change:

Add a scoped gtk-app/ accepted-lesson: when lazy-loading AdwTabView pages via Stack placeholders (selected_page_notify), storing only tab.widget().clone() drops the Rc<TabController> and tears down IPC bridges, background polls, and CDP state while GTK widgets remain mapped—crash on first tab select. Fix: TabKeepalive enum (Sispace/Siswarm/Canvas) held in LazyTabSlot.keepalive for the page lifetime. Cross-link existing deferred-present and harness refresh_snapshot-on-init lessons (PENDING-20260605-GTK-MAP-001). Optional backtests delta: assert TabKeepalive in tests/verify-sispace-gtk4-phase7.mjs and add cargo build -p sispace-gtk to phase6/7 verify scripts.

### PROP-20260605-GTK-VERIFY-COMPILE: Accepted proposal

- Source task: post-task SDK chain
- Reason: Hard gates pass: no secrets, hook/MCP/cost/runtime violations, or conflict with user rules or accepted GTK lessons. Evidence quality 19/20 — session 88c27d55 documents verify:sispace-gtk4-phase2–7 static scripts passing while cargo build -p sispace-gtk exits 101 (E0423 column macro, E0425 ipc_bridge in gtk-app/src/ui/siswarm/siswarm_tab.rs); live re-check confirms node tests/verify-sispace-gtk4-phase5.mjs exit 0 and cargo build exit 101; gtk-app/src/smoke.rs already implements SISPACE_GTK_SMOKE=1 tab-cycle smoke printing SISPACE_GTK_SMOKE_OK. Generality 13/15 — per-phase static-verify plus cargo build gate is a standard harness pattern (reasoning-patterns PATTERN-20260605-033753); scoped to sispace-gtk but not one-off. Layer fit 10/10 — backtests layer correctly targets tests/verify-sispace-gtk4-phase*.mjs only (fixes the layer split the accepted PROP-20260605-GTK-VERIFY grader requested). Safety 15/15 — adds compile/smoke gates only; no weakened safeguards. Backtest 12/15 — proposed cargo build step would fail on current tree and closes the demonstrated false-green gap; optional 25s SISPACE_GTK_SMOKE launch smoke is bounded but untested headless (DISPLAY-dependent, may flake in CI) and smoke.rs warns on empty harness snapshot without failing, so tab-select crashes and empty rollouts may still slip if smoke stays optional. Contradiction 7/10 — substance largely implements the unapplied backtest half of accepted PROP-20260605-GTK-VERIFY (memory lesson landed; verify-script cargo gates remain grep-only per live tree); net-new delta is explicit backtests-layer apply plus SISPACE_GTK_SMOKE wiring — not contradictory but overlapping backlog; human apply should treat as completion of GTK-VERIFY verify gates rather than duplicate memory. Cost control 8/10 — six per-script cargo builds add bounded but redundant verify time (shared helper would be cheaper); optional smoke adds up to ~25s per run. Reversibility 5/5 — rollbackNote is explicit. Total 88 → accept with human review; apply after or alongside fixing siswarm_tab compile errors (gates will stay red until build is green, which is intended).
- Target layer: backtest
- Date: 2026-06-05
- Rollback note: Remove execSync/spawnSync cargo build and smoke blocks from verify-sispace-gtk4-phase*.mjs; restore grep-only checks.
- Applied change:

Extend tests/verify-sispace-gtk4-phase2.mjs through phase7.mjs to exec `cargo build -p sispace-gtk` (fail fast on compile errors) and optionally `SISPACE_GTK_SMOKE=1 timeout 25 cargo run -p sispace-gtk` expecting SISPACE_GTK_SMOKE_OK, before existing static grep assertions. Prevents false-green phase verify when gtk-app does not compile or crashes on tab cycle — demonstrated at reflection time by verify scripts passing historically while cargo build -p sispace-gtk now exits 101 on siswarm_tab.rs.

### PENDING-20260605-GTK-REENTRANCY: Accepted proposal

- Source task: post-task SDK chain
- Reason: Hard gates pass: no secrets, hook/MCP/runtime violations, or conflict with user rules or accepted GTK lessons. Evidence quality 18/20 — session 88c27d55 documents GDB bisect, failed synchronous guard reset in selection callbacks, and async idle_add_local_once fixes; live gtk-app/src/main.rs:137–152 and :207–210, session_sidebar.rs:343–361, and canvas_tab.rs:360–393 corroborate async Rc<Cell<bool>> reset; grade-time `sh harness/scripts/verify-sispace-gtk-app.sh` exit 1 with stack overflow on smoke SISpace tab select (cargo build and static phases 2–5/sicanvas + hp_snapshot 3 passed). Generality 13/15 — async reentrancy-guard reset for ListBox/TabView selection handlers generalizes across gtk4-rs/libadwaita sidebar/tab UIs, scoped to gtk-app/. Layer fit 8/10 — memory is correct for the operational lesson; bundled guidance to withhold verify-sispace-gtk-app.sh as Ralph ground truth until smoke is green is appropriate operational memory, not a backtests apply. Safety 15/15 — diagnostic memory only. Backtest 11/15 — structural pattern is in tree for MainTabs and several sidebars but incomplete: harness_panel.rs:563 still resets in_rebuild synchronously and main.rs:224–229 resets syncing synchronously in select_by_title; smoke remains red headless. Contradiction check 7/10 — complements accepted PROP-20260605-GTK-HARNESS-MAP (in_rebuild + idle deferral without async-reset prescription) and PROPOSAL-20260606-GTK-LAZY-KEEPALIVE; net-new delta is orthogonal async-reset requirement; apply should amend/cross-link rather than add a parallel GTK memory fragment. Cost control 10/10 — one bounded memory amendment. Reversibility 5/5 — explicit rollbackNote. Total 86 → accept with human review: land async-guard lesson via /harness-apply; align harness_panel.rs and MainTabs::select_by_title with the prescription; fix smoke before promoting verify script as CI ground truth.
- Target layer: memory
- Date: 2026-06-05
- Rollback note: Delete PENDING-20260605-GTK-REENTRANCY and any Obsidian mirror; remove async-guard bullets from gtk-app memory if a future tab lifecycle design eliminates selection-time rebuilds.
- Applied change:

Amend gtk-app scoped memory (cross-link PROPOSAL-20260606-GTK-LAZY-KEEPALIVE): GTK4 ListBox/TabView handlers that mutate widgets or rebuild UI during selection callbacks must use Rc<Cell<bool>> reentrancy guards reset via glib::idle_add_local_once—not synchronous reset before callback returns; defer heavy-tab inner state assignment to idle/timeout as well. Do not promote verify-sispace-gtk-app.sh as Ralph ground truth until xvfb smoke is green at grade time.

### PENDING-20260605-GTK-SYNC-SCOPE: Accepted proposal

- Source task: post-task SDK chain
- Reason: Hard gates pass: no secrets, hook/MCP/cost/runtime violations, or substantive conflict with user rules or accepted GTK lessons (PENDING-20260605-GTK-REENTRANCY, PROPOSAL-20260606-GTK-LAZY-KEEPALIVE). Evidence quality 19/20 — session 88c27d55 documents the causal chain (is_syncing() early-return in install_deferred_tabs blocked first lazy mount because MainTabs::select_by_title sets syncing=true on every selection); live gtk-app/src/main.rs:224–232 sets syncing before set_selected_page and :360–366 gates only on per-slot built/building (no is_syncing gate); reflection-time sh harness/scripts/verify-sispace-gtk-app.sh exit 0 with SISPACE_GTK_SMOKE_OK tab cycle Harness/SISpace/SISwarm/SICanvas (rollouts=227, proposals=9). Minus points: no static verify-script assert explicitly forbidding is_syncing() in the lazy loader path. Generality 14/15 — guard-scope separation for bidirectional TabView↔strip syncing flags vs lazy Stack placeholder loaders generalizes across gtk4-rs/libadwaita tab shells combining both patterns. Layer fit 9/10 — targetLayer memory is correct; consolidation amendment cross-linking GTK-REENTRANCY and GTK-LAZY-KEEPALIVE matches harness apply convention and avoids a parallel GTK memory fragment. Safety 15/15 — diagnostic memory only; preserves structural overflow fixes while preventing perpetual Loading regressions. Backtest 13/15 — grade-time xvfb smoke tab-cycle encodes the failure mode; optional grep assert for is_syncing misuse in install_deferred_tabs not proposed. Contradiction 8/10 — fresh proposalId with no ledger collision; net-new delta orthogonal to GTK-REENTRANCY async-reset prescription and to PENDING-20260605-GTK-SYNC (revise/duplicate of bidirectional-sync substance); complements lazy-mount/TabKeepalive lessons without contradicting them. Cost control 10/10 — single bounded amendment bullet. Reversibility 5/5 — explicit rollbackNote. Total 89 → accept with human review: land via /harness-apply as amendment to existing gtk-app scoped memory, not a new parallel ACCEPTED entry.
- Target layer: memory
- Date: 2026-06-05
- Rollback note: Delete PENDING-20260605-GTK-SYNC-SCOPE and any Obsidian mirror; remove the is_syncing-scope bullet from gtk-app memory if a future design collapses sync and lazy-load into one handler with explicit scope separation.
- Applied change:

Amend gtk-app scoped memory (cross-link PENDING-20260605-GTK-REENTRANCY / PROPOSAL-20260606-GTK-LAZY-KEEPALIVE): TabView↔strip syncing flags (syncing/is_syncing) guard bidirectional UI sync only—never use them to gate unrelated deferred tab loaders. Lazy mount handlers should use per-slot building/built guards; blocking install_deferred_tabs on is_syncing() leaves every lazy tab on "Loading…" because selection itself sets syncing=true.

### PENDING-20260605-PIPE-RUNTIME-LIB: Accepted proposal

- Source task: post-task SDK chain
- Reason: Hard gates pass: no secrets exposure, no hook/MCP/cost/runtime violations, and no substantive conflict with user or project rules. Evidence quality 19/20: session 88c27d55 documents verified fix-then-regress after patching scripts/pipeline-lib.mjs while Tauri spawns lib/node-server.mjs → lib/pipeline-run.mjs (sispace-core/src/services/node_host.rs:142); slim-SSE fix on lib/ stopped webview OOM; reflection cites node --test tests/pipeline-model.test.mjs — 19 passed. Generality 11/15: spawn-path-first invariant is durable for SISpace sidecar debugging but repo-scoped (appropriate as scoped memory). Layer fit 10/10: targetLayer memory matches a single architecture note. Safety 15/15: memory-only guidance; strengthens verify-before-complete without weakening safeguards. Backtest 13/15: lib/pipeline-run wiring and runtime entry-point static suites already exist and pass in tests/pipeline-model.test.mjs — proposal re-proposes guards that are landed, not net-new backtests. Contradiction check 4/10: proposal substantially duplicates already-applied ACCEPTED-20250603-PIPELINE-RUNTIME (harness/memory/pipeline-runtime.md, applied 2026-06-05), PROP-20250603-009, PROP-20250603-008, and PROP-20260604-006; reflection did not dedupe against accepted-lessons before drafting. Cost control 10/10: bounded memory entry. Reversibility 5/5: explicit rollbackNote. Total 83 → accept with human review: human apply should skip re-adding memory/tests and instead close as duplicate or add a one-line cross-link to pipeline-runtime.md if ledger hygiene requires recording this session.
- Target layer: memory
- Date: 2026-06-05
- Rollback note: Delete the memory/accepted-lessons entry; revert any package-dist sync hook if added; keep existing lib/ tests if they pass independently.
- Applied change:

Add accepted-lesson or memory entry: SISpace pipeline sidecar is spawned from `lib/node-server.mjs` (see `src-tauri/src/services/node_host.rs`), which imports `lib/pipeline-run.mjs` — NOT `scripts/pipeline-lib.mjs`. Any pipeline SSE/model fix must patch lib/ (or sync scripts→lib in package-dist) and `tests/pipeline-model.test.mjs` must statically assert slim `step_content`/`step_done` wiring in `lib/pipeline-run.mjs` before calling the fix complete. Instruct agents to verify spawn path first when user reports fix-then-regress on pipelines.

### ACCEPTED-20260605-PIPE-RUNTIME: Tauri pipeline sidecar spawn path

- Source task: harness panel apply-all (session sispace-panel-apply-PENDING-20260605-PIPE-RUNTIME-1780670685114)
- Reason: Verified fix-then-regress when editing scripts/pipeline-lib.mjs while Tauri sidecar runs lib/node-server.mjs → lib/pipeline-run.mjs via sispace-core node_host.rs; trace spawn path before any pipeline SSE/emit fix.
- Target layer: memory
- Date: 2026-06-05
- Rollback note: Delete this ACCEPTED entry from harness/memory/accepted-lessons.md.
- Applied change:

## [2026-06-05] Task: Tauri pipeline sidecar runtime path

- ✅ DO: Before any pipeline SSE/emit/OOM fix, trace the live spawn path — `sispace-core/src/services/node_host.rs` `spawn_host` spawns `lib/node-server.mjs`, which imports `lib/pipeline-run.mjs` (`runPipelineStreaming`); also read `pipeline_client.rs` for Rust-side SSE delivery.
- ❌ AVOID: Patching only `scripts/pipeline-lib.mjs` — it is shared helpers, not the live sidecar entry; edits there do not affect the running pipeline and cause verified user regressions.
- 💡 WHY: Rust spawns the Node child directly from `node_host.rs`; SSE caps and emit behavior must land on the active `lib/` path before declaring a pipeline fix complete. Cross-link: [pipeline-runtime.md](pipeline-runtime.md).

- Verification evidence: `grep -q 'node-server.mjs' sispace-core/src/services/node_host.rs`; `grep -q 'pipeline-run.mjs' lib/node-server.mjs`; `grep -q 'ACCEPTED-20260605-PIPE-RUNTIME' harness/memory/accepted-lessons.md`; `node --experimental-strip-types --test tests/pipeline-model.test.mjs` — 19 passed.
- Scope: **SISpace project-local** — recall when editing pipeline, sidecar, SSE, or emit behavior.
- Recall globs: `**/lib/pipeline-run.mjs`, `**/lib/node-server.mjs`, `**/pipeline_client.rs`, `**/node_host.rs`

### ACCEPTED-20260605-SISPACE-RUNTIME-PATH: Tauri node sidecar runtime path and restart

- Source task: harness panel apply-all (session sispace-panel-apply-PENDING-20260605-SISPACE-RUNTIME-PATH-1780670729168)
- Reason: Tauri spawns a long-lived Node child via node_host.rs; pipeline fixes must target lib/ and require full quit to reload the sidecar — editing scripts/pipeline-lib.mjs alone caused verified fix-then-regress.
- Target layer: memory
- Date: 2026-06-05
- Rollback note: Delete this ACCEPTED entry from harness/memory/accepted-lessons.md.
- Applied change:

## [2026-06-05] Task: Tauri node sidecar runtime path and restart

- ✅ DO: Patch `lib/pipeline-run.mjs` (imported by `lib/node-server.mjs`, spawned by `sispace-core/src/services/node_host.rs` `spawn_host`) for any pipeline SSE/emit/OOM fix; run `node --experimental-strip-types --test tests/pipeline-model.test.mjs` against `lib/` wiring before declaring complete.
- ❌ AVOID: Editing only `scripts/pipeline-lib.mjs` — shared helpers, not the live sidecar entry; edits there do not affect the running child process.
- 💡 WHY: The Node child is spawned once at app start and keeps running until full SISpace quit; hot file edits on disk do not reload the in-memory sidecar — always full quit (not just window close) after Node pipeline changes. Cross-link: [pipeline-runtime.md](pipeline-runtime.md), ACCEPTED-20260605-PIPE-RUNTIME.

- Verification evidence: `grep -q 'node-server.mjs' sispace-core/src/services/node_host.rs`; `grep -q 'pipeline-run.mjs' lib/node-server.mjs`; `grep -q 'ACCEPTED-20260605-SISPACE-RUNTIME-PATH' harness/memory/accepted-lessons.md`; `node --experimental-strip-types --test tests/pipeline-model.test.mjs` — 19 passed.
- Scope: **SISpace project-local** — recall when editing pipeline sidecar, SSE, or regression tests.
- Recall globs: `**/lib/pipeline-run.mjs`, `**/lib/node-server.mjs`, `**/pipeline_client.rs`, `**/node_host.rs`, `**/tests/pipeline-model.test.mjs`

### ACCEPTED-20260605-GTK-MAP-001: GTK4 startup/tab-attach stack overflow reentrancy

- Source task: harness panel apply-all (session sispace-panel-apply-PENDING-20260605-GTK-MAP-001-1780670763500)
- Reason: GTK4 stack overflows during sispace-gtk startup/tab attach are main-loop reentrancy, not shallow thread stack depth — sync widget mutations during first map recurse through libgtk-4 signal handlers.
- Target layer: memory
- Date: 2026-06-05
- Rollback note: Delete this ACCEPTED entry from harness/memory/accepted-lessons.md.
- Applied change:

## [2026-06-05] Task: GTK4 startup/tab-attach stack overflow reentrancy (sispace-gtk)

- ✅ DO: Idle-defer shell install and AdwTabView tab attach (`glib::idle_add_local_once` / timeout chains, not synchronous `set_content` inside timeout handlers). Start sidebar ListBox with `SelectionMode::None`; defer initial `rebuild_right_pane` (or equivalent pane swap) to post-map idle; guard rebuilds with `in_rebuild` `Cell<bool>`; enable `SelectionMode::Single` only after the deferred first rebuild. Lazy-load VTE-heavy tabs on first TabView selection (not eager prebuild while peer tabs are mapped). Guard VTE `char_size_changed` ↔ resize loops. Always pair map-deferral fixes with an initial `refresh_snapshot()` (or `ensure_snapshot_loaded()`) so Harness rollouts/proposals panels are not left empty.
- ❌ AVOID: Synchronous `set_content` / pane rebuilds inside timeout or selection callbacks during first map; `ListBox` `SelectionMode::Single` before post-map idle rebuild; eager VTE tab prebuild on startup; map-deferral without an initial data refresh.
- 💡 WHY: GDB bisect shows thousands of identical libgtk-4 frames — signal reentrancy during TabView/Stack lazy mount, not Rust thread stack size. Cross-link: PROP-20260605-GTK-HARNESS-MAP (ListBox deferral + `in_rebuild`), PROPOSAL-20260606-GTK-LAZY-KEEPALIVE (lazy tab + `TabKeepalive`), PENDING-20260605-GTK-REENTRANCY (async guard reset), PROP-20260605-GTK-VERIFY (mpsc + idle startup marshaling).

- Verification evidence: `grep -q 'SelectionMode::None' gtk-app/src/ui/harness/harness_panel.rs`; `grep -q 'in_rebuild' gtk-app/src/ui/harness/harness_panel.rs`; `grep -q 'refresh_snapshot\|ensure_snapshot_loaded' gtk-app/src/ui/harness/harness_panel.rs`; `grep -q 'idle_add_local_once' gtk-app/src/main.rs`; `grep -q 'ACCEPTED-20260605-GTK-MAP-001' harness/memory/accepted-lessons.md`.
- Scope: **sispace-gtk project-local** — recall when editing GTK4 startup, tab attach, harness sidebar, or VTE pane layout.
- Recall globs: `**/gtk-app/**`, `**/harness_panel.rs`, `**/main.rs`, `**/terminal_column.rs`, `**/session_sidebar.rs`

### ACCEPTED-20260605-GTK-TAB-STABILITY: GTK4 sispace-gtk tab shell checklist

- Source task: harness panel apply-all (session sispace-panel-apply-PROP-20260605-GTK-TAB-STABILITY-1780670800736)
- Reason: Consolidated tab-shell stabilization checklist from session 88c27d55 — cross-links ACCEPTED-20260605-GTK-MAP-001, PROPOSAL-20260606-GTK-LAZY-KEEPALIVE, and PATTERN-20260605-113214 without duplicating parallel GTK memory fragments.
- Target layer: memory
- Date: 2026-06-05
- Rollback note: Delete this ACCEPTED entry from harness/memory/accepted-lessons.md.
- Applied change:

## [2026-06-05] Task: GTK4 sispace-gtk tab shell checklist

- ✅ DO: Retain `Rc<TabController>` in `TabKeepalive` (`LazyTabSlot.keepalive`) for every lazy-loaded tab — widgets alone do not keep IPC bridges, background polls, or CDP state alive.
- ✅ DO: Lazy visible mount for SISpace/SISwarm/SICanvas — Stack placeholders on `selected_page_notify`; build/finish_layout only when the tab is selected (never eager-prebuild all heavy tabs while TabView is mapped).
- ✅ DO: Call `refresh_snapshot()` (or `ensure_snapshot_loaded()`) on first Harness panel map idle — pair every map-deferral fix with an initial data load so rollouts/proposals are not left empty.
- ✅ DO: Defer ListBox selection — start Harness sidebar with `SelectionMode::None`; defer initial `rebuild_right_pane` to post-map idle; guard with `in_rebuild`; enable `SelectionMode::Single` only after the deferred first rebuild.
- ✅ DO: Prefer `MainTabs` custom ToggleButton strip over `AdwTabBar` when GDB shows `gtk_icon_theme_lookup` recursion during first window map.
- ✅ DO: After any tab-shell edit in `gtk-app/`, run `sh harness/scripts/verify-sispace-gtk-app.sh` before declaring complete.
- ❌ AVOID: Storing only `tab.widget().clone()` without `TabKeepalive` (controller drop → tab crash on select). Eager VTE/CDP tab prebuild during startup map. `AdwTabBar` during initial present when icon-theme recursion appears. Synchronous `select_row` / pane rebuild during first ListBox map without deferral guards.
- 💡 WHY: Session 88c27d55 bisect isolated stack overflow, empty Harness rollouts, and SISpace/SICanvas lazy-select crashes to these six invariants. Cross-link: ACCEPTED-20260605-GTK-MAP-001, PROPOSAL-20260606-GTK-LAZY-KEEPALIVE, PENDING-20260605-GTK-REENTRANCY, PATTERN-20260605-113214.

- Verification evidence: `grep -q 'ACCEPTED-20260605-GTK-TAB-STABILITY' harness/memory/accepted-lessons.md`; `grep -q 'TabKeepalive' harness/memory/accepted-lessons.md`; `grep -q 'verify-sispace-gtk-app.sh' harness/memory/accepted-lessons.md`; `grep -q 'MainTabs' harness/memory/accepted-lessons.md`.
- Scope: **sispace-gtk project-local** — recall when editing GTK4 tab shell, lazy mount, harness sidebar, or MainTabs strip.
- Recall globs: `**/gtk-app/**`, `**/main.rs`, `**/harness_panel.rs`, `**/sispace_tab.rs`, `**/siswarm_tab.rs`, `**/canvas_tab.rs`, `**/verify-sispace-gtk-app.sh`

### ACCEPTED-20260605-GTK-LAZY-TABS: GTK4 lazy tab finish_layout and smoke gate

- Source task: harness panel apply-all (session sispace-panel-apply-PENDING-20260605-GTK-LAZY-TABS-1780670833501)
- Reason: Heavy tab `finish_layout` during startup map causes GTK signal reentrancy stack overflows — defer until tab select via Stack placeholders + idle→timeout lazy mount; never gate layout on `is_visible()`; bisect with minimal `present()` shell before re-enabling tabs.
- Target layer: memory
- Date: 2026-06-05
- Rollback note: Delete this ACCEPTED entry from harness/memory/accepted-lessons.md.
- Applied change:

## [2026-06-05] Task: GTK4 lazy tab finish_layout and smoke gate (gtk-app)

- ✅ DO: Lazy-mount SISpace/SISwarm/SICanvas — Stack placeholders on `selected_page_notify`; chain `glib::idle_add_local_once` → `timeout_add_local_once` before `mount_lazy_tab_inner`; call `finish_layout` only when the tab is selected (per-slot `built`/`building` guards).
- ✅ DO: Bisect stack overflows with a minimal `present()`-only shell (no heavy tabs) before re-enabling lazy tab mounts — stub `finish_layout` per tab to isolate the offending pane.
- ✅ DO: Run `sh harness/scripts/verify-sispace-gtk-app.sh` (`SISPACE_GTK_SMOKE=1` headless tab cycle) as Ralph/CI ground truth after any `gtk-app/` tab-shell edit.
- ❌ AVOID: Gating `finish_layout` or lazy mount on `is_visible()` — selected-page notify fires before visibility settles and leaves tabs stuck on "Loading…". Eager-prebuilding all heavy tabs while TabView/window is mapped. Declaring tab-shell work complete from `cargo build -p sispace-gtk` alone without smoke.
- 💡 WHY: GDB bisect shows identical libgtk-4 frames from signal recursion during eager tab attach, not shallow Rust thread stack depth. Cross-link: ACCEPTED-20260605-GTK-MAP-001, ACCEPTED-20260605-GTK-TAB-STABILITY, PROPOSAL-20260606-GTK-LAZY-KEEPALIVE, PENDING-20260605-GTK-REENTRANCY.

- Verification evidence: `grep -q 'install_lazy_tabs' gtk-app/src/main.rs`; `grep -q 'timeout_add_local_once' gtk-app/src/main.rs`; `! grep -rq 'is_visible' gtk-app/src`; `grep -q 'SISPACE_GTK_SMOKE' gtk-app/src/smoke.rs`; `grep -q 'SISPACE_GTK_SMOKE=1' harness/scripts/verify-sispace-gtk-app.sh`; `grep -q 'ACCEPTED-20260605-GTK-LAZY-TABS' harness/memory/accepted-lessons.md` (all exit 0).
- Scope: **gtk-app project-local** — recall when editing lazy tab mount, `finish_layout`, stack-overflow bisect, or smoke verify workflows.
- Recall globs: `**/gtk-app/**`, `**/main.rs`, `**/sispace_tab.rs`, `**/siswarm_tab.rs`, `**/canvas_tab.rs`, `**/smoke.rs`, `**/verify-sispace-gtk-app.sh`

### ACCEPTED-20260605-PIPELINE-RUNTIME-PATH: Pipeline sidecar lib/ path and slim SSE contract

- Source task: harness panel apply-all (session sispace-panel-apply-PROP-20260605-PIPELINE-RUNTIME-PATH-1780670872524)
- Reason: Verified fix-then-regress when patching scripts/pipeline-lib.mjs while Tauri spawns lib/node-server.mjs → lib/pipeline-run.mjs; slim SSE (step_content for DB, metadata-only step_done, no steps on pipeline_done) must land on lib/ and be guarded by static tests.
- Target layer: memory
- Date: 2026-06-05
- Rollback note: Delete this ACCEPTED entry from harness/memory/accepted-lessons.md and Obsidian mirror; revert any added test assertions in tests/pipeline-model.test.mjs if they cause false failures.
- Applied change:

## [2026-06-05] Task: Pipeline sidecar lib/ path and slim SSE contract

- ✅ DO: Trace live spawn path before any pipeline fix — `sispace-core/src/services/node_host.rs` spawns `lib/node-server.mjs`, which imports `lib/pipeline-run.mjs` (`runPipelineStreaming`); patch `lib/pipeline-run.mjs` for SSE/emit/OOM behavior.
- ✅ DO: Keep slim SSE wiring on the active runtime — `step_content` carries truncated `result` for Rust DB storage; `step_done` is metadata-only (agent, index, status, backend — no `result`); `pipeline_done` carries status only (no `steps` blob).
- ✅ DO: Run `node --experimental-strip-types --test tests/pipeline-model.test.mjs` — the `lib/pipeline-run wiring (static — active sidecar path)` suite must pass after any pipeline SSE fix.
- ❌ AVOID: Patching only `scripts/pipeline-lib.mjs` — shared helpers, not the live sidecar entry; edits there do not affect the running pipeline and cause verified user regressions.
- 💡 WHY: Session 88c27d55 reproduced OOM after an apparent scripts/-only fix; landing truncation and step_content/step_done split on `lib/pipeline-run.mjs` stopped webview OOM. Cross-link: [pipeline-runtime.md](pipeline-runtime.md), ACCEPTED-20260605-PIPE-RUNTIME, ACCEPTED-20250603-PIPELINE-RUNTIME.

- Verification evidence: `grep -q 'node-server.mjs' sispace-core/src/services/node_host.rs`; `grep -q 'pipeline-run.mjs' lib/node-server.mjs`; `grep -q 'type: "step_content"' lib/pipeline-run.mjs`; `grep -q 'ACCEPTED-20260605-PIPELINE-RUNTIME-PATH' harness/memory/accepted-lessons.md`; `node --experimental-strip-types --test tests/pipeline-model.test.mjs` — 21 passed.
- Scope: **SISpace project-local** — recall when editing pipeline sidecar, SSE emit wiring, or pipeline regression tests.
- Recall globs: `**/lib/pipeline-run.mjs`, `**/lib/node-server.mjs`, `**/scripts/pipeline-lib.mjs`, `**/node_host.rs`, `**/pipeline-model.test.mjs`

### ACCEPTED-20260605-GTK-SYNC: GTK4 bidirectional selection sync guards

- Source task: harness panel apply-all (session sispace-panel-apply-PENDING-20260605-GTK-SYNC-1780670908765)
- Reason: GTK4 bidirectional selection sync (TabView, ListBox, VTE focus) requires centralized Rc<Cell<bool>> reentrancy guards with guard reset deferred via glib::idle_add_local_once — per-widget notify loops or synchronous guard clear inside callbacks recurse through libgtk signal handlers and cause stack overflow.
- Target layer: memory
- Date: 2026-06-05
- Rollback note: Delete this ACCEPTED entry from harness/memory/accepted-lessons.md and any Obsidian mirror; revert gtk-app guard patterns only if a simpler GTK API (e.g. AdwTabView blocking signals) supersedes them.
- Applied change:

## [2026-06-05] Task: GTK4 bidirectional selection sync (TabView, ListBox, VTE focus)

- ✅ DO: Centralize bidirectional TabView↔ToggleButton sync behind one shared `Rc<Cell<bool>>` guard (`MainTabs::syncing`) — set the guard before cross-widget updates; defer every `set_selected_page` / `set_active` via `glib::idle_add_local_once`; reset the guard in a nested `idle_add_local_once` after GTK finishes the current emission.
- ✅ DO: Apply the same centralized guard + idle-deferred reset to ListBox row-selected ↔ VTE focus paths (`SispaceUi::sync_guard` in `focus_pane`, `on_pane_spawned`, `on_pane_exited`; `session_sidebar.rs` `in_rebuild`; `terminal_column.rs` VTE resize guards).
- ✅ DO: Keep sync flags scoped to bidirectional UI sync only — never gate unrelated deferred tab loaders on `is_syncing()` (use per-slot `building`/`built` guards for lazy mount instead).
- ❌ AVOID: Per-widget notify loops where TabView, ToggleButton, and ListBox each install independent bidirectional handlers without a shared guard — causes recursive signal re-entry and libgtk stack overflow.
- ❌ AVOID: Synchronous `guard.set(false)` at the end of `selected_page_notify`, `connect_toggled`, or `row-selected` callbacks — peer handlers fire again before GTK internal state settles.
- 💡 WHY: Session 88c27d55 GDB bisect showed identical libgtk-4 frames from bidirectional notify recursion during tab select and ListBox↔VTE focus sync. Cross-link: PENDING-20260605-GTK-REENTRANCY (async guard reset), PENDING-20260605-GTK-SYNC-SCOPE (sync-flag scope), PROPOSAL-20260606-GTK-LAZY-KEEPALIVE, PATTERN-20260605-113214, PATTERN-20260605-121542.

- Verification evidence: `grep -q 'sync_guard' gtk-app/src/ui/sispace/sispace_ui.rs`; `grep -q 'idle_add_local_once' gtk-app/src/ui/sispace/sispace_ui.rs`; `grep -q 'syncing' gtk-app/src/main.rs`; `grep -q 'idle_add_local_once' gtk-app/src/main.rs`; `grep -q 'ACCEPTED-20260605-GTK-SYNC' harness/memory/accepted-lessons.md`.
- Scope: **gtk-app project-local** — recall when editing TabView strip sync, ListBox selection, VTE focus, or pane sidebar coordination.
- Recall globs: `**/gtk-app/**`, `**/main.rs`, `**/sispace_ui.rs`, `**/session_sidebar.rs`, `**/terminal_column.rs`, `**/canvas_tab.rs`

### ACCEPTED-20260605-GTK-SYNC-001: AdwTabView↔ToggleButton sync and pipeline runtime recall

- Source task: harness panel apply-all (session sispace-panel-apply-PENDING-20260605-GTK-SYNC-001-1780670947546)
- Reason: AdwTabView and ToggleButton bidirectional sync must never call `set_active` or `set_selected_page` synchronously inside `selected_page_notify` or `connect_toggled` handlers — shared `Rc<Cell<bool>>` guard plus `glib::idle_add_local_once` deferral prevents libgtk signal recursion; lazy Stack mounts that call `set_visible_child_name` need per-slot `building`/`built` guards and idle/timeout debounce; shared `Rc<RefCell>` state in the same emission path should use `try_borrow_mut` skips. Pipeline sidecar runtime is `lib/pipeline-run.mjs` (via `node_host.rs`), not `scripts/pipeline-lib.mjs` alone.
- Target layer: memory
- Date: 2026-06-05
- Rollback note: Delete ACCEPTED-20260605-GTK-SYNC-001 from harness/memory/accepted-lessons.md and any Obsidian mirror; remove gtk-app sync/debounce bullets if a future TabView API supersedes manual guard deferral.
- Applied change:

## [2026-06-05] Task: AdwTabView↔ToggleButton sync guards and pipeline runtime recall

- ✅ DO: Keep AdwTabView and ToggleButton strip in sync behind one shared `Rc<Cell<bool>>` guard (`MainTabs::syncing`) — early-return when the guard is set; defer every `set_active` and `set_selected_page` via `glib::idle_add_local_once`; reset the guard in a nested `idle_add_local_once` after GTK finishes the current emission.
- ✅ DO: On shared `Rc<RefCell<…>>` state touched from signal handlers (strip buttons, lazy tab slots, keepalives), prefer `try_borrow_mut` and skip the update when already borrowed — avoids panic/reentrancy during the same notify emission.
- ✅ DO: Debounce lazy tab mounts that call `set_visible_child_name` — use per-slot `building`/`built` guards plus idle/timeout chains (`idle_add_local_once` → `timeout_add_local_once`) so Stack placeholder→content swaps never run synchronously inside `selected_page_notify`.
- ❌ AVOID: Synchronous `set_active` or `set_selected_page` inside `connect_selected_page_notify` or `connect_toggled` callbacks — peer handlers recurse through libgtk and overflow the stack.
- ❌ AVOID: Patching only `scripts/pipeline-lib.mjs` for pipeline SSE/emit fixes — Tauri spawns `lib/node-server.mjs` → `lib/pipeline-run.mjs` via `sispace-core/src/services/node_host.rs`; `scripts/` helpers are not the live sidecar entry.
- 💡 WHY: Session 88c27d55 GDB bisect showed identical libgtk-4 frames from bidirectional TabView↔strip notify recursion and synchronous Stack `set_visible_child_name` during lazy mount; pipeline fix-then-regress traced to editing `scripts/` while the sidecar runs `lib/`. Cross-link: ACCEPTED-20260605-GTK-SYNC, PENDING-20260605-GTK-SYNC-SCOPE, PENDING-20260605-GTK-REENTRANCY, PROPOSAL-20260606-GTK-LAZY-KEEPALIVE, ACCEPTED-20260605-PIPE-RUNTIME, [pipeline-runtime.md](pipeline-runtime.md).

- Verification evidence: `grep -q 'syncing' gtk-app/src/main.rs`; `grep -q 'idle_add_local_once' gtk-app/src/main.rs`; `grep -q 'set_visible_child_name' gtk-app/src/main.rs`; `grep -q 'building' gtk-app/src/main.rs`; `grep -q 'pipeline-run.mjs' lib/node-server.mjs`; `grep -q 'node-server.mjs' sispace-core/src/services/node_host.rs`; `grep -q 'ACCEPTED-20260605-GTK-SYNC-001' harness/memory/accepted-lessons.md`.
- Scope: **gtk-app + SISpace project-local** — recall when editing TabView strip sync, lazy Stack tab mounts, or pipeline sidecar/SSE wiring.
- Recall globs: `**/gtk-app/**`, `**/main.rs`, `**/lib/pipeline-run.mjs`, `**/lib/node-server.mjs`, `**/node_host.rs`, `**/scripts/pipeline-lib.mjs`

### ACCEPTED-20260605-GTK-REENTRANCY-001: GTK4 Cell<bool> guard reset and IPC poll idempotency

- Source task: harness panel apply-all (session sispace-panel-apply-PENDING-20260605-GTK-REENTRANCY-001-1780670981855)
- Reason: GTK4 ListBox/TabView/VTE signal handlers that mutate widgets during selection or focus callbacks recurse through libgtk when `Rc<Cell<bool>>` guards are cleared synchronously before GTK finishes the current emission — defer every guard reset via `glib::idle_add_local_once`; `connect_clicked` handlers that touch `RefCell` state during `finish_layout` need `try_borrow`/`try_borrow_mut` skips; `GtkPaneEventBridge::start_loop` must be idempotent behind a `started` `Cell<bool>` to avoid duplicate IPC poll timeouts.
- Target layer: memory
- Date: 2026-06-05
- Rollback note: Delete ACCEPTED-20260605-GTK-REENTRANCY-001 from harness/memory/accepted-lessons.md and any Obsidian mirror; revert gtk-app guard patterns only if a simpler GTK API (e.g. AdwTabView blocking signals) supersedes them.
- Applied change:

## [2026-06-05] Task: GTK4 Cell<bool> guard reset and IPC poll idempotency (sispace-gtk)

- ✅ DO: Reset every `Rc<Cell<bool>>` reentrancy guard (`in_rebuild`, `sync_guard`, `syncing`, `in_sync`, `initializing`) via nested `glib::idle_add_local_once` — never `guard.set(false)` synchronously at the end of `row-selected`, `selected_page_notify`, `connect_toggled`, `char_size_changed`, or pane-rebuild callbacks that mutate ListBox/TabView/VTE widgets.
- ✅ DO: In `connect_clicked` handlers wired during `finish_layout` (presets/spawn/refresh buttons), prefer `try_borrow` / `try_borrow_mut` on shared `Rc<RefCell<…>>` state and skip the update when already borrowed — avoids RefCell panic/reentrancy during the same GTK emission.
- ✅ DO: Guard `GtkPaneEventBridge::start_loop` with a `started: Rc<Cell<bool>>` — early-return when `started.get()` is true before scheduling the `timeout_add_local` IPC poll loop; set `started` before registering the timeout so `attach`/`attach_siswarm` cannot spawn duplicate poll timers.
- ✅ DO: Apply async guard reset to VTE `char_size_changed` ↔ resize paths (`in_sync` guard + idle-deferred clear in `terminal_column.rs`) and Harness/session ListBox rebuild paths (`in_rebuild` + nested idle clear in `harness_panel.rs`, `session_sidebar.rs`, `canvas_tab.rs`).
- ❌ AVOID: Synchronous `guard.set(false)` at the end of any handler that clears/appends ListBox rows, swaps TabView pages, or resizes VTE panes — peer handlers fire again before GTK internal state settles and overflow the stack.
- ❌ AVOID: Calling `GtkPaneEventBridge::attach` from multiple tabs without `started` idempotency — duplicate `timeout_add_local` loops double-dispatch IPC events and can panic on `RefCell` borrow during layout init.
- ❌ AVOID: `borrow_mut()` inside `connect_clicked` during tab `finish_layout` when the same `RefCell` may already be borrowed from a parent signal handler — use `try_borrow_mut` and return early instead.
- 💡 WHY: Session 88c27d55 GDB bisect showed identical libgtk-4 frames from synchronous guard reset in selection callbacks and RefCell borrow panics in `connect_clicked` during `finish_layout`; `gtk_events.rs` duplicate poll timeouts compounded IPC dispatch during tab attach. Cross-link: PENDING-20260605-GTK-REENTRANCY (async guard reset amendment), ACCEPTED-20260605-GTK-SYNC, ACCEPTED-20260605-GTK-SYNC-001, ACCEPTED-20260605-GTK-MAP-001, PROPOSAL-20260606-GTK-LAZY-KEEPALIVE.

- Verification evidence: `grep -q 'started' gtk-app/src/gtk_events.rs`; `grep -q 'idle_add_local_once' gtk-app/src/ui/harness/harness_panel.rs`; `grep -q 'idle_add_local_once' gtk-app/src/ui/sispace/session_sidebar.rs`; `grep -q 'idle_add_local_once' gtk-app/src/ui/sispace/terminal_column.rs`; `grep -q 'idle_add_local_once' gtk-app/src/ui/canvas/canvas_tab.rs`; `grep -q 'idle_add_local_once' gtk-app/src/main.rs`; `grep -q 'ACCEPTED-20260605-GTK-REENTRANCY-001' harness/memory/accepted-lessons.md`.
- Scope: **gtk-app project-local** — recall when editing ListBox/TabView/VTE signal handlers, tab `finish_layout` button wiring, or IPC event bridge lifecycle.
- Recall globs: `**/gtk-app/**`, `**/gtk_events.rs`, `**/harness_panel.rs`, `**/session_sidebar.rs`, `**/terminal_column.rs`, `**/canvas_tab.rs`, `**/sispace_tab.rs`, `**/main.rs`

### ACCEPTED-20260605-GTK-OVERFLOW-ROOTCAUSE: GTK stack-overflow root-cause proof before removing deferrals

- Source task: harness panel apply-all (session sispace-panel-apply-PENDING-20260605-GTK-OVERFLOW-ROOTCAUSE-1780671023379)
- Reason: GDB bisect on session 88c27d55 showed identical libgtk-4 frames and stack overflow even with `stack_size` raised to 32–128MB — the failure is GTK signal reentrancy, not shallow Rust thread stack depth. Before removing idle/defer workarounds, prove root cause; if overflow persists with libgtk backtrace at high stack_size, retain deferred TabView/Stack mounting and async guard resets. Merge gate is `finish_layout` stub binary-search plus `SISPACE_GTK_SMOKE` tab cycle, not `cargo build` alone.
- Target layer: memory
- Date: 2026-06-05
- Rollback note: Delete ACCEPTED-20260605-GTK-OVERFLOW-ROOTCAUSE from harness/memory/accepted-lessons.md and any Obsidian mirror.
- Applied change:

## [2026-06-05] Task: GTK stack-overflow root-cause proof before removing deferrals (gtk-app)

- ✅ DO: Before removing any GTK idle/defer workaround attributed to "small Rust thread stack", prove root cause — reproduce with GDB backtrace and try `stack_size` at 32MB–128MB (`gtk-app/src/main.rs` `GTK_STACK_BYTES`); if overflow still shows identical libgtk frames, treat it as signal reentrancy, not stack depth.
- ✅ DO: When libgtk backtrace persists at high `stack_size`, keep deferred TabView/Stack mounting (`idle_add_local_once` → `timeout_add_local_once` lazy mount) and async `Rc<Cell<bool>>` guard resets — do not revert to synchronous `finish_layout`, `set_visible_child_name`, or `guard.set(false)` in selection callbacks.
- ✅ DO: Bisect offending tab/pane by stubbing `finish_layout` per tab (minimal `present()` shell first) before re-enabling heavy layout paths.
- ✅ DO: Gate tab-shell merges on `sh harness/scripts/verify-sispace-gtk-app.sh` (`SISPACE_GTK_SMOKE=1` headless tab cycle printing `SISPACE_GTK_SMOKE_OK`) — not `cargo build -p sispace-gtk` alone.
- ❌ AVOID: Removing idle/defer workarounds because `cargo build` passes or because raising `stack_size` "should be enough" — GDB libgtk recursion survives 32–128MB stacks.
- ❌ AVOID: Declaring GTK tab-shell work complete without smoke tab cycle (Harness → SISpace → SISwarm → SICanvas) — static verify and compile gates miss runtime stack overflow on tab select.
- ❌ AVOID: Conflating GTK overflow diagnosis with pipeline spawn-path mistakes — trace `lib/pipeline-run.mjs` via `node_host.rs` for pipeline fixes; GTK deferrals are a separate reentrancy class. Cross-link: [pipeline-runtime.md](pipeline-runtime.md).
- 💡 WHY: Session 88c27d55 GDB bisect showed identical libgtk-4 frames from signal recursion during tab attach and guard reset, not insufficient Rust thread stack; the same session reproduced pipeline fix-then-regress from editing `scripts/` while the sidecar runs `lib/`. Cross-link: ACCEPTED-20260605-GTK-LAZY-TABS, ACCEPTED-20260605-GTK-REENTRANCY-001, ACCEPTED-20260605-GTK-SYNC, ACCEPTED-20260605-PIPELINE-RUNTIME-PATH, [pipeline-runtime.md](pipeline-runtime.md).

- Verification evidence: `grep -q 'GTK_STACK_BYTES' gtk-app/src/main.rs`; `grep -q 'stack_size' gtk-app/src/main.rs`; `grep -q 'idle_add_local_once' gtk-app/src/main.rs`; `grep -q 'finish_layout' gtk-app/src/ui/siswarm/siswarm_tab.rs`; `grep -q 'finish_layout' gtk-app/src/ui/canvas/canvas_tab.rs`; `grep -q 'SISPACE_GTK_SMOKE' gtk-app/src/smoke.rs`; `grep -q 'SISPACE_GTK_SMOKE=1' harness/scripts/verify-sispace-gtk-app.sh`; `grep -q 'ACCEPTED-20260605-GTK-OVERFLOW-ROOTCAUSE' harness/memory/accepted-lessons.md` (all exit 0).
- Scope: **gtk-app project-local** — recall when diagnosing stack overflow, removing GTK deferrals, or gating tab-shell merges.
- Recall globs: `**/gtk-app/**`, `**/main.rs`, `**/sispace_tab.rs`, `**/siswarm_tab.rs`, `**/canvas_tab.rs`, `**/smoke.rs`, `**/verify-sispace-gtk-app.sh`

### ACCEPTED-20260605-GTK-TAB-IDLE: GTK4 tab stack-overflow diagnosis and staged idle deferral

- Source task: harness panel apply-all (session sispace-panel-apply-PENDING-20260605-GTK-TAB-IDLE-1780671068984)
- Reason: GDB bisect on session 88c27d55 showed identical libgtk-4 frames and stack overflow even at 128MB `stack_size` — diagnosis is signal reentrancy during tab attach, not shallow Rust thread stack. Fix pattern: stub `finish_layout` per tab to bisect; defer container child clear/append and ListBox populate via staged `glib::idle_add_local_once` after attach (not inside realize/selection handlers); guard ListBox rebuild with `SelectionMode::None` and deferred `Single`. Gate merges on `SISPACE_GTK_SMOKE` tab cycle.
- Target layer: memory
- Date: 2026-06-05
- Rollback note: Delete ACCEPTED-20260605-GTK-TAB-IDLE from harness/memory/accepted-lessons.md and remove PATTERN-20260605-GTK-TAB-IDLE from reasoning-patterns.md if present.
- Applied change:

## [2026-06-05] Task: GTK4 tab stack-overflow diagnosis and staged idle deferral (gtk-app)

- ✅ DO: Bisect stack overflows by stubbing `finish_layout` (or `finish_mount`) per tab — restore tabs one at a time from a minimal `present()` shell to isolate the offending pane (SISpace SessionSidebar, SICanvas tab list, etc.).
- ✅ DO: Treat identical GDB libgtk-4 frames + overflow at 128MB `stack_size` as **signal reentrancy**, not insufficient Rust thread stack — do not remove idle/defer workarounds without this proof. Cross-link: ACCEPTED-20260605-GTK-OVERFLOW-ROOTCAUSE.
- ✅ DO: Defer all container child clear/append and ListBox populate via **staged** `glib::idle_add_local_once` **after** tab/widget attach — never synchronously inside `finish_layout`, `realize`, or TabView `selected-page` handlers. Mirror `session_sidebar.rs` (nested idle after row inserts) and `harness_panel.rs` (idle after map before `rebuild_right_pane`).
- ✅ DO: Guard ListBox selection during rebuild — start `SelectionMode::None`, set `in_rebuild` `Cell<bool>`, skip `row-selected` while rebuilding, restore `SelectionMode::Single` on a deferred idle (not synchronously at end of populate). Apply to Harness section/entry lists, SessionSidebar, and SICanvas tab list.
- ✅ DO: Run `sh harness/scripts/verify-sispace-gtk-app.sh` (`SISPACE_GTK_SMOKE=1` headless tab cycle printing `SISPACE_GTK_SMOKE_OK`) after any `gtk-app/` tab-shell or ListBox rebuild edit — not `cargo build` alone.
- ❌ AVOID: Synchronous `list.remove_all()` / `append()` / `select_row()` during first map or inside `finish_layout` idle callbacks that are still nested in a GTK emission.
- ❌ AVOID: Restoring `SelectionMode::Single` synchronously at the end of ListBox populate — re-triggers `row-selected` during the same rebuild emission.
- ❌ AVOID: Diagnosing tab overflow as "need bigger stack" when GDB shows thousands of identical libgtk frames — raising `GTK_STACK_BYTES` is adjunct only, not a substitute for staged idle deferral.
- 💡 WHY: Session 88c27d55 per-tab stub bisect isolated SISpace SessionSidebar ListBox populate and container mount as crash loci; 128MB stack still overflowed with identical libgtk backtrace, confirming reentrancy. Cross-link: ACCEPTED-20260605-GTK-LAZY-TABS, ACCEPTED-20260605-GTK-REENTRANCY-001, ACCEPTED-20260605-GTK-SYNC, PATTERN-20260605-GTK-TAB-IDLE, PATTERN-20260605-154318.

- Verification evidence: `grep -q 'GTK_STACK_BYTES' gtk-app/src/main.rs`; `grep -q 'SelectionMode::None' gtk-app/src/ui/sispace/session_sidebar.rs`; `grep -q 'idle_add_local_once' gtk-app/src/ui/sispace/session_sidebar.rs`; `grep -q 'SelectionMode::None' gtk-app/src/ui/harness/harness_panel.rs`; `grep -q 'in_rebuild' gtk-app/src/ui/harness/harness_panel.rs`; `grep -q 'finish_layout' gtk-app/src/ui/siswarm/siswarm_tab.rs`; `grep -q 'SISPACE_GTK_SMOKE' gtk-app/src/smoke.rs`; `grep -q 'SISPACE_GTK_SMOKE=1' harness/scripts/verify-sispace-gtk-app.sh`; `grep -q 'ACCEPTED-20260605-GTK-TAB-IDLE' harness/memory/accepted-lessons.md` (all exit 0).
- Scope: **gtk-app project-local** — recall when diagnosing tab stack overflow, bisecting `finish_layout`, deferring container/ListBox mutations, or gating with SISPACE_GTK_SMOKE workflows.
- Recall globs: `**/gtk-app/**`, `**/session_sidebar.rs`, `**/harness_panel.rs`, `**/canvas_tab.rs`, `**/sispace_tab.rs`, `**/siswarm_tab.rs`, `**/smoke.rs`, `**/verify-sispace-gtk-app.sh`

### PROP-20260607-CTX-BAR-SCOPE: Accepted proposal

- Source task: post-task SDK chain
- Reason: Hard gates pass: docs-only change; no secrets, hook/MCP/cost/runtime violations; no conflict with accepted lessons (PROP-20260604-compaction-cutpoint-tests covers algorithm unit tests, not user-facing metric scope); fresh proposalId with no ledger collision. Evidence quality 18/20 — reflection traces verified code paths: cli/src/session/compaction.ts estimateSessionContextTokens counts session.lines plus compactionSummaryBlock and pending injection blocks (resumeContextBlock, agentsContextBlock, obsidianContextBlock, skillBundlePrompt) only; shouldAutoCompact uses the same estimator; cli/src/tui/PromptLine.tsx ctx bar and tok display call estimateSessionContextTokens against context_window − reserve_tokens; cli/src/tui/Orchestrator.tsx auto-compact gate calls shouldAutoCompact before sendSessionMessage while agent continuity uses cursorAgentId outside the local estimate. User correction (977 vs ~3.5k on tool-heavy RE) is the documented failure mode. Minus points: explanation-only session (filesChanged=[]); no automated assertion on proposed doc wording. Generality 14/15 — recurring CursorSI TUI support pattern (low ctx on tool-heavy work, cross-session comparison) beyond this chat. Layer fit 9/10 — targetLayer docs is correct; proposal leaves placement ambiguous (/help compaction vs AGENTS.md vs CURSORSI_CLI_PLAN.md) and AGENTS.md line 46 already mentions auto-trigger without scope. Safety 15/15 — clarifies behavior, reduces false bug reports, no safeguard weakening. Backtest 12/15 — npm run verify:cursorsi-compaction static wiring exists; no doc-content verify script proposed. Contradiction 10/10 — no duplicate pending/accepted user-facing ctx-scope note; PATTERN-20260604-224625 is implementer workflow, not end-user metric semantics. Cost control 10/10 — single short paragraph. Reversibility 5/5 — explicit rollbackNote. Total 89 → accept with human review: human apply should pick one canonical doc target and state explicitly that SDK agent history, tool calls, tool results, and cursorAgentId-resumed context are excluded from both the ctx bar and auto-compaction trigger.
- Target layer: docs
- Date: 2026-06-07
- Rollback note: Remove the added documentation paragraph from the target help or AGENTS.md section.
- Applied change:

Add a short user-facing note (e.g. /help compaction section or AGENTS.md CursorSI TUI section) stating the ctx bar and auto-compaction use estimateSessionContextTokens on local session.lines plus pending injection blocks only—they do not include SDK agent history, tool I/O, or cursorAgentId context—so low counts on tool-heavy sessions are expected and cross-session ctx comparison is not a workload gauge.

### ACCEPTED-20260607-GNU-006: OptiFine reflection findMethod name-only fallback for param type mismatch

- Source task: Post-hoc diagnostic from GNUClient reflection work (func_78768_b on PlayerControllerOF)
- Reason: `getDeclaredMethod(name, paramTypes)` requires EXACT parameter type match. OptiFine's `func_78768_b` uses different param types (e.g., `EntityPlayerSP` vs `EntityPlayer`), causing `NoSuchMethodException` even though the method exists. Fix: name-only fallback via `getDeclaredMethods()` at the same class level before moving to superclass. `Method.invoke()` handles subtype compatibility at call time.
- Target layer: memory
- Date: 2026-06-07
- Rollback note: Delete this entry and revert the findMethod fallback in McAccess.java; restore original try/catch with `NoSuchMethodException ignored`.
- Applied change:

## [2026-06-07] Task: OptiFine reflection findMethod name-only fallback (GNUClient)

- ✅ DO: When `getDeclaredMethod(name, paramTypes)` throws `NoSuchMethodException` during findMethod, fall back to name-only search via `getDeclaredMethods()` at that same class level before walking up the superclass chain. Use a distinct variable name (`m2`) in the fallback loop to avoid shadowing.
- ✅ DO: Use the same cache key for the name-matched method — `Method.invoke()` handles subtype compatibility at call time, so caching by the exact-param key (even though we found it by name) is correct.
- ❌ AVOID: Moving immediately to `c.getSuperclass()` when `getDeclaredMethod` fails — the method may exist on the same class with subtype params (e.g., OptiFine's `PlayerControllerOF.func_78768_b(EntityPlayerSP, ...)` vs vanilla `EntityPlayer`).
- ❌ AVOID: Using a different cache key for name-only matches — this would cache duplicates and slow subsequent lookups. The exact-param key is degenerate but valid: `Method.invoke` coerces args at call time.
- 💡 WHY: `getDeclaredMethod` is strict about parameter types (uses `==`, not `isAssignableFrom`); OptiFine overrides with covariant/subtype params. The name-only fallback at the same class level handles this without needing an `isAssignableFrom` scan on every call.

- Verification evidence: `grep -q 'Fallback: name-only match' /home/lev/linux\ minecraft\ thing/GNUClient/client/src/main/java/gnu/client/runtime/mc/McAccess.java` (exit 0); `grep -q 'ACCEPTED-20260607-GNU-006' harness/memory/accepted-lessons.md` (exit 0).
- Scope: **GNUClient project-local** — recall when working on reflection utilities, OptiFine compatibility, or findMethod in the injected jar.
- Recall globs: `**/GNUClient/**`, `**/McAccess.java`, `**/gnu/client/runtime/mc/**`

