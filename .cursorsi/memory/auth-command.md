# /auth slash command

- Slash command `/auth` manages API keys and compatible endpoints (not `./auth` or `cursorsi auth`).
- Credentials stored in `~/.cursorsi/credentials.json` (mode 0600). Override path with `CURSORSI_CREDENTIALS_PATH`.
- Subcommands: `list`, `openrouter`, `cursor`, `compatible`.
- OpenRouter: key + optional model slugs (default endpoint `https://openrouter.ai/api/v1`).
- Cursor: API key only.
- Compatible: name, endpoint URL, key, model slugs, `--api openai|anthropic`.
- Flags supported for scripting: `--key`, `--endpoint`, `--models`, `--name`, `--api`.
- Interactive prompts use QuestionPicker (`askUser`) when flags are omitted.
- Runtime falls back to credentials file when env vars are unset (`tokenFromEnv` / `cursorTokenFromEnv`).
- `/backend compatible <name>` selects a stored compatible provider; `/auth compatible` also activates it.
- Compatible agents use OpenAI chat/completions or Anthropic Messages API against the stored base URL.
