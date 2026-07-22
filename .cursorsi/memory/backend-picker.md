# /backend picker UI

- Bare `/backend` opens an interactive BackendPicker (bottom slot, same as /auth /model).
- Choices: OpenRouter · Cursor · Compatible (then pick a saved provider).
- CLI args still work: `/backend openrouter | cursor | compatible <name>`.
- Transcript is hidden while the picker is open; Esc closes (or backs from Compatible).
- Apply path is shared via `applyBackendSelection` in slash.ts.
