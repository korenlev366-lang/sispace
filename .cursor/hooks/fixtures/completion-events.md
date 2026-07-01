# Completion event fixtures

## Short session (below threshold)

Input: `{"event":"stop","output_tokens":50}`

Expected decision: `agent_message` with lightweight nudge only; no SDK chain spawn side effects beyond nudge.

## Long session (at or above threshold)

Input: `{"event":"stop","session_id":"example","output_tokens":1500}`

Expected decision: `{}` (empty JSON). Background `post-task-chain.js` writes rollout/reflection/grade ledgers and Obsidian mirror.
