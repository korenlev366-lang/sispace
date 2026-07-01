---
name: combat-parity
description: Cross-client combat and anticheat parity guidance for RainClient (native) and GNUClient (JVMTI Java). Use when tuning lag modules, packet order, or Grim/Vulcan flag triage.
---

# Combat parity

Reference order: **raven-bS** (`LagRange`, `UnifiedLagHandler`, `FakeLag`) — not OpenMyau lag modules. For GNUClient JVMTI packet hooks and network modules, see `gnuclient-dev`.

## Raven-only lag-module anticheat checklist

Source: session `6637b8ce` — Grim Simulation ×1–×7 and Vulcan Speed flag cycles on velocity-dummy profile after user mandated Raven-only lag references.

Before slider/delay tuning or adding AC throttles, run this audit:

1. **Grep audit for per-tick multi-packet drain paths** — search `releaseExpiredPackets`, `drainOutboundQueueIfIdle`, `flushQueueNow`, `flushLag`, and any loop that sends more than one queued packet per tick. Map each Grim Simulation/Timer or Vulcan Speed flag to a concrete burst or ordering symptom.
2. **C03-only queue vs mixed outbound tradeoffs** — compare Raven `LagRange`/`FakeLag` (C03 movement queued, attacks/interact drain before C02/C08) against experimental C03-only hold paths. Mixed-outbound FIFO with live C0A/C0B/C0F is the Raven baseline; C03-only isolation was a Grim experiment — verify live rubberband before adopting.
3. **Tick-capped release constants** — if using `max N per tick` release (e.g. 1–2 C03/tick), document the constant, tick phase (`onTickStart` vs send hook), and whether it breaks Raven all-expired batch drain. Revert if C0A/C02/C03 pairing degrades.
4. **Mandatory pre-C02 drain** — confirm attack/block paths drain or release queued movement **before** live C02/C08/C0A; never burst stale pre-knockback C03 after self S12. Cross-check `PacketHelper` exempt vs queued split.
5. **Self-S12 velocity abort** — on inbound self `EntityVelocity` (S12) or hurt knockback (S19), cancel or abort lag queue immediately (`cancelLagQueue` / `abortLagNow`); do not `flushQueueNow` stale ground C03 into live knockback motion.
6. **Staggered post-combat flush** — if post-combat flush uses multi-packet stagger (e.g. 2–3/tick), treat as experimental; compare against Raven `releaseExpiredPackets` batch semantics and user-visible rubberband before keeping.

Verification: `./gradlew shadowJar` after each lag-module change; re-inject `gnu-client.jar` before claiming live AC clearance.
