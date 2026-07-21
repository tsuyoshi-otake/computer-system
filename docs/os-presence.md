# OS Presence v1

OS Presence v1 makes the state already owned by the Computer runtime visible as
one coherent guest operating system. It does not launch host processes, inspect
host Linux, or add decorative output that can disagree with the scheduler.
GitHub Issue [#20](https://github.com/tsuyoshi-otake/computer-system/issues/20)
owns this increment.

## Ownership and cost

Each registered Computer owns one fixed-capacity `OsRuntimeState`. The runtime,
shell, scheduler, block-device host, and persistence service mutate it through
explicit transitions. Commands and virtual files only render that shared state:

```text
ComputerRuntime / ShellSession / ComputerHost
                    |
                    v
             OsRuntimeState
              /    |    \
             /     |     \
       commands   /proc   journal files
```

Process, job, service, session, mount, and device lookup is Map-backed. The host
keeps a fixed set of stopping Computers, so an ordinary tick does not scan every
Computer merely to copy OS state. At most 16 stopping Computers advance one
phase per host tick.

## CS-Linux boot and identity

Boot records only transitions that actually complete. It creates PID 1 as
`/sbin/cs-init`, mounts `/`, `/proc`, `/dev`, and `/run`, discovers the fixed
device set, starts `cs-login`, creates a waiting `/sbin/cs-getty tty1`, verifies
account migration, and then marks the OS running. The terminal still shows the
minimal CS-Linux identity and authentication prompt; the journal is available
through `dmesg` and the guest log files instead of being replayed as a long fake
boot animation.

Before login, `/etc/issue` is shown when readable and the prompt is
`<computer-id> login:`. After login, the shell prompt is
`<login>@<computer-id>:<path>$`; effective UID 0 uses `#`. The shell reads the
real `/etc/motd` first, then shows a prior session with a host wall-clock
`Last login: ...` line. Legacy records without wall time omit that banner rather
than deriving a false date from guest ticks. Versioned login scripts run
afterward. The authenticated user's `.bash_history` is loaded and saved as a
mode-0600 regular file. It retains at most 100 entries, 512 UTF-8 bytes per
line, and 32 KiB total. Password prompts and other secret conversation input
never enter history or completion.

## Processes, jobs, and signals

The bounded process table records PID, PPID, UID, GID, state, start tick,
modeled CPU cycles, wait reason, last signal, and terminal status. The default
maximum is 64 processes with PID values up to 32767. Shells, foreground and
background Python/CS486 processes, compiler/debug work, and sleep jobs use this
same ownership model.

- `ps`, `ps -f`, and `ps -e` render the process table. `top` renders one bounded
  snapshot and never starts a refresh loop.
- `kill` accepts HUP, INT, TERM, KILL, STOP, and CONT, at most 16 PIDs per call.
  Non-root callers may signal only their own guest processes; PID 1 is
  protected.
- `jobs`, `fg`, `bg`, and `wait` operate on the current login shell's job table.
  Completed jobs retain a zombie process record until `wait` or foreground
  consumption reaps it.
- STOP pauses scheduler CPU service but does not rewrite guest time. CONT
  restores runnable ownership. Disconnect sends SIGHUP and finalizes the shell's
  jobs.

Background admission is deliberately narrow. Only one interactive `sleep`,
`python`/`micropython`, or `run` command may end in `&`. A background request is
limited to 512 UTF-8 bytes. Redirects, pipelines, scripts, command chains,
aliases, functions, TUI or secret-prompt work, lifecycle commands, MCP debug
submissions, and unsupported commands are rejected before side effects. The
default job-table maximum is 32.

## Sessions, services, proc, devices, and logs

`tty`, `who`, `w`, and `last` render the active-session and last-login tables.
The defaults permit eight active sessions and retain 64 last-login records.
`who` and `last` render stored wall-clock timestamps when present and fall back
independently to `tick N` for legacy session fields; `w` retains its guest-tick
LOGIN@ view. `service --status-all` and `service <name> status` inspect the
maximum-32 service table. Service mutation remains owned by `cs-init`; start,
stop, and restart are not guest operator commands in this release.

The following paths are generated at read time from the same state:

- `/proc/loadavg`, `/proc/mounts`, `/proc/devices`, and `/proc/services`;
- `/proc/<pid>/cmdline`, `/proc/<pid>/stat`, `/proc/<pid>/status`, and the
  corresponding `/proc/self/*` aliases;
- `/var/log/messages` for boot/system records and `/var/log/auth.log` for
  authentication records;
- `dmesg` for the boot channel.

The default journal retains at most 256 entries, 32 KiB total, and 1 KiB per
entry. Capacity failure is explicit and leaves the previous journal unchanged.
The device table permits 64 records; boot registers `/dev/null`, `/dev/zero`,
`/dev/tty`, `/dev/console`, `/dev/tty1`, `/dev/hda`, and an absent-media
`/dev/fd0`. These are guest device identities and never aliases for host files.
Mount and device tables are limited to 16 and 64 entries respectively.

`man` and `apropos` use a versioned, bounded guest index installed with the OS
image. They do not read host man pages or access the Internet.

## Sync, shutdown, reboot, and recovery

`sync` calls `ComputerHost`'s real persistence boundary. It returns failure when
the runtime has no host boundary; it is not a no-op.

A shutdown or reboot stops new guest and block-I/O admission, then advances
through these explicit phases:

1. signal owned compiler, foreground, debug, and background work;
2. wait for owned work, with forced finalization at the phase deadline;
3. drain block I/O accepted before the stop request;
4. save the data state;
5. unmount active mounts deepest-first;
6. stop services and available devices;
7. record the final-sync request and intent prepared state, then save that final
   cold projection once;
8. power off, or hand off to a fresh reboot.

Every phase has a 200-tick deadline. A drain, durability, device, or transition
failure faults the OS and display and leaves the last complete persisted
generation authoritative. A standalone runtime without a persistence sync
boundary faults at `sync_data`; it cannot skip both saves and claim a clean
shutdown or reboot. The final callback has no post-success journal mutation:
after cold restore, the two precommit terminal records appear exactly once only
when that callback actually committed. A failed callback leaves the prior
complete generation without a false saved/complete claim. The runtime also
removes only the failed attempt's provisional entries from its live journal
before adding the fault record. Consequently, a later periodic dirty-record save
cannot leak those entries into a cold generation after the final callback
failed; an unrelated diagnostic appended by the callback is retained.

`ComputerRuntime.safeBoot()` is a one-shot recovery boundary for a faulted
Computer. It preserves a broken `/startup.py`, bypasses it for that boot, and
records the decision in the boot journal. It is exposed only while the Computer
is `crashed`: the Web Terminal power control becomes safe boot, while a Bedrock
player must sneak while opening the crashed Computer. A normal Bedrock
interaction leaves the machine crashed and prints the recovery instruction. Both
adapters call the same runtime boundary; neither resets the machine or deletes,
renames, or rewrites the user's program. Safe boot remains unavailable to the
guest shell and MCP command execution.

## Cold persistence and migration

Computer snapshot schema 2 accepts optional versioned Linux and DOS runtime
state. Missing fields from legacy snapshots migrate to safe defaults. Validation
cold-normalizes runtime state before it is committed.

The startup coordinator scans every Computer referenced by the identity registry
even when the identity paged-store format is already current. It saves and
reload-verifies only payloads whose canonical migration changed them. A legacy
identity generation remains the final activation commit; an already current
healthy identity head is not rewritten merely because its Computer payloads were
scanned. A current-format fallback load is different: the valid previous
Computer or identity value is saved into the invalid head generation and
reload-verified without fallback before migration completes. An interrupted
payload commit is therefore discovered and safely resumed without renumbering
the Computer or repeating completed writes. If the canonical head validates but
its previous manifest does not, startup retains that head and repairs a usable
fallback or removes the invalid previous metadata. Recovery incrementally sweeps
target-only content blobs, schema-1 indexed pages, and stray manifests that
corrupt metadata can no longer identify, including after a restarted repair.
That prefix enumeration is recovery-only; a normal periodic save never pays an
O(total stored pages, blobs, or manifests) scan. Before any generation mutation,
the writer applies the same page-count ceiling as the reader and verifies that
the schema-2 manifest itself fits one Dynamic Property string.

Linux persistence keeps bounded journal and last-login history, service and
mount definitions, and offline device identities. It clears live processes,
jobs, login sessions, active mounts, lifecycle-in-progress state, and PID/job
cursors. Restore therefore never resurrects a stale authenticated shell or
running program. Repeated cold projection is idempotent.

The optional nested network snapshot is omitted while unused, keeping legacy and
new empty runtime snapshots canonical. If a future adapter has registered
network definitions, cold persistence retains interface and address definitions
but forces every link down, resets changed ticks and counters to zero, and
removes every process-owned socket/listener. A second cold projection is
identical.

DOS persistence keeps C: drive state and FAT metadata, but always resets the
active drive to C:, detaches transient A: media, clears A: current-directory and
label state, and discards metadata belonging to that detached generation. Every
FAT operation is bound to the media generation observed by its caller, so a
stale request after eject/reinsert fails before mutation.

## CS-DOS drive, FAT, and batch boundaries

`DosRuntimeState` provides exactly A: and C: for the production DOS profile. C:
contains persistent system media; A: reports not ready until a Bedrock media
adapter mounts a floppy. Drive selection and each drive's current directory are
independent. The reusable wildcard helper supports DOS `*` and `?` with defaults
of 4096 input entries and 512 matches; the shipped `DIR`, `COPY`, `DEL`/`ERASE`,
and `REN`/`RENAME` traversal tightens both examined entries and matches to 512
and caps recursion at 32 levels. A wildcard is never a creatable 8.3 filename.
The commands preflight expansion, and displayed modification times use the
stored FAT two-second timestamp rather than the command's current time.

The state model persists the FAT read-only, hidden, system, volume-label,
directory, and archive bits plus the two-second modification time. It allows at
most 4096 FAT metadata entries and 255 characters in a normalized runtime path.
The DOS-state metadata copy/move/delete APIs validate source and destination
generations independently. Single-path writes, `MD`/`RD`, wildcard `COPY`,
`REN`/`RENAME`, and `DEL`/`ERASE`, plus `MOVE` and `ATTRIB`, first trial the
complete bounded FAT aggregate. They then commit guest bytes, directory and
child indexes, metadata, symbolic and hard-link state, inode counters, used
bytes, base-image references, content blobs, revision, and FAT state inside one
combined synchronous undo boundary. Nested single-file helpers reuse the outer
filesystem snapshot, so a wildcard operation is O(filesystem entries + matched
entries), not one whole snapshot per match. Capacity rejection and injected
post-mutation failures in writes, directories, wildcard copy/delete/rename,
move, attributes, FAT updates, and the persistence observer restore the exact
pre-command filesystem and DOS snapshots, inode identities, link counts,
revisions, free space, and blob metrics. `ATTRIB` displays and changes R/H/S/A
with `+` or `-`, supports bounded wildcards and `/S`, and preflights media
writability. Read-only attributes are enforced by guest write, delete, rename,
copy, and editor paths. `DIR /A[:attributes]` filters the same metadata.
`LABEL [drive:] [label]` reads or changes the generation-bound volume label.
`CHKDSK [drive:]` reports actual bounded file, directory, byte, free-space,
label, and metadata results. It never changes guest file contents, labels, or
attributes and performs no repair, but it may materialize missing versioned FAT
metadata while reconciling a legacy filesystem entry.

The DOS publication observer is part of the transaction rather than a
best-effort notification. Drive selection, active and inactive per-drive current
directories, shell current-directory/prompt state, volume labels, and FAT
metadata synthesized by a read all restore together when publication throws; the
observer then receives the restored aggregate. One command owns one outer
boundary, so `MD C:\\ONE C:\\TWO` cannot leave `ONE` behind if creating `TWO`
fails. The transaction API accepts synchronous callbacks only. It rejects a
declared async function before any code runs; if an ordinary-looking callback
returns a Promise or thenable, it rolls back synchronous work immediately and
blocks further mutation in that state scope until settlement, including the
continuation after `await`. That settlement quarantine is shared by every
managed filesystem and DOS aggregate: a rejected callback cannot resume into a
second filesystem, a second DOS state, or the other subsystem. Explicitly joined
synchronous command owners remain the boundary for pre-await rollback.

The bounded BAT engine supports labels, `GOTO`, `GOTO :EOF`, internal and
external `CALL`, `SHIFT`, `IF [NOT] ERRORLEVEL`, `IF [NOT] EXIST`, and
`COMMAND /C` or `/K`. Default limits are 256 lines and labels, nine positional
arguments, call depth 8, 1024 jumps, 4096 executed steps, 64 loaded programs,
4096 characters per expanded command, and 256,000 output characters. Duplicate
or missing labels, recursion, output, and step exhaustion return explicit
terminal failures. This is bounded compatibility behavior, not native
COMMAND.COM or `.COM`/`.EXE` execution. Unquoted Unix-style `&&` and `||` chains
are rejected inside BAT control flow. Pipes and redirections remain documented
safe-shell extensions rather than native COMMAND.COM behavior.

`CONFIG.SYS` processes at most 64 lines. `DEVICE`/`DEVICEHIGH` recognizes only
the built-in HIMEM and EMM386 contract and reads the referenced guest file
before changing memory state. The file must begin with the expected versioned
CS-DOS driver capsule; missing, deleted, or corrupt drivers fail explicitly.
This validates the installed sandbox utility and still does not execute a native
DOS driver.

## Future guest-network state boundary

`OsRuntimeState.network` is the typed integration point reserved for the Issue
#6 guest-NIC adapter. It is empty by default and does not create a decorative
`lo` or `eth0`. Its defaults cap state at eight interfaces, 32 addresses, and 64
sockets; interface names are at most 15 UTF-8 bytes, socket IDs 64 UTF-8 bytes,
MTU 65,536 (minimum 68), owner PID 32,767, and listener backlog 128. IPv4 prefix
lengths are 0–32, IPv6 prefix lengths 0–128, and interface counters must be
nonnegative safe integers.

The boundary validates loopback/Ethernet registration, link up/down, IPv4/IPv6
assignment, counter accounting, and TCP/UDP open/bind/listen/close transitions.
Map-backed interface, address, socket, listener, and endpoint lookup keeps
identity checks bounded. Each successful mutation increments the containing OS
runtime revision; a capacity-plus-one or invalid transition leaves the snapshot
unchanged. Schema 1 snapshots strictly validate the matching Computer ID,
revision, known fields, references, and canonical addresses.

This is state ownership for a later adapter, not packet transport. No route
table, packet routing, host connection, guest connection, DNS resolver, or
network-command renderer exists yet. Future commands must read this one state
instead of inventing an independent `ip`, `ping`, or `ss` view.

## Explicit non-claims

- The Web Terminal connection is host transport, not a guest NIC. There is no
  shipped `lo`/`eth0`, IP address, `ip`, `ping`, `ss`, DNS, package manager, or
  Internet access.
- `/proc` is a small state-backed contract, not a Linux kernel ABI. There is no
  paging, swap, cgroup, namespace, host PID, or MMU page emulation.
- `top` is a snapshot, services are status-only, and jobs are limited to the
  explicitly admitted process forms above.
- `/dev/fd0` does not imply mounted media. No production Floppy Disk insertion
  or ejection control ships yet.
- VGA state still has no production guest graphics API or Web Canvas adapter.
- CS-DOS does not execute native BIOS/DOS interrupts, drivers, TSRs, `.COM`, or
  `.EXE` binaries.

## Verification rubric

### Linux state and lifecycle

`Verify:` Run:

```powershell
npx vitest run tests/os/osRuntimeState.test.ts tests/os/linuxHistory.test.ts tests/os/linuxManual.test.ts tests/computer/osRuntimeOwnership.test.ts tests/computer/osRuntimeProcessOwnership.test.ts tests/computer/backgroundJobs.test.ts tests/computer/gracefulLifecycle.test.ts tests/runtime/schedulerPause.test.ts
```

`Expect:` Process/job ownership, signal pause/resume, login/history/journal
views, cold persistence, real sync, ordered shutdown/reboot, failure injection,
and startup-preserving safe boot all pass. Cold restore contains the final-sync
request and shutdown/reboot-prepared record exactly once after success and
contains neither after an injected final-boundary failure.

### DOS state and migration

`Verify:` Run:

```powershell
npx vitest run tests/os/dosRuntimeState.test.ts tests/os/dosPresence.test.ts tests/os/dosBatch.test.ts tests/os/dosProfile.test.ts tests/computer/persistence.test.ts tests/computer/snapshotMigration.test.ts
```

`Expect:` Drive generations, A:/C: cold projection, wildcard and timestamp
behavior, bounded batch control flow, schema validation, and idempotent legacy
migration all pass. Capacity rejection and post-mutation failure injection for
single writes, `MD`/`RD`, wildcard `COPY`/`DEL`/`REN`, `MOVE`, `ATTRIB`, FAT
updates, and the cold-state observer leave filesystem and FAT snapshots,
inode/link identity, revisions, free space, and blob metrics unchanged.

### Future network state

`Verify:` Run:

```powershell
npx vitest run tests/os/osNetworkState.test.ts
```

`Expect:` Typed transitions, every capacity-plus-one rejection, strict schema-1
round-trip, outer OS-revision propagation, canonical omission while empty, and
idempotent cold link/counter/socket cleanup pass without claiming packet
transport or guest network commands.

### Production handoff

`Verify:` Run `npm run validate`, then perform the focused live checklist in
[manual-verification.md](manual-verification.md) against the managed BDS/Web
Terminal without resetting a preserved world.

`Expect:` The host gate passes, the authenticated Web Terminal renders the same
process/session/log/lifecycle state, shutdown drains accepted I/O before power
off, and no host process, host log, password, or bearer token appears in guest
output.
