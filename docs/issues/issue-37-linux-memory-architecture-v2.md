# Issue #37: CS-Linux memory architecture v2

Tracking: <https://github.com/tsuyoshi-otake/computer-system/issues/37>

Status on 2026-07-19: implemented and verified by the complete host gate and
Chrome desktop/narrow manual rendering. The headless real-BDS check is blocked
before launch because this environment has no `BDS_HOME` official server
distribution.

## Implemented boundary

One boot-scoped `LinuxGuestMemoryManager` is the authoritative owner of every
CS-Linux physical RAM lease. Kernel, system services, reclaimable buffers,
compiler/editor residency, boot programs, foreground/background processes, and
MCP debugger processes all use the same `GuestRamLedger` through that manager.
No display command synthesizes an independent total or reads an optional
`memoryUsageBytes` callback.

The dependency direction is:

```text
Bedrock/runtime adapters
  -> application/computer boot, PID lifecycle, and finalization
    -> application/os LinuxGuestMemoryManager and immutable snapshots
      -> domain GuestRamLedger and CS executable memory declarations
```

The manager lifecycle is transient state owned by one `ComputerRuntime` boot. It
is not persisted and does not compete with `ComputerRecord.lifecycle`.
Construction requires a clean ledger; close releases all owned records in
reverse order and rejects any externally retained lease.

## Resident policy and reclaim

The strict resident policy is:

- kernel: `384 KiB + min(384 KiB, floor(RAM / 16))`;
- system services: `192 KiB`;
- reclaimable buffers: `min(256 KiB, floor(RAM / 32), remaining RAM)`;
- active dynamic reservations: at most 128.

On a 2 MiB standard desktop, the manager starts with a 512 KiB kernel, 192 KiB
services, and 64 KiB buffers. The built-in 64 KiB boot grant makes the normal
boot snapshot 832 KiB used, 1,216 KiB free, and 1,280 KiB available. On an 8 MiB
advanced desktop, the system-only values are 768 KiB kernel, 192 KiB services,
and 256 KiB buffers.

`MemAvailable` is `MemFree + reclaimable buffers`. If a request fits available
RAM but not free RAM, admission shrinks the buffer lease by the exact shortfall
before acquiring the new lease. An acquisition failure restores the old buffer
size transactionally. Releasing dynamic memory refills buffers toward their boot
target from currently free RAM. A request one byte above available fails without
changing any allocation or ledger total.

Hardware too small for the computed kernel plus services faults boot explicitly
and leaves no manager or ledger lease behind.

## Process grants and observation

CS executable version 3 keeps the declared `cs-flat32-v1` contract: stack, heap,
and linked data define the linear address space, while that linear space plus
auxiliary residency defines the physical reservation. The linear value is
reported as `VmSize`/VIRT; the physical value is reported as `VmRSS`/RES.
Version 1/2 execution remains readable but takes the complete currently
available physical remainder exclusively.

Every dynamic grant has a bounded `category + moduleId + instanceId` identity.
After the OS process is created, the grant is bound exactly once to its PID. The
immutable snapshot aggregates all grants for each PID, allowing compilers and
any future multi-allocation process to report one virtual and resident total. A
bind or scheduler failure releases the grant and reaps a created PID through the
same finalization owner.

The following views consume that one snapshot:

- `free` and `/proc/meminfo`: total, used, free, available, and resident groups;
- `/proc/<pid>/status` and `/proc/self/status`: `VmSize` and `VmRSS`;
- `top`: VIRT and RES from the same per-PID aggregation.

Snapshot creation is `O(allocations)`, bounded by 3 system records plus 128
dynamic reservations. It exposes `allocationVisitCount` for executable work
bounds. No scan scales with physical RAM bytes.

## Strict cutover

This change intentionally provides no compatibility shim for the former Linux
reporting model. The synthetic kernel/services/buffer arithmetic, foreground-
or-background callback selection, hard-coded zero callback, and `/proc` zero
memory fallback are removed.

Real OS residency now reduces admission capacity. In particular, a 2 MiB machine
running a resident user startup program may correctly reject a second 1 MiB
Python runtime even though the old display-only accounting admitted it. Tests
whose purpose requires concurrent large runtimes use an 8 MiB machine; the 2 MiB
rejection has its own mutation-free OOM acceptance test.

There is no persistence migration. Memory managers, leases, PID bindings, and
snapshots are rebuilt from hardware and current boot state on each cold boot.

## Non-goals

- This is deterministic guest accounting, not host JavaScript heap telemetry.
- Swap, paging, an MMU, overcommit, page cache aging, and native Linux `/proc`
  units are not implemented.
- The network and native ELF execution boundaries remain separate work.
- This change does not claim byte-accurate Linux kernel structures.

## Acceptance evidence

1. Resident profiles, undersized boot, and reclaim

   Verify:
   `npm test -- tests/os/linuxGuestMemoryManager.test.ts tests/computer/linuxMemoryArchitectureV2.test.ts`

   Expect: 2 MiB and 8 MiB totals match the policy; buffers reclaim and refill;
   capacity-plus-one and undersized boot fail without retained state.

2. Required manager-backed admission

   Verify:
   `npm test -- tests/computer/guestProcessMemory.test.ts tests/computer/guestResourceAccounting.test.ts`

   Expect: Linux, DOS, and isolated ledger admissions are explicit; production
   Linux has no optional accounting route; all terminal paths release exactly
   once.

3. Snapshot-only guest reports

   Verify:
   `npm test -- tests/os/shellSession.test.ts tests/os/osRuntimeState.test.ts tests/computer/linuxMemoryArchitectureV2.test.ts`

   Expect: `free`, meminfo, process status, and top agree on physical and
   per-PID values; direct OS state cannot synthesize a zero-memory status view.

4. PID and failure finalization

   Verify:
   `npm test -- tests/computer/runtimeCredentials.test.ts tests/computer/computerHost.test.ts tests/computer/linuxMemoryArchitectureV2.test.ts`

   Expect: boot, compiler, foreground/background, and MCP grants bind to the
   intended PID; injected scheduler failure leaves no phantom job, process, or
   allocation.

5. Reboot idempotence and clean close

   Verify: `npm test -- tests/computer/linuxMemoryArchitectureV2.test.ts`

   Expect: cold reboot reconstructs an identical baseline snapshot and shutdown
   leaves the ledger empty. No memory state is serialized.

6. Complete host gate

   Verify: `npm run validate`

   Expect: formatting, ESLint, TypeScript, all Vitest suites, production pack,
   and 16-chapter Pages build pass.

   Result on 2026-07-19: PASS. All 164 test files and 1,123 tests passed, and
   both production pack and Pages builds completed.

7. Real BDS and browser evidence

   Verify: run `npm run test:bds`, then render the canonical manual in Chrome at
   desktop and narrow widths.

   Expect: headless BDS boots the production pack without a memory-accounting
   fault; the manual describes `MemAvailable`, VIRT/RES, and strict OOM without
   overflow or stale synthetic-accounting text.

   Result on 2026-07-19: Chrome PASS at the default desktop viewport and a
   temporary 390 x 844 viewport. The document width remained equal to the
   viewport width. BDS BLOCKED before server launch with the explicit
   `BDS_HOME must point to an extracted official Bedrock Dedicated Server distribution`
   prerequisite; the production pack build preceding that check passed.
