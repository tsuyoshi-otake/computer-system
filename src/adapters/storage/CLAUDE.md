# Dynamic Property storage guidance

## Source of truth

- World Dynamic Properties, physically stored in the world LevelDB, are the
  Bedrock persistence source of truth. SQLite is only a possible future host
  adapter behind the repository boundary.
- Never inspect, copy, or mutate a live world LevelDB for deployment or testing.
  Stop BDS and back up the complete world first.

## Paged generations

- Retain only the current and previous complete generations. Address pages by
  content, reuse unchanged page properties, and validate checksums and manifests
  before exposing a generation.
- Read the current head first, then its previous-generation fallback. If
  fallback recovery succeeds, repair it into a verified canonical current head
  before reporting completion.
- A valid canonical head survives corrupt previous-generation metadata. Repair
  or remove only the invalid fallback metadata; never discard the valid head.
- Use component revision tokens for clean checks. Do not compute whole-snapshot
  JSON fingerprints on normal saves.
- Preflight writer page count, manifest size, property size, and reader limits
  before the first mutation. A generation that readers or Dynamic Properties
  cannot represent must fail with no partial write.
- Normal periodic saves must not enumerate an entire storage prefix. Recovery
  may incrementally and boundedly sweep target-only blobs, legacy indexed pages,
  or stray manifests that no longer have valid metadata ownership.

## Startup migration

- The startup migration state machine performs at most one Dynamic Property
  read, write, or delete per host tick. Every branch terminates explicitly as
  complete or failed and restart is idempotent.
- Recognize only supported schema-1 indexed manifests and schema-1
  Computer/filesystem payloads. Reject unsupported identity payload schemas
  rather than guessing.
- Validate the current generation before fallback. Migrate and verify every
  referenced Computer even when identity storage is already current.
- Commit each current-format Computer first and activate the identity registry
  last. A registry must never point at an unverified Computer generation.
- A valid schema-2 identity registry may be re-encoded from the legacy paged
  store, but existing `computer-N` identities are never renumbered.
- Log observable transitions as `CS_STORAGE_MIGRATION` and gate Computer/Web
  startup until one terminal result is published.

## Transactions and failure ownership

- Preserve exact identity, manifest, page, content-blob, current/previous-head,
  and revision state across injected failures and rollback.
- Write data before references and activate heads last. Delete old reachability
  only after the new generation has been read back and verified.
- A retry may resume or safely rescan, but it must not reinterpret partial
  target data as active state or leak unbounded cleanup work into one tick.
- Keep repository errors explicit and typed enough for the application migration
  owner to decide retry, recovery, or terminal failure. Do not silently fall
  back to an empty world.

## Verification

Use `tests/phase0/transactionalPagedStore.test.ts`,
`tests/computer/persistence.test.ts`, `tests/computer/storageMigration.test.ts`,
and `tests/computer/snapshotMigration.test.ts`. Cover current head, valid
fallback, fallback repair, corrupt previous metadata, legacy migration,
already-current payload migration, restart at every state, capacity-plus-one,
partial write/delete, checksum failure, bounded cleanup, and identity-last
activation.
