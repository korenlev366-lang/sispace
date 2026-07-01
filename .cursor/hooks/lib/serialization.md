# Hook Serialization Notes

Phase 5 scripts read the full event JSON from stdin as text.

Output shapes:
- Allow: `{"permission":"allow"}`
- Warn and allow: `{"permission":"allow","user_message":"...","agent_message":"..."}`
- Deny: `{"permission":"deny","user_message":"...","agent_message":"..."}`
- Completion adapter: `{}`

Scripts must not echo raw hook input because it may contain secrets.
