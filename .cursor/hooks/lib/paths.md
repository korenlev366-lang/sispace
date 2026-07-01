# Hook Path Policy

Secret-bearing path patterns denied by `pre-tool-use.sh`:

- `.env`
- `id_rsa`
- `id_ed25519`
- `credentials.json`
- `secrets.json`
- `secret.json`
- `private_key`
- `PRIVATE_KEY`
- `.pem`
- `.key`

These patterns are intentionally conservative for Phase 5 and should be refined with fixtures before broadening.
