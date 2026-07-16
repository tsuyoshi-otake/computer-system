# Domain test guidance

- Test pure deterministic models without Minecraft, Node processes, host clocks,
  application policy, or external persistence. Inject time, IDs, and I/O.
- Every mutable-domain suite covers validation-before-mutation, exact boundary
  and capacity-plus-one, and unchanged state/revision after rejection. Snapshot
  suites prove the model's declared persisted fields, intentional transient
  exclusions, and independent restored instances.
- Filesystem tests prove inode/hard-link/symlink/tombstone identity, shared-base
  copy-on-write isolation, exact transaction rollback, async rejection, and
  quarantine escape prevention.
- Display tests prove profile/mode/VRAM bounds, dirty-ring order/capacity, and
  explicit power-off release. Terminal tests prove fixed-cell/cursor/attribute
  snapshot inclusions plus revision/current-color exclusions. Redstone tests
  prove all six sides, power bounds, persisted output mask, and transient
  inputs.
- The sibling `tests/domain/storage/` and `tests/language/` scopes have their
  own nearest guidance plus the matching `src/domain/*/CLAUDE.md`; do not
  duplicate their specialized contracts here.

## Focused verification

Run `npm test -- tests/domains tests/domain/storage tests/language`.
