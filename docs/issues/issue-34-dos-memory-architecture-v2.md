# Issue #34: DOS memory architecture v2

Tracking: <https://github.com/tsuyoshi-otake/computer-system/issues/34>

Related defect: <https://github.com/tsuyoshi-otake/computer-system/issues/33>

Status on 2026-07-19: implemented and verified by the complete host gate, a
two-boot headless real-BDS suite, and Chrome rendering. The live-player
disconnect/Portable observation remains an explicit manual acceptance item.

## Implemented boundary

One boot-scoped `DosGuestMemoryManager` is the authoritative owner of the CS-DOS
physical address map and all DOS resident/process grants. It reconciles every
address allocation with the same `GuestRamLedger`; `MEM` consumes an immutable
manager snapshot and has no independent arithmetic or optional fallback path.

The dependency direction is:

```text
Bedrock/runtime adapters
  -> application/os boot planning, admission, and DosGuestMemoryManager
    -> domain BoundedIntervalAllocator, GuestRamLedger, and CS executable model
```

The domain layer owns only deterministic values and allocation mechanics. DOS
boot policy, CONFIG.SYS driver resolution, lifecycle, and degraded-boot
orchestration remain in the application layer. The manager lifecycle is a
non-persisted substate of one `ComputerRuntime` boot; it does not compete with
`ComputerRecord.lifecycle`.

The modeled 2 MiB portable map is:

| Region                  | Address range       | Allocatable when                               |
| ----------------------- | ------------------- | ---------------------------------------------- |
| Conventional            | `0x00000..0x9FFFF`  | Always                                         |
| Reserved video aperture | `0xA0000..0xBFFFF`  | Never                                          |
| Upper memory blocks     | `0xC0000..0xDFFFF`  | `HIMEM.SYS`, `EMM386.EXE NOEMS`, and `DOS=UMB` |
| Reserved ROM aperture   | `0xE0000..0xFFFFF`  | Never                                          |
| Extended/XMS            | `0x100000..RAM end` | `HIMEM.SYS`                                    |

HMA is the first 64 KiB of the XMS allocator, never an additional capacity.
`DOS=HIGH` attempts to place the kernel, system data, FILES table, and BUFFERS
data there; `COMMAND.COM` remains conventional. If that complete high set does
not fit, it loads low with an explicit diagnostic. `DEVICEHIGH` uses a
contiguous UMB block first and falls back to conventional memory with an
explicit boot diagnostic, matching DOS behavior without hiding the fallback.

`CONFIG.SYS` is planned and validated without side effects. A plan is committed
only after all directives, dependency order, driver capsules, limits, and the
complete memory layout validate. Rejection leaves the ledger clean and starts an
explicit 64 KiB `degraded-low` profile; AUTOEXEC continues after the boot
diagnostics. Derived `CONFIG_*` environment variables are no longer persisted or
used as a second source of truth, so restart and legacy snapshot restore rebuild
identical memory state from the guest boot files.

The paragraph-aligned allocator is deterministic first-fit with immediate
coalescing. Allocation, release, and snapshot creation are `O(N)`, where `N` is
bounded by 128 address extents/active allocations per region. Dynamic manager
reservations are capped at 64. `MEM /F` reports actual free extents and largest
contiguous blocks; snapshot work exposes an allocation-visit count for
bounded-work tests.

Guest RAM owners use `category + moduleId` for accounting and retain a bounded
display name plus optional process `instanceId`. This preserves module-level
`MEM /C` output while keeping existing coarse owner names compatible.

CS executable v3 declares the `cs-flat32-v1` stack, heap, and auxiliary resident
bytes. Admission reserves that exact physical working set before the
`Cs486Process` is constructed, while its declared stack plus heap defines the
linear address-space grant. Version 1/2 executables remain readable and receive
the historical all-currently-free exclusive grant, so two legacy processes
cannot unknowingly share the same physical remainder. Every completion, failure,
cancel, disconnect, detach, debugger replacement, and shutdown path has one
grant finalizer.

The built-in program selected by an empty `/startup.py` uses one 64 KiB
composite grant. A long-lived user-authored startup receives auxiliary residency
equal to `min(1 MiB, physical RAM / 4)`; foreground Python retains its
historical 1 MiB managed-runtime quota. On the 2 MiB desktop this policy leaves
deterministic admission room for one ordinary foreground process.

Issue #33 is handled by the same teardown discipline: compile completion,
terminal disconnect, and session detach now release the compile reservation and
reap the OS process through one helper exactly once.

## Persistence and migration

Memory managers, leases, address extents, and boot substates are transient and
are never serialized. Existing Computer records need no schema rewrite. On cold
boot, host reload, or migration from a record containing legacy `CONFIG_*`
environment entries, the runtime parses the authoritative guest `CONFIG.SYS` and
reconstructs the map. A second restart is idempotent and does not retain lease
identifiers or duplicate resident modules.

## Non-goals and deferred work

- This is a deterministic Computer System ABI and memory model, not DPMI.
- It does not execute native x86, DOS `.COM`/`.EXE`, BIOS interrupts, or host
  drivers.
- EMS pages/frame mapping is deferred. `EMM386.EXE NOEMS` exposes only modeled
  UMBs.
- It does not promise byte-accurate JavaScript heap measurement or native DOS
  paragraph ownership structures such as an executable MCB chain.
- Native x86 compatibility, if pursued, remains a separate execution-engine
  architecture and must not be inferred from the address map.

## Acceptance evidence

1. Atomic CONFIG.SYS and explicit degraded boot

   Verify:
   `npm test -- tests/os/dosMemoryConfiguration.test.ts tests/os/dosGuestMemoryManager.test.ts tests/computer/dosMemoryArchitectureV2.test.ts`

   Expect: a malformed or unresolved directive commits no partial driver or
   FILES/BUFFERS state, produces bounded diagnostics, and boots one 64 KiB
   low-memory profile while AUTOEXEC remains observable.

2. Address layout, HMA/XMS reconciliation, and DEVICEHIGH fallback

   Verify:
   `npm test -- tests/computer/boundedIntervalAllocator.test.ts tests/os/dosGuestMemoryManager.test.ts`

   Expect: all extents are 16-byte aligned and non-overlapping; HMA remains
   inside XMS; physical, region, and ledger totals reconcile; failed UMB
   placement loads the driver low with one diagnostic; release coalesces
   adjacent free extents deterministically.

3. Snapshot-only MEM output

   Verify: `npm test -- tests/os/dosProfile.test.ts`

   Expect: `MEM`, `/C`, `/D`, and `/F` derive from one immutable snapshot; `/C`
   shows category/module placement, COMMAND.COM remains conventional, and `/F`
   reports actual extents and largest blocks without fallback arithmetic.

4. Legacy and v3 process grants

   Verify:
   `npm test -- tests/computer/guestProcessMemory.test.ts tests/runtime/cs486ExecutableV3.test.ts tests/os/toolchain.test.ts tests/runtime/pythonCs486.test.ts`

   Expect: v1/v2 takes the complete free physical remainder exclusively; v3
   receives its declared linear grant and exact physical reservation; Python
   auxiliary residency is charged once; a failed construction releases its
   reservation.

5. Exactly-once finalization, including compile disconnect

   Verify:
   `npm test -- tests/computer/guestResourceAccounting.test.ts tests/computer/dosMemoryArchitectureV2.test.ts tests/computer/cs486DebuggerRuntime.test.ts`

   Expect: compile, foreground, background, debugger, boot, terminal close,
   detach, cancel, failure, and shutdown paths return to their exact baseline;
   manager close leaves the ledger at zero and repeated release cannot silently
   mutate accounting.

6. Reload/migration restart idempotence

   Verify: `npm test -- tests/computer/dosMemoryArchitectureV2.test.ts`

   Expect: cold reboot and a serialized `ComputerRecord` restore rebuild the
   same flags, modules, regions, and totals from CONFIG.SYS; legacy `CONFIG_*`
   environment state is neither required nor regenerated.

7. Multiple Web Terminal sessions

   Verify: `npm test -- tests/computer/dosMemoryArchitectureV2.test.ts`

   Expect: three attached sessions, writer takeover, two non-final detaches, and
   the final detach do not duplicate or leak process/resident grants; only the
   final detach publishes terminal closure.

8. Bounded snapshot and allocation work

   Verify:
   `npm test -- tests/computer/boundedIntervalAllocator.test.ts tests/os/dosGuestMemoryManager.test.ts`

   Expect: capacity-plus-one is rejected without mutation; visit counts grow
   with bounded active allocations/free extents rather than RAM bytes; allocator
   operations and MEM snapshot construction remain `O(allocations)`.

9. Complete host gate

   Verify: `npm run validate`

   Expect: formatting, ESLint, TypeScript, all Vitest tests, production Bedrock
   pack build, and the 16-chapter Pages build pass.

10. Real Portable CS-DOS observation

    Verify: On a writer-owned Portable CS-DOS Web Terminal, reboot once; inspect
    the CONFIG diagnostics and run `MEM`, `MEM /C`, `MEM /D`, and `MEM /F`
    before and after one bounded foreground program.

    Expect: the displayed map and module placements match the configured
    snapshot, runtime use returns to the exact baseline after completion and
    disconnect, no second session changes the baseline, and BDS diagnostics stay
    empty.

## Verification record

On 2026-07-19:

- The allocator/parser/manager/runtime/toolchain focused suites passed,
  including the four-case architecture acceptance suite. It covered
  restart/restore idempotence, invalid CONFIG rollback, legacy exclusive grant
  finalization, and three simultaneous Web Terminal sessions.
- `npm run validate` passed formatting, ESLint, TypeScript, 162 Vitest files
  with 1,111 tests, the production Bedrock pack build, and the 16-chapter Pages
  build.
- `npm run test:bds` passed both isolated official-BDS boots. Each run completed
  the runtime probe at 20 Computers × 40 ticks with no memory warning signals;
  the second run restored the persisted Computer snapshot.
- Chrome loaded the generated Chapter 14 at normal and 375-pixel content widths.
  The exact address-map rows, atomic CONFIG text, snapshot-only MEM contract,
  HMA/XMS relationship, and non-DPMI boundary were visible; both widths had no
  page-level horizontal overflow, all chapter images loaded, and the console had
  no warnings or errors.
- `npm run test:bds:disconnect` reached `BDS_DISCONNECT_READY` on the official
  server, then timed out because no Minecraft client performed its required
  “open the terminal, then leave the server” interaction. Host tests cover the
  exactly-once compile-disconnect finalizer, but acceptance item 10 remains
  pending until that live-player step is performed.
