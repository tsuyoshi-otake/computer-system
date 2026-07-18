# Development

## Host and vertical-slice verification

The language, VM, scheduler, computer lifecycle, terminal, filesystem,
persistence adapters, OS, and native modules run entirely outside Minecraft. Run
the complete host acceptance suite with:

```powershell
npm run validate
```

This checks formatting, lint, TypeScript types, deterministic host tests, and
the production Behavior/Resource Pack build. Phase evidence is recorded in
[`docs/issues/phase-1-host-runtime.md`](issues/phase-1-host-runtime.md) and
[`docs/issues/phase-2-computer-vertical-slice.md`](issues/phase-2-computer-vertical-slice.md).

## Supported Phase 0 environment

- Minecraft Bedrock Edition 1.26.30 or later in the 1.26 release line
- `@minecraft/server` 2.8.0
- `@minecraft/server-ui` 2.1.0
- `@minecraft/vanilla-data` 1.26.33
- Node.js 24 or later

The Phase 0 baseline intentionally uses stable Script APIs and does not require
the Beta APIs experiment.

## Commands

```text
npm install
npm run format
npm run validate
npm run deploy
npm run build:pages
npm run test:pages
```

`npm run build` creates development Behavior and Resource Packs under `dist/`.
`npm run deploy` replaces only the `computer_system_phase_0` development-pack
directories in the locally installed Bedrock GDK client. The deployment root is
`%APPDATA%\Minecraft Bedrock\users\shared\games\com.mojang`, which is the
current Windows creator-content location following the UWP-to-GDK migration.

### GitHub Pages static publication

`web/manual.js` is the single authored source for both the Web Terminal Manual
dialog and the public 16-chapter reference. Do not maintain a second Markdown,
JSON, or HTML copy of the chapter prose. `npm run build:pages` imports that
module, validates its stable chapter and section IDs, and pre-renders the full
publication under `dist/pages/` with the landing page. The generated artifact is
disposable and must not be committed.

The Pages artifact is deliberately narrower than `web/`. Its builder uses an
explicit allowlist for the static site CSS/JavaScript and `web/assets/`; do not
replace that with a recursive copy. In particular, it must not publish the live
Terminal's `web/index.html`, `web/app.js`, four-digit connection form,
bearer-token/session storage, or `/api/*` client. GitHub Pages cannot connect to
BDS or act as the Web Terminal. The local companion started with
`npm run dev:bds:web` remains the only browser-to-BDS interaction path.

All navigation and assets must remain valid when GitHub serves the project below
an arbitrary repository base path. Use generated relative URLs rather than a
hard-coded `/computer-system/` prefix. Stable manual deep links use fragments,
for example `manual/#terminal-editor-static-github-pages-reference`, because a
fragment survives reload without a server-side routing fallback. The complete
manual, table of contents, reading paths, and Previous/Next links are static
HTML; JavaScript enhances search but is not allowed to own the only readable
copy.

Run the focused gate with:

```powershell
npm run build:pages
npm run test:pages
```

`Expect:` `dist/pages` contains only the allowlisted landing/manual presentation
and referenced assets; the manual has all 16 canonical chapters and stable
section targets; every local link resolves below a simulated repository base;
search remains bounded to 24 results; the no-JavaScript fallback contains the
whole publication; and no Terminal input, connection, token, session, or API
surface is present.

`.github/workflows/pages.yml` runs on pushes to `main` and manual dispatch. The
workflow uses Node.js 24, obtains the deployed base URL from GitHub Pages
configuration, builds and tests the static site, uploads only `dist/pages`, and
deploys with the minimum `contents: read`, `pages: write`, and `id-token: write`
permissions. Repository Pages settings and the account plan still determine
whether a private repository can expose the resulting site.

`npm run build:release` rebuilds the production packs, removes repository-only
guidance and JavaScript source maps from the release file set, and emits
deterministic Behavior/Resource `.mcpack` files, a combined `.mcaddon`, and
`SHA256SUMS.txt` under `dist/release/`.

When changing JSON UI under the Resource Pack, increment both the Resource Pack
header/module version and the Behavior Pack dependency version. Bedrock caches
server Resource Packs by UUID and version, so reconnecting to a restarted BDS
can otherwise continue rendering an older UI definition.

JSON UI overrides such as `ui/server_form.json` apply to the legacy form path
used by APIs such as `ModalFormData`. The reactive `CustomForm` API introduced
with Data-Driven UI (DDUI) uses a separate client-rendered screen: the 2.1.0 API
does not expose panel dimensions or font scaling, and the legacy
`server_form.custom_form` override does not affect it. Keep the DDUI terminal
when live output is required; switching to a legacy modal form trades that live
binding for Resource Pack-controlled layout.

For unrestricted desktop width and keyboard-first interaction, use the Web
Terminal companion. It renders the fixed-cell terminal snapshot in a normal
browser and positions its semantic input at the terminal cursor, preserving
physical Enter, Ctrl+C, and history without a separate visible text field. Start
the combined managed runtime with `npm run dev:bds:web`; see
[the MCP debugging guide](mcp-debugging.md) for network and security settings.
The browser derives the display-frame width, height, and font size from one
bounded 80x25 fit, then centers that complete frame on both axes. The
active-page CRT control adds only static, pointer-transparent CSS layers over
that frame; it does not add per-snapshot JavaScript, mutate the logical palette,
or create a second screen representation. The companion-host one-action workflow
is automatic when the published host is a literal IP assigned to the server and
no custom public origin is configured. Use `WEB_COMPANION_AUTO_OPEN=0` to
disable it or `1` to enable it explicitly while retaining the local-listener
requirement. Interacting with a Desktop or Advanced Desktop Computer System, or
using a Portable Computer System, opens its activated path through loopback in
the host's default browser. This checks the server address rather than the
initiating player's IP. Remote players receive the detected LAN entry page and
the Computer's permanent four-digit number. An interaction activates that number
once for two minutes; invalid guesses and active collisions are bounded.

Terminal output remains mouse-selectable. Ctrl+C copies when either output or
command text is selected and otherwise performs the bounded terminal interrupt.
Plain-text paste inserts at the command selection, converts line breaks to
spaces, respects the 128-character command bound, and never submits implicitly.
Periodic snapshot work processes a fixed-size batch without rebuilding an O(N)
session array. Writer input additionally requests a deduplicated,
attempt-bounded snapshot for that session, removing the O(N/K) round-robin wait
from the interactive path while preserving periodic fairness as a fallback.

New Computers use `c-xxxxxx` identities. The six lowercase Crockford Base32
characters encode the stable 30-bit value exposed by `os.getComputerID()`.
Allocation checks the persisted registry and retries collisions at most 16
times. Identity snapshot schema 2 intentionally does not migrate the previous
sequential-ID schema; reset the managed debug world before acceptance testing a
build that crosses this boundary.

A Computer has one Web Terminal writer lease. Every newly opened session is the
writer and atomically demotes the previous writer to a viewer. Viewer input and
interrupts are rejected by both the HTTP companion and the Bedrock bridge.
Input, close, and **Take control** transitions share one bounded per-Computer
operation queue, so a successful takeover demotes the prior writer before later
input can pass. Closing one view leaves the terminal open; only the final detach
emits `terminal_closed`. `ComputerRuntime`, not user Python, synchronously
clears the login/elevation state and cancels foreground, compile, and queued MCP
work that captured its credentials before delivering the bounded guest
resume/close event. If delivery fails, the machine shuts down explicitly rather
than retaining an unreachable privileged session. Different Computers have
independent writer leases.

The Web Terminal sends `terminal_line`; DOS `EDIT` and cross-profile `vi`
additionally use bounded `terminal_keys` batches. Writer-only `web-complete`
provides command/path completion. The compatibility `web-resize` boundary
accepts only 80x25 and normalizes that fixed hardware text mode once per writer
session; later browser resizes change CSS scale, never guest cell geometry.
CS-Linux 1.0 parses a bounded Computer System Bash language with pipelines,
redirects, control operators, quoting, variables, positional parameters,
conditionals, loops, and functions. Production first boot sets the initial `cs`
password twice; later boots ask for a username and that account's password. The
salted record is stored in root-readable `/etc/shadow`, while secret Web input
is masked and excluded from history and completion. `cs` owns UID/GID 1000 and
`/home/cs`, belongs to `sudo`, and may add bounded users and groups through
authenticated elevation. UID/GID 0 root starts password-locked. UID 1000 is the
protected boot-service account: its name and home may change only while it is
inactive, but it cannot be deleted. Desktop boot creates the existing-file
boundary `/startup.py` as mode 0644 and owned by that account, without making
the root directory writable. A blank file runs the built-in shell program;
non-empty saved source runs on later boots with the account database's current
UID 1000 groups.

The legacy `computer` name is permanently reserved in both user and group
namespaces; current account creation and rename paths may never recreate it.
Credential snapshots accept at most 32 supplementary groups per user. Account
mutations validate that ceiling before committing any of the three account
files. Default `useradd` home creation recursively provisions missing ancestors
inside the same rollback boundary: if an entry, capacity, or filesystem check
fails, neither the account nor any partial home tree may remain.

The Linux profile owns `/etc`, `/dev`, volatile `/tmp`, `/usr`, `/var`,
`/home/cs`, identity/time applets, and `/dev/null`. Guest commands, editors,
Python/native modules, compilers, foreground jobs, startup scripts, and MCP
execution receive a process-scoped `GuestFilesystem`; owner/group/other DAC,
ancestor search, sticky deletion, protected hard links, ownership rules, and
`umask` are enforced at that boundary. Raw `InMemoryFilesystem` access remains
limited to trusted boot, account-transaction, and persistence code. The shared
OS profile boundary owns path dialects, boot images, environment, and virtual
devices. Closed-by-default Linux and DOS registries own command names, help, and
completion; separate frontends own syntax, expansion, and error formatting. DOS
adapters call an explicitly unrestricted guest view without mapping names such
as `DIR` or `COPY` to Linux applets. No guest path may spawn a host shell.

### OS runtime ownership and lifecycle

Issue #20 is specified in [the OS Presence design](os-presence.md). Every
ComputerRuntime entry owns one bounded `OsRuntimeState`; Linux command, proc,
login, service, mount, device, and journal views must be rendered from that
instance. A command adapter must not cache a second process or service table.
Process start, state change, cycle accounting, signal, exit, job completion, and
reaping each need an explicit transition. PID 1 is protected, and a completed
job owns its zombie until `wait` or `fg` consumes it.

The normal scheduler is also the process execution owner. STOP removes a process
from CPU service in O(1) while timers and event delivery continue to advance;
CONT restores runnable service without rewriting guest elapsed time. Background
admission is limited to one interactive `sleep`, Python, or `run` command and
must complete all parse, credential, job-table, scheduler, and capacity checks
before creating a process or side effect.

Shutdown and reboot use the fixed stopping-entry set, not an O(N) per-tick scan.
The phase order is signal, owned-work drain, accepted block-I/O drain, data
sync, unmount, service/device stop, final sync, and termination. Each phase has
a 200-tick deadline and every failure calls the one fault finalizer. The final
sync request and intent-prepared journal records are appended before the one
final callback and included in its cold snapshot; do not append an unsaved
success record afterward. On marker or callback failure, identity-remove those
provisional journal objects before the fault finalizer and resynchronize the
record. Preserve unrelated callback diagnostics, and verify that the later
dirty-record retry persists the fault but neither provisional marker. A shell
`sync` request must reach `ComputerHost.flush`; never restore a success-only
stub. `ComputerRuntime.safeBoot()` is the one-shot recovery owner: it preserves
and bypasses `/startup.py`. Keep the production adapters state-gated. The Web
power action may become `safe_boot` only while lifecycle is `crashed`; Bedrock
may invoke it only when a player sneaks while opening a crashed Computer. A
normal interaction must leave the crash intact and explain that gesture. Do not
add a guest-shell or MCP safe-boot command, and do not implement recovery by
resetting or mutating the startup file.

Snapshot schema 2 stores the cold Linux runtime projection and the DOS runtime
aggregate as optional versioned fields. Legacy absence is valid. Cold Linux
state retains journal, last-login, service/mount definitions, and offline device
identity but clears processes, jobs, sessions, active mounts, and transient
cursors. Cold DOS state preserves C: and its FAT metadata while detaching A: and
discarding metadata for that media generation. Restore and migration must be
strict, idempotent, and complete before the identity-last activation boundary.

`OsRuntimeState.network` is an optional, empty-by-default future-adapter
boundary. Keep interface/address/socket/listener identity in its Map-backed
indexes and respect the defaults of 8 interfaces, 32 addresses, and 64 sockets.
Mutations must validate capacity and references before changing the outer OS
revision. Cold projection retains interface/address definitions while forcing
links down and counters to zero, and drops process-owned sockets/listeners. When
unused, omit the nested key so a legacy snapshot and a new empty snapshot remain
canonical. This boundary does not authorize a default `lo`/`eth0`, packet
routing, a route/DNS table, or guest `ip`/`ping`/`ss` output.

`Verify:` Run:

```powershell
npx vitest run tests/os/osRuntimeState.test.ts tests/os/osNetworkState.test.ts tests/os/dosRuntimeState.test.ts tests/os/dosPresence.test.ts tests/os/dosBatch.test.ts tests/computer/osRuntimeOwnership.test.ts tests/computer/osRuntimeProcessOwnership.test.ts tests/computer/backgroundJobs.test.ts tests/computer/gracefulLifecycle.test.ts tests/runtime/schedulerPause.test.ts tests/computer/snapshotMigration.test.ts
```

`Expect:` Ownership, OS/network/DOS capacity rollback, STOP/CONT, cold
projection, stale-media rejection, bounded BAT control flow, lifecycle ordering,
durability failure, safe boot, and optional-field migration all pass without
partial state inside each tested transaction boundary or fabricated network
behavior. DOS capacity rejection and post-mutation failures in single writes,
`MD`/`RD`, wildcard `COPY`/`REN`/`DEL`, `MOVE`, `ATTRIB`, FAT updates, and the
cold-state observer restore exact filesystem/FAT snapshots, inode/link identity,
revisions, free-space accounting, and blob-pool metrics. Observer rejection also
restores and republishes drive selection, per-drive current directories, the
shell prompt, labels, and lazily created FAT entries. A multi-operand `MD` uses
one outer transaction. Explicit async callbacks execute nothing; disguised
Promise/thenable callbacks restore their owner-scoped pre-await mutations and
enter one shared settlement quarantine. Every managed filesystem and DOS
aggregate rejects mutation during that window, so an async continuation cannot
escape through a second owner or across the filesystem/DOS boundary after the
original stack frame has unwound.

Focused verification is:

```powershell
npx vitest run tests/os tests/editor
```

`Verify:` Run `printf 'alpha\nbeta\nalpha\n' | grep alpha | wc -l > count`
through a `terminal_line` event, then run `cat count`.

`Expect:` `/home/cs/count` contains `      2\n`, the terminal shows `2`, the
runtime returns to explicit unfiltered `waiting_event` ownership for line or key
input, and no host process is created.

Computer state is stored through World Dynamic Properties; on BDS this is
physically part of `worlds/<level-name>/db` LevelDB, not SQLite or individual
host files. A clean persistence check compares the Computer's component revision
token in O(1). The in-memory filesystem keeps a parent-to-child index and cached
used-byte count; writes update those values with the mutation. A dirty Computer
is still committed as a copy-on-write paged JSON generation with a manifest and
checksum. The current and previous complete generations are retained, older and
abandoned indexed generations are deleted, and load falls back one generation on
corruption. SQLite may be implemented later behind `ComputerSnapshotRepository`
for a non-Bedrock host, but cannot be the Bedrock add-on's direct store because
Script API has no SQLite/filesystem access. The default capacity is 1,000,000
UTF-8 bytes, with 256,000 bytes per file and 4,096 entries. Every write enforces
those limits before commit. `quota` exposes them, while `du` walks only the
requested bounded subtree rather than materializing or repeatedly scanning an
unrelated whole-filesystem snapshot.

### Preserved-world storage migration

The Bedrock startup path owns one bounded migration before it enables Computer,
Portable, Monitor, or Web Terminal behavior. The paged-store reader recognizes
both schema-1 indexed pages (`:page:<generation>:<index>`) and schema-2
content-addressed blobs. It always validates the current head first, including
the manifest, page bounds, checksum, JSON, and payload type, and falls back only
to the immediately previous generation when the current generation is not
complete. A valid previous generation may use either storage format.

Every valid identity store triggers a scan of its referenced Computer payloads;
payload migration versioning is independent from the identity page format. The
coordinator validates the schema-2 registry and processes at most 4,096
observations. For each referenced Computer, it loads with the same
current-first/fallback rule, cold-normalizes current payloads and converts
schema-1 Computer/filesystem payloads into the inode/content-blob schema. A
changed payload is written as one content-addressed generation and read back for
verification. A legacy identity head remains the activation marker until all
Computer work terminates, then is saved and verified in current format. An
already-current healthy identity head is not rewritten merely for the scan. If
the loader recovered either a Computer or identity from the immediately previous
current-format generation, that fallback is saved into the invalid head slot and
must reload with `recovered: false` before completion. The process preserves
IDs, families, block/item observations, OS and hardware profiles, display
profile, terminal state, filesystem metadata, symbolic links, and hard-link
sharing; it does not renumber `computer-N` identities or accept an unsupported
identity payload.

After selecting a valid canonical head, startup also validates the immediately
previous manifest. A corrupt previous manifest cannot invalidate or rewrite the
head: the store repairs a representable fallback or removes the invalid previous
metadata. Recovered-head work owns a bounded orphan sweep for target-generation
content blobs, schema-1 indexed pages, and stray manifests that corrupt metadata
can no longer name. It enumerates only those relevant prefixes during repair and
then deletes at most one candidate per step. The ordinary periodic-save path
performs no prefix-wide key enumeration, so its cost stays proportional to the
bounded generation being written rather than total historical storage. The
writer preflights its page count before splitting and checks the actual
generation's serialized manifest before target cleanup; either reader/property
limit therefore fails before a storage mutation.

`ComputerHost` advances this state machine with a budget of one Dynamic Property
read/write/delete per host tick in the persistence WorkMonitor lane. Progress,
completion, and failure are observable through transition-only
`CS_STORAGE_MIGRATION` JSON records and player messages. A failed migration does
not start the normal Bedrock adapters. On restart, the legacy identity head
causes a bounded rescan; already committed and verified current-format Computer
heads are skipped, so the process is idempotent without maintaining a second
world index.

Before deploying a migration-capable pack into a preserved world:

1. Stop BDS cleanly and wait until the process has exited and its UDP/TCP ports
   are closed.
2. Copy the complete stopped `worlds/<level-name>` directory to a timestamped
   backup outside the managed runtime. Do not copy a live LevelDB and never edit
   its keys directly.
3. Build the packs, start the same world without resetting it, and wait for a
   terminal `CS_STORAGE_MIGRATION` record before allowing player interaction.
4. Verify representative old Computers, files, metadata, links, labels, OS and
   hardware profiles, then stop and restart once more to prove the current
   identity head loads without another conversion.

`Verify:` Run
`npx vitest run tests/phase0/transactionalPagedStore.test.ts tests/computer/snapshotMigration.test.ts tests/computer/storageMigration.test.ts`.

`Expect:` Current-head and previous-generation loading, current-format fallback
head repair, corrupt-previous repair, recovery-only orphan
blob/indexed-page/manifest cleanup, writer/reader page and manifest limit
symmetry, strict schema-1 conversion, one-property-operation steps,
ordinary-save zero-prefix-scan behavior, identity-last failure safety, restart
idempotence, and fresh-world no-op behavior all pass.

## Headless Bedrock verification

Download and extract the official Bedrock Dedicated Server distribution, then
point `BDS_HOME` at the extracted directory. Downloading the server constitutes
acceptance of the Minecraft EULA and Privacy Policy, so the repository tooling
does not download it automatically.

```text
$env:BDS_HOME="C:\path\to\bedrock-server"
npm run test:bds
```

The runner copies the distribution into a new isolated directory under
`~/tmp/computer-system-bds/`; it never modifies `BDS_HOME`. It creates a test
world, installs both Phase 0 packs, runs the stable Script API probes twice, and
requires both the World Dynamic Property sequence and non-stackable ItemStack
identity to survive the server restart. Every suite branch must emit a
`CS_PROBE_RESULT` terminal record. The runner uses an allowlist and keeps Xbox
Live authentication enabled so no player can join the isolated server.

The harness was verified against Bedrock Dedicated Server 1.26.33.2. Both
sessions completed with 20 computers receiving exactly 2,000 instructions over
40 ticks, and the Dynamic Property sequence advanced from 1 to 2 after restart.
The final Phase 0 bundle was 48,776 bytes. Both sessions measured every
scheduler tick below the millisecond clock resolution, stayed within the 50 ms
tick budget, and emitted zero memory warning signals. Both sessions also passed
transactional turtle operations, two pitched sound calls, six-face redstone
input sampling, all 64 independent digital output masks, all 16 Redstone
Interface analog levels, and simultaneous analog levels 4 and 12. Turtle probes
rejected occupied, unloaded, and conflicting moves without leaving an active
resource lease. The second session recovered the Portable Computer System
ItemStack identity written by the first, including placed-block and
block-to-item identity round trips. The custom item is parsed in the current
direct-component format and is verified as non-stackable before any Dynamic
Property is written.

The arena loader polls a fixed set of required chunks for at most 40 ticks. Each
redstone output transition settles for at most eight ticks. These bounds prevent
startup races without turning either path into an unbounded retry loop.

The default isolated runtime is the stable
`%USERPROFILE%\tmp\computer-system-bds\runtime` directory. The runner safely
recreates this one managed directory on each run, so Windows Firewall can retain
a single application-path rule. Set `BDS_WORKDIR` only when a different explicit
empty work directory is preferred. The runner refuses a non-empty custom
directory and never recursively deletes it.

The remaining player-experience checks are listed in
[the manual verification checklist](manual-verification.md).

For persistent command execution and log inspection through Codex rather than
the Minecraft chat UI, use the local
[Bedrock MCP debug companion](mcp-debugging.md).

## Authored machine artwork

Keep the original machine illustrations in `web/assets/machines/` and the CPU
identification plates in `web/assets/cpu/`. The Web Terminal serves both sets
directly in the manual's stable `architecture` chapter (published as Chapter
09). During `npm run build`, `tools/machine-textures.mjs` validates each machine
source as a bounded, non-interlaced 4-bit indexed PNG, removes its pure-white
canvas, and scales the visible content into a transparent 256 by 256 RGBA item
icon. The work is O(source pixels + 256 squared) for each of the fixed four
machine assets, and malformed, oversized, or unsupported inputs fail the build
explicitly.

Do not map the isometric machine plates directly onto block faces: they are
manual and inventory artwork, not six-face UV textures.
`tools/machine-block-assets.mjs` instead generates bounded custom geometry and
purpose-built 16 px block textures for Desktop, Advanced Desktop, Monitor, and
the open-laptop Portable Computer System. It also generates the terrain atlas.
All four blocks use `minecraft:placement_direction` and cardinal transformation
permutations. Programmatic Computer and Portable placement sets the same state,
and redstone mask swaps preserve it. Desktop bodies occupy 15.5 by 16 by 14.5
model units so they read as larger base units beneath the Monitor. Resource
artwork changes require a Resource Pack version increment so connected clients
fetch the new files.

Desktop Web Terminal requests require exactly one physically adjacent Monitor.
Touching a connected Monitor resolves its adjacent desktop rather than a stale
global target; zero and multiple candidates terminate with explicit messages.
Placed access is valid only within a three-block Euclidean radius of the touched
Computer, Monitor, or Portable block. Range or dimension failure transitions the
bounded session to `out_of_range` and rejects input without finalizing it;
returning transitions it to `in_range` and requests one eager snapshot. The
existing bounded round-robin scheduler performs the proximity check, and the
bridge emits work only when the access state changes. Permanent four-digit codes
are indexed for O(1) lookup. Browser bookmark retries are deduplicated, use
exponential backoff with jitter capped at ten seconds, and stop at the session's
30-minute deadline. Portable Computer System items can be used directly or
placed as `computer_system:portable_computer_block`; the item/block round trip
must retain the same identity and the portable CS386SX/CS-DOS profile.

After activating both packs in a test world, run:

```text
/scriptevent computer_system:probe status
```

The script should acknowledge the probe in chat. The Dedicated Server console
uses `scriptevent computer_system:probe headless` for the complete automated
suite.

## Headless verification rubric

Virtual hardware is part of the Computer snapshot. Standard Desktop snapshots
use CS486DX at 33 MHz/2 MiB, Advanced Desktop snapshots use CS486DX2 at 66 MHz/8
MiB, and Portable snapshots use CS386SX at 16 MHz/2 MiB. Exactly recognized
former defaults migrate to their family profile; customized hardware remains
authoritative. CPU clock is converted to per-tick CPU-cycle credit, then the
global scheduler cap arbitrates mixed-speed Computers in round-robin order.

`CpuMemoryHierarchy` is recreated cold for every shared CS process. CS386SX has
no cache and charges two 16-bit transfers for even dwords or three for odd
dwords. CS486DX/DX2 use a fixed 8 KiB four-way unified L1 with 16-byte lines and
write-through stores; DX2 adds a fixed 256 KiB external L2. Tags, recency,
prefetch state, and counters are transient and O(1) per access. Taken control
flow records a deterministic prefetch/pipeline flush; no profile claims dynamic
branch prediction. Keep exact alignment, locality, eviction, cold-start, and
branch-direction tests whenever timing changes.

Display hardware is a separate versioned snapshot field. Portable uses
`portable-vga-256k`; Standard Desktop uses `desktop-vga-512k`; Advanced Desktop
uses `advanced-vga-512k`. All modes stop at 640x480. The Portable's 800x480 LCD
is a physical presentation surface, not a guest resolution. `DisplayDevice`
allocates its 256/512 KiB VRAM lazily when CSBIOS enters POST, clears only the
new active frame on a mode change, and releases VRAM at power-off. Its fixed
dirty ring bounds both tile count and payload bytes; write marking is O(1) and a
batch drain is O(D). Do not include framebuffer revision or data in
`ComputerRecord.persistenceRevision`, snapshot JSON, or Dynamic Properties.

`ComputerRuntime.powerOn()` leaves an observable 80x25 CSBIOS POST frame. The
next `runTick()` owns the single handoff to text mode and guest execution. Every
error branch faults the display explicitly, while completed shutdown/reboot
releases it. Host tests must verify the minimal post-handoff screens: CS-DOS
identity, blank line, and `C:\>`; CS-Linux identity, blank line, and its
password or shell prompt. Neither OS prints a simulated tty name or startup
shell banner. The graphics Web protocol is intentionally later: generate each
Computer delta once and fan it out to sessions instead of serializing a full
640x480 framebuffer per viewer.

Python-generated CS486 instructions, managed-runtime syscalls, native calls, and
other CS486 execution all return deterministic cycle debt to the same process.
RAM enforcement scans the live object graph only under allocation pressure,
keeping the common allocation path O(1) while making the uncommon reclamation
check O(N) in reachable objects. Disk quota remains an independent filesystem
concern.

CS486DX and CS486DX2 programs use a separate verified register-machine
executable under the same Computer hardware limits and CPU-cycle budget. Their
persisted and visible clocks are 33 MHz and 66 MHz. `run --stats` is the
deterministic optimization measurement: compare CPU-cycle totals and virtual
microseconds, not host wall time or language-specific instruction counts.
Executables are JSON preceded by `CS486\n`, validated again at load, and never
passed to a host process. Normal terminal execution is a resumable foreground
scheduler job capped at 100,000 instructions and returns exit 124 on a bounded
yield. The scheduler also enforces per-Computer and global instruction ceilings
on every tick.

Host-load admission and remaining scale risks are specified in
`docs/work-monitor.md`. Keep deterministic guest timing separate from measured
host time; WorkMonitor guards may defer a bounded atom but must never alter its
modeled CPU cycles or device-wire timing.

Relocatable objects are versioned JSON preceded by `CS486OBJ\n`. The assembler
pipeline is a dedicated tokenizer, bounded preprocessor, parser,
constant-expression evaluator, and semantic assembler. Semicolons begin comments
only outside strings; LF and CRLF normalize to the same token stream. Includes
resolve relative to the canonical source path through the process's credentialed
guest filesystem. Before allocation grows, preprocessing permits at most
1,000,000 aggregate source characters, 100,000 lexical tokens, 64 include files
at depth 8, 256 macros at expansion depth 16, 32 parameters per macro, and
100,000 expanded tokens.

New writers emit `CS486OBJ` v2 with `.text`, `.rodata`, `.data`, and `.bss`
sections, initialized little-endian bytes, alignment, local/global/undefined
typed symbols, optional `()->i32`/`()->void` function signatures, and structured
`text-target`, `data-address`, and `absolute32` relocations. ASM may declare a
known zero-argument return with `signature name, i32|void`; omitting it retains
untyped compatibility. Readers retain v1 compatibility. The static linker
resolves both global and object-local definitions through precomputed maps,
computes each data layout once, and produces a validated executable in
O(instructions + initialized bytes + symbols + relocations) work. It never
reparses or regex-rewrites assembly text. Object counts, instructions,
initialized bytes, total static data, alignment, symbol types, and relocation
targets are bounded and fail explicitly. The stack grows down from the top of
process RAM and faults before it crosses the aligned `.rodata`/`.data`/`.bss`
boundary. `.rodata` is a layout category, not an MMU-enforced read-only page.

The current ABI supports zero-argument functions returning an integer in EAX or
returning no value. C/C++ definitions and declarations serialize that
distinction; the linker rejects conflicting known signatures, while one untyped
v1/ASM side remains intentionally compatible. Inline C/C++ assembly is a
statement-boundary escape hatch and rejects labels, branches, calls, stack
operations, and ESP/EBP access. `CS486OBJ` is not ELF or OMF; `CS486` is not DOS
COM/EXE or native x86. Dynamic loading remains deliberately unsupported until
this ABI has stable field evidence.

The C-family frontend begins with the bounded token preprocessor in
`cs486CPreprocessor.ts`. Include callbacks are injected by the shell and read
only through the credentialed guest filesystem. Both direct shell compilation
and deferred ComputerRuntime compilation must pass identical `-I/-D/-U` or DOS
`/I,/D,/U` options, `INCLUDE` directories, source names, provenance, and work
accounting. Never add a host include fallback. Macro rescan, conditional,
include, source, token, and diagnostic limits must be checked before an array or
recursive path grows. Unsupported syntax must terminate explicitly.

C++ deliberately emits the same unmangled CS ABI as C. Individual `extern "C"`
declarations are accepted as an explanatory spelling; linkage blocks, other
linkages, parameters, member functions, overloads, and C++ name mangling are not
implemented. ASM interoperation is therefore limited to the zero-argument
EAX/void contract and optional `SIGNATURE`. Do not document MASM, near/far, OMF,
DOS extender, or Microsoft library compatibility.

CS-DOS Program Lists are parsed by `csDosProgramList.ts` and resolved again to
canonical credentialed guest paths in `ShellCommandRuntime`. The parser bounds
lines, sources, objects, includes, definitions, and paths. The runtime must
repeat collision checks after path resolution because `APP.CSX` and `.\\APP.CSX`
can name the same file. Per-unit fingerprints include source, transitive
headers, options, and compiler identity. Generated objects, executable, listing,
map, and `.CBR` ownership metadata commit in one DOS filesystem transaction;
failure retains the last good artifact but the IDE marks Run Last stale. Clean
trusts only a valid record for that exact project and never deletes authored or
unowned paths. Deferred CS386SX builds remain one bounded foreground compile
task with one finalization owner.

CS QBASIC uses the same compiler/runtime only as a transient source-run path.
F5, Ctrl+F5, Shift+F5, and `/RUN` must not install OBJ, CSX, or EXE output. Its
menus and help must not imply Make or Debug capabilities.

Computer System Python no longer uses a bytecode VM. `pythonCs486.ts` resolves a
bounded module graph, compiles Python control flow to CS486 instructions, and
uses the allowlisted `python` syscall for managed values and native modules.
Same-directory `.py` files and the Linux/DOS Python library paths initialize at
most once. A valid `CS486OBJ` `.o` file can be imported as a static extension;
its global zero-argument integer functions execute in the caller's CS486 process
and return through EAX. A known `()->void` export is not exposed as a Python
attribute; untyped legacy functions remain compatible. Module discovery and
linking are linear in source, modules, symbols, and relocations; missing,
circular, oversized, corrupt, and ABI-incompatible imports terminate explicitly.

The native `shell` module is deliberately execution-role scoped. Only the
built-in shell program selected by an empty `/startup.py` receives it. A
user-authored `/startup.py`, a foreground Python process, and an MCP Python
probe must all reject `import shell`; never pass a live `ShellSession` into
those contexts.

`Verify:` Run the scheduler, runtime-limit, shell, DOS-profile, and persistence
tests.

`Expect:` Mixed CPU profiles receive distinct bounded credits, native work
consumes credits, RAM overflow becomes `MemoryError` and unreachable data is
reclaimed, Linux/DOS hardware commands agree, and legacy/current snapshots load.

`Verify:` Run `npm run validate`.

`Expect:` Formatting, lint, type checking, all host tests, and the pack build
all exit successfully.

`Verify:` Set `BDS_HOME` and run `npm run test:bds`.

`Expect:` Both isolated sessions end in a `suite/PASS` terminal record; the
second session reports storage sequence 2, persisted item identity, six input
faces, 64 digital output masks, 16 analog levels, rejected turtle conflict and
unloaded movement, and runtime minimum/maximum 2,000. The summary also reports
the bundle byte count, average and maximum scheduler tick duration, the 50 ms
budget result, and zero memory warning signals.

`Verify:` Start one turtle operation while holding a lease on its destination,
then target an unloaded coordinate and inject a failure after world mutation.

`Expect:` The results are `conflict`, `unloaded`, and `rolled_back`; the source
marker remains intact and the active resource count returns to zero after every
terminal branch.
