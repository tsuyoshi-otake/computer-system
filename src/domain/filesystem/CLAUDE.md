# Filesystem domain guidance

## Model boundary

- `InMemoryFilesystem` is a persistence-capable inode/filesystem model, not an
  OS shell. Linux/DOS path dialect, aliases, virtual devices, boot layout,
  command discovery, credentials, and user-facing errors belong to
  `application/os`.
- Preserve contents, mode, UID, GID, mtime, symbolic links, inode identity,
  shared hard-link content, content-addressed blobs, byte/blob accounting, and
  deletion tombstones in backward-compatible snapshots.
- Schema 2 is current. `restore` accepts it; the separate
  `migrateLegacyInMemoryFilesystemSnapshot` helper converts supported legacy
  input under application migration ownership. Defaults are 40 MiB total
  capacity, 4,096 entries, 1 MiB per file, and 255 path characters.
  Symbolic-link resolution is capped at 16 rewrite attempts.
- Hard-link counts and inode lookup remain O(1); directory/listing operations
  may be O(N) in the returned entries but must not rescan the whole filesystem
  for each entry.

## Transactions and overlays

- Validate path, size, count, link, depth, and capacity limits before mutation.
  A failed write/link/rename/remove/metadata operation leaves revision and all
  indexes unchanged.
- A transaction rollback restores the exact pre-state: contents, inode/link
  graph, metadata, revision, byte/blob accounting, overlays, and tombstones. It
  also removes newly interned global blobs and newly registered base-image
  state.
- Transaction callbacks are synchronous. Reject declared async callbacks before
  invocation and use the shared quarantine for disguised Promises so
  post-`await` continuations cannot mutate after rollback.
- Support immutable shared base content with per-Computer copy-on-write
  overlays. Do not duplicate base bytes and do not let an overlay mutate the
  shared image.
- Selecting a base image is observable state and increments revision. Restore
  may carry historical symlink-capacity debt, but new mutations must not
  increase it.
- Symlink traversal, cycles, path depth, hard-link safety, and recursive work
  are bounded and terminate explicitly.

## Verification

Use `tests/domains/filesystem.test.ts` and OS credential/image suites. Cover
snapshot compatibility, hard links, symlinks/cycles, tombstones, shared-base
isolation, exact rollback after every mutation phase, async
rejection/quarantine, capacity-plus-one, and unchanged revision/indexes on
failure.
