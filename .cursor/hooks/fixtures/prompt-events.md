# Prompt Event Fixtures

## Secret-Like Prompt

Input contains `API_KEY`.

Expected decision: deny (Phase 9 promotion).

## Normal Prompt

Input asks for ordinary coding help.

Expected decision: allow.

## Real token pattern (github_pat)

Input contains `github_pat_` token prefix.

Expected decision: deny.

## Temporary AWS token pattern (ASIA)

Input contains `ASIA` temporary credential key pattern.

Expected decision: deny.

## Benign password mention

Input asks about password policy in plain text.

Expected decision: allow.

## Benign api naming mention

Input asks about api naming conventions without secrets.

Expected decision: allow.
