# Constraints

Last reviewed: 2026-11-07

## Floor (always enforced)
- No new suppression comments (`@ts-ignore`, `@ts-expect-error` without reason, `eslint-disable`, `biome-ignore`).
- No stubs or silent failures (`throw new Error("Not implemented")`, empty `catch {}`).
- No skipped or deleted tests without a reason in the commit message.
- No secrets in source.
- This file is not weakened to make a change pass; tightening is fine.
- Indexed upstream documentation stays verbatim (see AGENTS.md).

## Enforced with numbers
| Dimension | Rule | Checked by | Runs at |
|---|---|---|---|
| Types / build | zero errors | `npm run build` | every change |
| Tests | all green (4 today) | `npm test` | every change |

## Measured ratchets
| Metric | Today | Direction | Command |
|---|---|---|---|
| Suppressions | 0 | stays 0 | `git grep -nE "@ts-ignore|@ts-expect-error|eslint-disable|biome-ignore|# noqa|# type: ignore|phpcs:ignore" -- ':!node_modules' ':!vendor' ':!dist' ':!build' ':!package-lock.json' | wc -l` |
| Skipped tests | 0 | stays 0 | `git grep -nE "\.skip\(\|skip:" -- test \| wc -l` |
| Built output | 132 kB | must not grow | `du -sk dist` |

## Exceptions
| ID | Rule | Path | Reason | Expires |
|---|---|---|---|---|
