# Additional domain test guidance

## Child scopes

| Child scope                     | Responsibility                          |
| ------------------------------- | --------------------------------------- |
| [`storage/`](storage/CLAUDE.md) | IDE/FDD block-device model and profiles |

These pure-domain suites follow `src/domain/CLAUDE.md`: inject external choices,
test declared persisted/transient state, cover capacity-plus-one, and
distinguish intentional rejection accounting from queue/media/mechanical
mutation.
