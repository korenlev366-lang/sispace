# Tool Event Fixtures

## Destructive Shell Command

Input command contains `git reset --hard`.

Expected decision: deny.

## Secret File Path

Input path contains `.env`.

Expected decision: deny.

## Risky But Allowed Command

Input command contains `pacman -S`.

Expected decision: allow with audit warning.

## Normal Read

Input path is `README.md`.

Expected decision: allow.

## Destructive Shell Command (args.command variant)

Input command is nested under `args.command`.

Expected decision: deny.

## Destructive Shell Command (args.cmd variant)

Input command is nested under `args.cmd`.

Expected decision: deny.

## Destructive Shell Command (top-level cmd variant)

Input command is under `cmd`.

Expected decision: deny.

## Risky But Allowed Command (args.command variant)

Input command contains `curl` under `args.command`.

Expected decision: allow with audit warning.
