# Issue #31: Structural guest resource accounting

Tracking: <https://github.com/tsuyoshi-otake/computer-system/issues/31>

Status on 2026-07-18: implemented and host-verified. The generated manual was
verified in Chrome; real Portable CS-DOS Web Terminal observation remains
pending.

## Ownership and compatibility boundary

Each resource has one owner. `InMemoryFilesystem` owns persistent capacity,
`ComputerHost` owns modeled HDD request time, and the transient `GuestRamLedger`
owns host-implemented guest residency. The RAM ledger is rebuilt at boot and is
never serialized. Opaque leases are acquired before retained state is admitted
and released by the single finalization owner.

Portable CS-DOS uses a 20 MiB FAT16-like capacity profile with 2,048-byte
allocation units, a 59,392-byte metadata/tail reserve, 512 root entries, and
32-byte directory entries. `DIR` reports logical bytes while quota/free-space
accounting charges allocated clusters. The supplied reference image is not
redistributed or mounted by production code.

Minimal CS-DOS reserves 64 KiB, leaving 576 KiB of its 640 KiB conventional
region. EDIT, CS QBASIC, and WorkBench initially use coarse 256 KiB leases; `vi`
uses 192 KiB; compiler, linker, and Program List jobs use 128 KiB. These are
guest-accounting values, not host-heap measurements. The shared CS process keeps
its existing static-data, stack, and aggregate-runtime checks but receives only
the ledger remainder. Programs that formerly fit immediately below 2 MiB may now
be rejected explicitly.

## Supplied reference evidence

The read-only 49,090,560-byte reference image contains an MBR-partitioned FAT16
volume with 512-byte sectors, four sectors (2,048 bytes) per cluster, one
reserved sector, two 94-sector FATs, and 512 root entries. Its visible DOS tree
includes `QBASIC.EXE` at 194,309 logical bytes (194,560 allocated), `QBASIC.HLP`
at 130,881 bytes, `EDIT.COM` at 413 bytes, `EDIT.HLP` at 17,898 bytes,
`COMMAND.COM` at 54,645 bytes, and `HIMEM.SYS` at 29,136 bytes.

The supplied minimal `MEM` screen shows conventional 640 KiB total, 64 KiB used,
576 KiB free, and no upper, reserved, or XMS allocation. It reports the largest
executable as 576 KiB (590,000 displayed bytes). UMB/XMS values are
configuration dependent and are not hard-coded from that one capture.

## Acceptance evidence

1. HDD byte preservation

   Verify: `npm test -- tests/computer/computerHostPersistence.test.ts`

   Expect: a 196,608-byte QBASIC executable submits three sequential 128-sector
   requests, never has more than one in flight, and publishes one final event.

2. RAM reconciliation and lifecycle

   Verify:
   `npm test -- tests/domains/guestRamLedger.test.ts tests/computer/guestResourceAccounting.test.ts`

   Expect: owner totals equal ledger use; OOM changes nothing; minimal DOS
   reports 640/64/576 KiB; editors and compilers return to the exact baseline on
   terminal close, disconnect, failure, and completion.

3. FAT16-like capacity and atomic full-disk behavior

   Verify:
   `npm test -- tests/domains/filesystem.test.ts tests/os/osStorageImage.test.ts`

   Expect: non-empty files round to 2,048-byte units, subdirectories charge
   cluster growth, metadata/root limits apply, and rejected writes preserve the
   prior snapshot and revision.

4. Complete host gate

   Verify: `npm run validate`

   Expect: formatting, ESLint, TypeScript, all Vitest tests, production pack
   build, and the 16-chapter Pages build pass.

5. Real Portable observation

   Verify: On a writer-owned Portable CS-DOS Web Terminal, run `MEM`; then
   record `CHKDSK`, write and delete a one-byte root file, and compare each
   `CHKDSK`.

   Expect: `MEM` visibly shows 640/64/576 KiB conventional memory; the one-byte
   file consumes then returns one 2,048-byte allocation unit.

## 2026-07-18 verification record

- `npm run validate`: passed; 152 test files and 1,015 tests passed, followed by
  the production Bedrock pack build and 16-chapter Pages build.
- The focused HDD/FAT/RAM/editor/compiler/Program List run passed 13 files and
  165 tests. The native-factory/RAM follow-up passed 3 files and 21 tests.
- The final ComputerHost persistence suite passed 11 tests, including power-off
  during the second chunk with one cancellation and no third submission.
- Chrome loaded the generated chapter 01 manual from a loopback-only server. The
  one guest-resource callout contained the FAT allocation, HDD chunking, MEM,
  and lease-boundary text; it had no page-level horizontal overflow, broken
  image, or console warning/error. The temporary server and tab were closed.
- A running writer-owned Portable CS-DOS Web Terminal was not available during
  this run. The final `MEM` and one-byte `CHKDSK` observation below remains open
  and is not claimed as real Bedrock/client evidence.

## Non-goals and residual risk

- This does not promise byte-accurate host JavaScript heap measurement.
- It does not emulate native MS-DOS, BIOS interrupts, a Microsoft executable, or
  the supplied reference image.
- The first lease sizes are intentionally coarse. Reviews and measurements may
  refine values without weakening mandatory acquisition and exact finalization.
- RAM is derived transient state. Snapshot reload, migration, and rollback
  rebuild it from the active session instead of persisting counters or lease
  identifiers.
