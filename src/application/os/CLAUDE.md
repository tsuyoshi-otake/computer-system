# Guest OS guidance

## Scope and boundaries

This directory owns CS-Linux/CS-DOS profiles, shell behavior, authentication,
accounts, guest-facing filesystem access, OS images, virtual devices, and the
authoritative OS-presence aggregates.

- Keep path dialect, boot layout, environment, aliases, newline conventions,
  virtual devices, and user-visible errors behind `osProfile.ts` and the guest
  filesystem boundary. Do not leak Linux behavior into DOS or vice versa.
- Never call a host shell, compiler, filesystem, process, user database, clock,
  or network utility. All commands stay inside the sandboxed Computer.
- Command discovery and execution must validate the installed guest executable.
  Built-in implementation alone does not make a deleted utility available.
- Mount Linux and DOS images from one immutable, prevalidated shared base in
  O(number of image files). Persist only per-Computer copy-on-write blobs,
  metadata, link identities, and tombstones; never duplicate the base image.
- Image utilities have real bounded sizes, modes, owners, and inode identities.
  Deleting `/usr/bin/ls` or `C:\DOS\EDIT.COM` creates a persistent tombstone and
  makes later invocation return 127 until the file is restored.
- Linux built-ins are gated by the shared `/bin/bash` interpreter and DOS
  internal commands by `C:\COMMAND.COM`; an implementation without its
  interpreter file is unavailable.
- One boot-scoped memory manager per active profile owns every physical guest
  RAM lease. CS-Linux reserves kernel and services, reclaims/refills its buffer
  lease under admission pressure, binds process grants to PIDs, and exposes one
  immutable `O(allocations)` snapshot. `free`, `/proc/meminfo`,
  `/proc/<pid>/status`, and `top` derive only from that snapshot; never restore
  synthetic residency arithmetic, zero-value process fallbacks, or optional
  accounting callbacks.
- CS-DOS keeps its system/driver and process grants in the DOS manager while
  preserving conventional/UMB/XMS address totals.

## Linux accounts and filesystem credentials

- `/etc/passwd`, `/etc/group`, and `/etc/shadow` are the bounded authoritative
  account database. Only account commands may mutate them, including for UID 0;
  reject direct writes so persisted text and validated indexes cannot diverge.
- Fresh Linux initializes `cs` at UID/GID 1000, `/home/cs`, `/bin/bash`, and in
  `sudo`. Root is UID/GID 0 and password-locked. UID 0 is the only superuser;
  `sudo` membership is represented independently.
- Resolve the protected boot-service account by UID 1000 from the database,
  including its current name, group set, home, and shell. Never restore a static
  `cs` credential. It may be renamed/moved only while inactive and must not be
  removed through guest `userdel`.
- Reserve `computer` permanently in both user and group namespaces. Boot
  migration completely renames the one recognized legacy account to `cs`, moves
  `/home/computer` to `/home/cs`, removes old user/group/shadow keys, and
  creates no alias or symlink. Preserve the exact password payload, UID/GID,
  content, mode, ownership, mtime, symlink, hard-link identity, and tombstones.
  Migration is idempotent and fails on ambiguous/conflicting destinations.
- Account commands update files and indexes transactionally. A user may have at
  most 32 supplementary groups; reject the 33rd before mutation. `useradd` owns
  recursive home provisioning and must roll back the account, group references,
  home, and newly created ancestors on any failure.
- Route every shell command, editor, compiler, include/import read, startup
  path, Python syscall, and MCP debug operation through `CredentialedFilesystem`
  with an immutable process credential snapshot. No path may reach persistence
  storage directly to bypass DAC.
- Enforce owner/group/other access, directory traversal, ownership changes,
  sticky directories, protected hard links, and per-session `umask`. Setuid and
  setgid bits never create an implicit elevation path.
- `sudo` grants temporary scoped effective privilege only to a `sudo` member.
  `su` authenticates the target. Every success, failure, cancellation, `exit`,
  terminal close, and disconnect must terminate or restore temporary
  credentials.

## Authentication and sessions

- Production first boot sets the `cs` password using masked input. Later boots
  require username plus password and may authenticate any unlocked account. Root
  cannot log in until an administrator deliberately sets its password.
- Store only bounded salted SHA-256 records in `/etc/shadow`. Never persist,
  render, log, include in browser history/completion, or return plaintext.
- Reject MCP shell execution before login.
- Login-disabled development sessions refresh UID 1000 credentials, environment,
  and working directory after disconnect. Clear elevation and fall back to `/`
  with an explicit warning if home is unavailable. With no authenticated
  account, retain only unprivileged `nobody`, never a static `cs` or `sudo`
  identity.
- Trusted desktop boot creates only an empty mode-0644 `/startup.py` owned by
  UID 1000; `/` remains root-owned. Empty selects the built-in shell. Non-empty
  runs as the authoritative UID 1000 identity.

## Linux shell and OS presence

- The shell is a bounded BusyBox-compatible subset. It supports quoting,
  variables, `$?`, pipelines, redirects, `&&`, `||`, `;`, and bounded
  `sh`/`bash` scripts. Cap pipeline bytes, script depth/lines, expansions, and
  regex-like input. Add sandbox applets rather than invoking host tools.
- The pre-login prompt is `<computer-id> login:`, optionally preceded by
  `/etc/issue`. After authentication, the shell prints the real `/etc/motd`
  before a wall-clock `Last login:` line when a previous timestamp exists;
  legacy records without one do not fabricate a line. Persist mode-0600 per-user
  `.bash_history`, capped at 100 entries, 512 UTF-8 bytes/line, and 32 KiB
  total; secret input never enters history.
- Keep exactly one bounded `OsRuntimeState` per Computer as owner of lifecycle,
  PID/PPID/UID/GID/cycle records, shell jobs, login/last-login sessions,
  services, active mounts, devices, journal, and future network state. `ps`,
  snapshot-only `top`, job control, login tools, `/proc`, logs, and `dmesg`
  derive from it.
- PID 1 is `/sbin/cs-init`; `cs-login` owns a waiting getty; an authenticated
  shell is their child. Admitted Python, CS486, and background work receives a
  PID, credential snapshot, state, and modeled cycles.
- `/etc/inittab` (`sysinit`/`wait`/`respawn`/`initdefault`/`ctrlaltdel` entries,
  parsed by the bounded `linuxInittab.ts`, ≤64 lines) selects the target
  runlevel; `/etc/rcN.d/` (`N` = `0`-`6`; `S` aliases `1`) holds the `SNN`/`KNN`
  symlink farm into `/etc/init.d/<name>` real interpretable shell scripts.
  Runlevels 2-5 are deliberately identical multi-user aliases; 0/6 reuse the
  existing shutdown/reboot lifecycle; 1/S stop rc.d services. `telinit {0-6|S}`
  (root-only; `init` is its alias) and read-only `runlevel` are the guest
  commands; `service NAME status` remains status-only exactly as before
  (`/etc/init.d/<name> start|stop|restart` is the only mutation path).
- Service mutation is centralized in the internal `cs-init-ctl NAME ACTION`
  primitive (root-only, not listed in the public command index or `man -k`): a
  fixed table (today `syslog`, `cron`) is the only thing that produces real
  process/service effects, so a user-authored `/etc/init.d/foo` script is
  genuinely interpreted but cannot invent a new working service. Deleting or
  removing the executable bit from an `/etc/init.d/<name>` script makes its
  direct invocation fail explicitly (127/126) without disturbing `cs-init-ctl`
  itself. The inittab-driven rc.d service start-up runs synchronously during
  `ShellSession` construction (see `computer/CLAUDE.md` for the paced-render vs.
  synchronous-completion split at the `ComputerRuntime` boundary).
- `/etc/crontab` is the only supported crontab surface. `crontab -l` reads it
  and root `crontab -e` opens it in the existing `vi`; there is no per-user
  spool. `linuxCrontab.ts` parses its bounded 7-field lines (`*`, numbers, `a-b`
  ranges, comma lists, `*/n` and `a-b/n` steps) and re-parses only on `cron`
  service start/restart. Cron due-time comparisons must use the tick-derived
  virtual calendar (`virtualCalendarFields`), never the injected wall-clock
  `ShellClockSource` used by `date`/login timestamps, so job firing stays a
  deterministic function of guest tick count.
- Only one interactive `sleep`, `python`/`micropython`, or `run` command may use
  a trailing `&`. Reject background redirects, pipelines, scripts, aliases,
  functions, MCP submissions, and unsupported commands before side effects.
- `/proc/devices`, `/proc/services`, `/proc/loadavg`, `/proc/mounts`,
  `/proc/<pid>/{cmdline,stat,status}`, and `/proc/self/*` are dynamic state
  views. `/var/log/messages`, `/var/log/auth.log`, and `dmesg` use the bounded
  journal (256 entries / 32 KiB / 1 KiB per entry by default).
- History rotates; structural tables stay fatal. The journal and `last_logins`
  evict oldest-first on append and cold restore; bounded `journalDropped` rides
  both snapshots, defaults to 0, and renders one leading notice line. Rollback
  skips an already evicted entry. Every other capacity stays fatal.
- `/dev/null`, `/dev/zero`, `/dev/tty`, `/dev/console`, `/dev/tty1`, `/dev/hda`,
  and absent-media `/dev/fd0` share the device registry and do not imply host
  devices.
- Persist only the cold projection: journals, last login, service definitions,
  mount definitions, and offline device identities survive. Processes, jobs,
  sessions, active mounts, and PID/job cursors restart from validated cold
  state. Missing legacy state migrates idempotently.
- `OsRuntimeState.network` is an empty-by-default schema-1 boundary: at most 8
  interfaces, 32 addresses, and 64 sockets with Map-backed identity/endpoint
  indexes. Omit an unused network from snapshots. Cold restore retains
  definitions but forces links down, zeros counters, and removes
  sockets/listeners. Do not fabricate `lo`, `eth0`, routes, packets, DNS, `ip`,
  `ping`, or `ss` before the Issue #6 adapter owns those transitions.

## DOS state and commands

- New DOS volumes begin at `C:\>` and never create a Linux-style `C:\USERS`.
  Preserve case-insensitive strict 8.3 paths, CRLF, `NUL`, and DOS-specific
  command/error text.
- Keep one bounded `DosRuntimeState` per DOS Computer. It owns selected drive,
  per-drive current directories, media generations, labels, FAT R/H/S/A
  attributes, two-second mtimes, shell prompt state, and cold observation.
- Treat every operand of one DOS command as a single all-or-nothing operation,
  including multi-path `MD` and wildcard `COPY`/`REN`/`DEL`. Trial the FAT
  clone, then commit filesystem and FAT state in one bounded undo transaction.
  Nested writes reuse the outer boundary.
- Filesystem/DOS transaction callbacks must be synchronous. Reject declared
  async callbacks before invocation; quarantine disguised Promises until
  settlement so post-`await` continuations cannot escape rollback through
  another owner.
- An observer failure restores and republishes the previous aggregate. Cold
  projection always detaches transient A: media while retaining C: metadata;
  stale media-generation operations fail explicitly.
- `TREE` remains O(N), capped at 512 entries and 32 levels. `DIR`, `COPY`,
  `DEL`/`ERASE`, `MD`/`RD`, `MOVE`, `REN`, `TYPE`, `TREE`, `VOL`, `VER`,
  `DOSKEY`, `MEM`, `ATTRIB`, `LABEL`, and read-only `CHKDSK` must not leak Linux
  output.
- DOS exposes an underline prompt cursor. Arrow-key history is disabled until a
  bare `DOSKEY` installs it; `DOSKEY /HISTORY` only lists retained entries. F3
  recalls the most recent submitted line independently.
- DOS batch supports bounded labels, `GOTO`/`:EOF`, internal/external `CALL`,
  `SHIFT`, `IF [NOT] ERRORLEVEL`, `IF [NOT] EXIST`, and `COMMAND /C` or `/K`.
  Defaults: 256 lines/labels, nine positional args, call depth 8, 1,024 jumps,
  4,096 steps, 64 loaded programs, 4,096 expanded-command characters, and
  256,000 output characters. This is not native COMMAND.COM execution.
- Process at most 64 `CONFIG.SYS` lines. Only validated installed HIMEM/EMM386
  capsules and `DOS=HIGH|LOW,UMB|NOUMB` affect modeled memory. Never claim
  native drivers, paging, interrupts, TSRs, or DOS `.COM`/`.EXE` execution.

## Verification

Use `tests/os/` for profiles, accounts, DAC, auth, shell, runtime state, DOS
transactions, batch limits, and negative cross-profile tests. Authentication
acceptance must prove pre-login MCP rejection, masked setup, rebooted `cs`
login, authenticated `whoami`, explicit shutdown, and absence of the probe
password.
