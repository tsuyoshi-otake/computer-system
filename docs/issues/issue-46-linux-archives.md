# Issue #46: binary filesystem and bounded archives

Status: implemented and host-verified.

## Implemented boundary

- The guest filesystem stores arbitrary byte blobs with logical-byte quota,
  copy, transaction, and snapshot preservation while retaining compatibility
  with existing text blobs and schema-v2 snapshots.
- `tar` creates/lists/extracts ustar files; `gzip`/`gunzip` create and read
  deterministic RFC 1952 stored-DEFLATE streams; `zip`/`unzip` create and read
  standard UTF-8 unencrypted method-0 ZIP files.
- Extraction performs a complete bounded preflight and one filesystem
  transaction. It rejects malformed checksums, duplicate destinations, absolute
  or traversing names, symlink pivots, existing conflicts, encryption, ZIP64,
  and unsupported compression before publishing entries.
- Limits are 1 MiB archive input/output, 512 entries, 32 operands, path depth
  32, and 4 MiB expanded data. Dynamic/fixed DEFLATE and compressed ZIP methods
  are explicit exclusions in this release.

## Acceptance evidence

- Verify: `npm test -- tests/os/linuxArchives.test.ts` Expect: all-byte
  snapshot/copy preservation, gzip CRC rejection, tar metadata and traversal
  behavior, and zip/unzip round trips pass.
- Verify: `npm run validate` Expect: the complete repository validation gate
  passes.
