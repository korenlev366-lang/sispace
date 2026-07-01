# User Model

Living model of evidence-backed user preferences for this harness.

## Rules

- Update this file only through reflection proposals that pass the grading path.
- Do not capture raw prompts, secrets, credentials, private keys, or private project data.
- Prefer stable preferences demonstrated by repeated user corrections or explicit instructions.
- Keep project-specific preferences in project memory unless the user explicitly promotes them.
- Every entry needs source task, reason, target layer, date, confidence, and rollback note.

## Entry Template

```markdown
<!-- template: USER-PREF-YYYYMMDD-001 -->

- Source task:
- Reason:
- Target layer: user model
- Date:
- Confidence: low | medium | high
- Preference:
- Evidence:
- Rollback note:
```

## Current Preferences

### USER-PREF-20260603-001: GNUClient build then fresh re-inject

- Source task: GNUClient anticheat/lag module work and June 2026 retro batch (`6637b8ce-82dd-4757-8bef-cb328c31b855`, `65239e03-d238-49e2-aced-c19a683e1fbe`, `080038ff-8ea3-46ff-92db-a3b0ad006d04`, `2b1dc119-2d70-4d39-89f0-63d880cebf61`, `ROLLOUT-20260602-WF-LAGRANGE-HIT-INVALID-005`)
- Reason: Repeated verification pattern across sessions is `./gradlew shadowJar` → copy `gnu-client.jar` to `GNUClient/install/lib/` → user re-injects after MC quit; rollout notes explicitly say live AC confirmation requires re-injection, not hot-reload. Project rules mirror RainClient “one inject per JVM session.”
- Target layer: user model
- Date: 2026-06-03
- Confidence: high
- Preference: After any GNUClient JAR or native-agent change, always run `cd GNUClient/client && ./gradlew shadowJar`, stage the jar to `GNUClient/install/lib/gnu-client.jar`, then re-inject into a **fresh** Minecraft process. Never assume hot-reload, in-process class redefine, or that a running JVM will pick up bytecode changes without restart and re-inject.
- Evidence: Rollout log entries for `6637b8ce` and lag-module workflows document shadowJar + install on every iteration; `project-skills-and-references.mdc` / `rainclient-dev` skill state one inject per JVM session; user-facing kick/debug loops depend on full reinject cycle.
- Rollback note: Remove this entry if the project adopts true hot-reload or a documented no-restart dev loop.

### USER-PREF-20260603-002: Reference clients Raven and OpenMyau only

- Source task: Combat parity and module implementation arc (`6637b8ce-82dd-4757-8bef-cb328c31b855`, `65239e03-d238-49e2-aced-c19a683e1fbe`, `21f8bb48-3ad8-4724-8872-b16da78a45ab`, `ROLLOUT-20260602-WF-LAG-MODULES-001`, `ROLLOUT-20260602-WF-VULCAN-BADPACKETS-001`)
- Reason: Always-applied project rule and every combat/lag parity pass cite OpenMyau-Plus and raven-bS; Phantom is explicitly forbidden as outdated (~4 years).
- Target layer: user model
- Date: 2026-06-03
- Confidence: high
- Preference: For combat, movement, and lag module parity, use **OpenMyau-Plus** (`OpenMyau-Plus/`) first and **raven-bS** (`raven-bS/`) second. Do **not** use **Phantom** as a reference or pattern source.
- Evidence: `.cursor/rules/project-skills-and-references.mdc` (“Do not use Phantom”); `.agents/skills/combat-parity/SKILL.md` and `rainclient-dev/SKILL.md` reference order; workflow rollouts for Lagrange/Blink/KnockbackDelay explicitly compared raven-bS `LagRange` / `UnifiedLagHandler`, not Phantom.
- Rollback note: Remove or amend if Phantom is refreshed and the user explicitly re-enables it.

### USER-PREF-20260603-003: Obsidian vault before significant implementation

- Source task: Architecture and anticheat design passes (`6637b8ce-82dd-4757-8bef-cb328c31b855`, `65239e03-d238-49e2-aced-c19a683e1fbe`, harness curation 2026-06-03)
- Reason: User rules and always-applied `obsidian-vault-documentation.mdc` require decision notes and Architecture/TODOs updates in the same pass as non-trivial design changes; multiple `gnu client/Decision - *.md` files were created during the GNUClient lag/AimAssist arc.
- Target layer: user model
- Date: 2026-06-03
- Confidence: high
- Preference: Before implementing **significant** behavioral or architectural changes (new hooks, packet policy, module lifecycle, replacing an approach), create or update Obsidian notes under **`gnu client/`** — at minimum a `Decision - <title>.md`, links from [[Architecture]], and [[TODOs]] when applicable. Do this in the **same pass** as the code change unless the user explicitly requests code-only work. Skip vault updates for trivial fixes (typos, log strings, single-line null checks).
- Evidence: `.cursor/rules/obsidian-vault-documentation.mdc` (required logging section); user rule “always add obsidian notes to any change in the client”; decision notes e.g. `Decision - Lagrange C03-only queue.md`, `Decision - KnockbackDelay S12 pass-through.md`, `Decision - post-task setsid detach` from the June 2026 session batch.
- Rollback note: Remove if the user moves documentation to another system or waives vault requirements for this repo.

### USER-PREF-20260606-004: No greeting/acknowledgement noise on context

- Source task: Repeated double-response bug — user pastes context (harness lessons, images) and I respond with a greeting/apology first, then a second message with actual work
- Reason: User directly instructed "fix you sending double responses" and "fix this bug as it happens to me often" with two screenshots documenting the pattern. Explicit instruction overrides the normal reflection-only update rule.
- Target layer: user model
- Date: 2026-06-06
- Confidence: high
- Preference: When the user provides context, instructions, or materials (harness lessons, images, code, logs), respond **once** with the direct substantive output. Do **not** send a greeting, acknowledgement, "hey!", "ready when you are", apology, or any other prelude before the actual work. One message only. Zero noise. If the user's intent is immediately clear from their input, just do it and reply with the result.
- Evidence: User sent "fix you sending double responses" followed by "i mean fix this bug as it happens to me often also fix this bug" with two base64 image attachments documenting the issue. User explicitly says it happens often, confirming a repeated pattern.
- Rollback note: Remove if the user explicitly asks for greeting/acknowledgement messages in the future.

### USER-PREF-20260616-005: Lagrange frozen — do not modify unless explicitly asked

- Source task: Direct user instruction after extensive Lagrange bugfix arc (June 2026) — user explicitly told to create a rule that prevents accidental modification of Lagrange logic
- Reason: The current Lagrange implementation (LagrangeModule.java + LagrangeOutboundTrack.java) has been refined through ~12 decision cycles over 3 weeks. Every failure mode (C03 burst on flush, idle double-send, C0F exemption mismatch, attack drain timing, BiTrack request model integration, timer/Simulation/Reach/PacketOrder flags) has been diagnosed and fixed. The current state is proven clean on Grim/Vulcan at user profile (309ms, 6.11 range). Any unintended change risks reintroducing one of the many fixed regressions.
- Target layer: user model
- Date: 2026-06-16
- Confidence: high
- Preference: Do **not** modify `LagrangeModule.java`, `LagrangeOutboundTrack.java`, or `isLagrangeSendExempt` in `PacketHelper.java` unless the user explicitly says "bypass the Lagrange freeze rule" or something equivalent. Treat the current implementation as the final proven state. If a task involves any of these files and does not explicitly mention Lagrange changes, do not touch them. If I accidentally modify these files, use the recovery guide at `Harness/autoblock-lagrange-restore.md` to revert to the exact known-good state.
- Evidence: Direct user instruction ("create rule that makes it so that you will know the current lagrange implementation is perfect and that you will not change lagrange unless i specifically ask you to bypass the rule"). Backed by 12 decision notes spanning 2026-06-01 through 2026-06-15 documenting every failure mode resolved.
- Rollback note: Remove if the user explicitly unfreezes Lagrange for intentional modifications. The "bypass" escape hatch is: user says "bypass the Lagrange freeze rule" or equivalent explicit instruction.
