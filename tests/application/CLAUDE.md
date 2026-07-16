# Direct application test guidance

## Child scopes

| Child scope                     | Responsibility                             |
| ------------------------------- | ------------------------------------------ |
| [`runtime/`](runtime/CLAUDE.md) | Block-I/O scheduler admission and delivery |

Tests here directly mirror application units that do not belong to a larger
feature-oriented suite. Apply the matching `src/application/` and domain
guidance; keep policy integration in its owning `tests/computer`, `tests/os`,
`tests/runtime`, or `tests/terminal` suite.
