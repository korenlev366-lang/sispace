## bootstrapCredential

- The CLI uses a `bootstrapCredential` mechanism in `bin/cursorsi.js` to provide initial model access.
- Phase 0b idle loop (`cli/src/harness/cursorsi.mjs`) must include Agent.create SDK loop and real slash router handlers for verification tests (`verify-cursorsi-phase0b.mjs`).
- Startup banner format: `ready — type a message or /help for slash commands (Phase 0b).` — this is a **Phase 0b** indicator, not a session from a previous version.
