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
The browser derives the display-surface width, height, and IBM VGA 9x16 font
size from one bounded fit of the 80x25 guest grid plus one blank raster row at
each vertical edge, then centers that bezel-free surface on both axes. The
blanking rows remain outside the guest screen and therefore do not alter cursor
or TUI pointer coordinates. The shared active-raster wrapper treats the 9x16
80x25 text/TUI surface as 720x400 logical pixels and applies a 0.8 horizontal
correction so the complete 27-row glass area is exactly 4:3. The pure layout
helper keeps correction mode-specific: 640x480 VGA is 1.0 and 320x200 is 5/6. No
CS Windows graphics surface is implemented yet. The active-page Options dialog
applies one of four bounded CRT profiles and an independent Flat or Curved Glass
shape to a single optical wrapper. Curvature is 0-30% with a 2% page default;
the same normalized value sets the SVG displacement scale and the inverse TUI
pointer transform. Presentation state remains in memory, does not add
per-snapshot work, does not mutate the logical palette, and does not create a
second screen representation. The fixed browser surface has no internal
scrollbar, while guest-rendered editor scrollbars remain canonical cells. The
companion-host one-action workflow is automatic when the published host is a
literal IP assigned to the server and no custom public origin is configured. Use
`WEB_COMPANION_AUTO_OPEN=0` to disable it or `1` to enable it explicitly while
retaining the local-listener requirement. Interacting with a Desktop or Advanced
Desktop Computer System, or using a Portable Computer System, opens its
activated path through loopback in the host's default browser. This checks the
server address rather than the initiating player's IP. Remote players receive
the detected LAN entry page and the Computer's permanent four-digit number. An
interaction activates that number once for two minutes; invalid guesses and
active collisions are bounded.

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

Every terminal frame carries a schema-1 `TerminalInteractionDescriptor` derived
from authoritative guest state. It selects `terminal_line`, bounded
`terminal_keys`, or disabled input and separately declares pointer admission,
secret masking, interrupt availability, presentation, help, and contextual key
hints. The browser and companion must never infer those semantics from rendered
rows. Writer-only `web-complete` carries the current draft and cursor to the
guest shell. `ShellSession` owns command/path discovery and bounded column
formatting; ambiguous candidates are written through the authoritative
`TerminalBuffer` before the prompt and unsubmitted draft are redrawn. The
companion returns only the resulting draft/cursor outcome, never a browser-owned
candidate list. Input before the first descriptor fails with
`409 terminal_not_ready`; a missing or unsupported schema fails with
`426 interaction_protocol_mismatch`, exposes `RELOAD REQUIRED`, and requires the
behavior pack, companion, and cached Web client to be updated together before
reload. There is no heuristic compatibility fallback. The compatibility
`web-resize` boundary accepts only 80x25 and normalizes that fixed hardware text
mode once per writer session; later browser resizes change CSS scale, never
guest cell geometry. CS-Linux 1.0 parses a bounded Computer System Bash language
with pipelines, redirects, control operators, quoting, variables, positional
parameters, conditionals, loops, and functions. Production first boot sets the
initial `cs` password twice; later boots ask for a username and that account's
password. The salted record is stored in root-readable `/etc/shadow`, while
secret Web input is masked and excluded from history and completion. `cs` owns
UID/GID 1000 and `/home/cs`, belongs to `sudo`, and may add bounded users and
groups through authenticated elevation. UID/GID 0 root starts password-locked.
UID 1000 is the protected boot-service account: its name and home may change
only while it is inactive, but it cannot be deleted. Desktop boot creates the
existing-file boundary `/startup.py` as mode 0644 and owned by that account,
without making the root directory writable. A blank file runs the built-in shell
program; non-empty saved source runs on later boots with the account database's
current UID 1000 groups.

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
Portable, or Web Terminal behavior. The paged-store reader recognizes both
schema-1 indexed pages (`:page:<generation>:<index>`) and schema-2
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
icon. The work is O(source pixels + 256 squared) for each of the fixed three
machine assets, and malformed, oversized, or unsupported inputs fail the build
explicitly.

Do not map the isometric machine plates directly onto block faces: they are
manual and inventory artwork, not six-face UV textures.
`tools/machine-block-assets.mjs` instead generates bounded custom geometry and
purpose-built 16 px block textures for the all-in-one Desktop, all-in-one
Advanced Desktop, and open-laptop Portable Computer System. It also generates
the terrain atlas. All three blocks use `minecraft:placement_direction` and
cardinal transformation permutations. Programmatic Computer and Portable
placement sets the same state, and redstone mask swaps preserve it. Desktop
bodies occupy one block and combine the system base, square CRT housing, and
built-in screen. The upper housing is a rectangular cuboid with a flat top,
vertical rear/side faces, and crisp 90-degree physical corners; Computer has one
right-mounted 3.5-inch drive and Advanced has two. Resource artwork changes
require a Resource Pack version increment so connected clients fetch the new
files.

Desktop Web Terminal requests resolve directly from the touched all-in-one
Computer or Advanced Computer. There is no standalone Monitor block, item, or
adjacency topology. Placed access is valid only within a three-block Euclidean
radius of the touched Computer or Portable block. Range or dimension failure
transitions the bounded session to `out_of_range` and rejects input without
finalizing it; returning transitions it to `in_range` and requests one eager
snapshot. The existing bounded round-robin scheduler performs the proximity
check, and the bridge emits work only when the access state changes. Permanent
four-digit codes are indexed for O(1) lookup. Browser bookmark retries are
deduplicated, use exponential backoff with jitter capped at ten seconds, and
stop at the session's 30-minute deadline. Portable Computer System items can be
used directly or placed as `computer_system:portable_computer_block`; the
item/block round trip must retain the same identity and the portable
CS386SX/CS-DOS profile.

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

`ComputerRuntime.powerOn()` starts an observable, deterministic 80x25 CSBIOS
state machine. At 20 TPS its 70-tick schedule is black -> CS-VGA -> black ->
`CSBIOS Revision 1.1` and at most eight same-row memory updates -> factual
device detection -> explicit fixed-disk/floppy source and OS target -> handoff
black -> `Starting ...` -> guest handoff. Every phase is driven by the scheduler
tick, advances at most one visible stage per admitted Computer pass, and keeps
aggregate work bounded to 64 Computers per tick. It never uses wall-clock delay
to rewrite guest timing.

Until the final handoff, the Computer lifecycle remains `booting`, its scheduled
VM is paused, and terminal/debug input is unavailable. BIOS output is mirrored
to both `TerminalBuffer` and `DisplayDevice` with the cursor hidden, and it may
report only the active CPU, RAM, VGA/VRAM, floppy state, disk quota, boot
source, and target. Do not add AMI vendor text, an unsupported setup prompt, or
a fabricated FPU. Every cancel, shutdown, detach, reboot, and error branch owns
explicit sequence finalization; an error faults the display, while completed
shutdown/reboot releases it.

At successful handoff, clear the BIOS frame once, ensure the prepared OS runtime
is `running`, transition the Computer to `running`, and unpause the guest. Host
tests must verify the minimal post-handoff screens: CS-DOS identity, blank line,
and `C:\>`; CS-Linux identity, blank line, and its password or shell prompt.
Neither OS prints a simulated tty name or startup shell banner. The graphics Web
protocol is intentionally later: generate each Computer delta once and fan it
out to sessions instead of serializing a full 640x480 framebuffer per viewer.

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
passed to a host process. Non-hosted terminal execution is a resumable
foreground scheduler job capped at 100,000 instructions and returns exit 124 on
a bounded yield. A CS-Linux legacy version-4 word executable or current
version-5 model-declared executable launched through the hosted foreground `run`
path instead remains a tick-sliced CS ABI 1.0 process until `main` returns,
`exit` completes it, or its lifecycle owner terminates it. The scheduler still
enforces per-Computer and global instruction ceilings on every tick.

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

New writers emit data-model-declared `CS486OBJ` v4 with `.text`, `.rodata`,
`.data`, and `.bss` sections, initialized little-endian bytes, alignment,
local/global/undefined typed symbols, bounded signatures such as
`(i32,i64)->i64`, `(i32,...)->i32`, and `()->void`, and structured
`text-target`, `data-address`, and `absolute32` relocations. ASM may declare a
known return/parameter contract with
`signature name, i32|i64|void[, i32|i64 ...][, varargs]`; omitting it retains
untyped compatibility. Readers retain v1-v3 word-object compatibility. The
static linker rejects mixed models before layout, resolves both global and
object-local definitions through precomputed maps, computes each data layout
once, reserves the first data word so no authored symbol equals the null
pointer, and produces a validated executable in O(instructions + initialized
bytes + symbols + relocations) work. It never reparses or regex-rewrites
assembly text. Object counts, instructions, initialized bytes, total static
data, alignment, symbol types, and relocation targets are bounded and fail
explicitly. The stack grows down from the top of process RAM and faults before
it crosses the aligned `.rodata`/`.data`/`.bss` boundary. `.rodata` is a layout
category, not an MMU-enforced read-only page.

The `cs486-cc2` ABI supports up to 32 physical argument words. Callers evaluate
arguments deterministically, push them right-to-left, and clean the stack after
the call; callees read `[ebp+8+4i]` and preserve ESI, EDI, and EBP. One-word
results use EAX. Two-word `i64` and `f64` results and values use low-word-first
layout, with EAX low and EDX high on return. `f32` occupies one physical word.
Variadic calls insert a checked variable word count after the fixed words, and
`<stdarg.h>` consumes exactly the declared word width. `calli` validates an
executable function entry and its complete signature before pushing a return
address. C/C++ definitions and declarations serialize parameter and return
types; the linker rejects conflicting known signatures, while one untyped v1/ASM
side remains intentionally compatible. Inline C/C++ assembly is a
statement-boundary escape hatch and rejects labels, branches, calls, stack
operations, and ESP/EBP access. `CS486OBJ` is not ELF or OMF; `CS486` is not DOS
COM/EXE or native x86. Dynamic loading remains deliberately unsupported until
this ABI has stable field evidence.

CS C defaults to `cs-word32-v1`: `CHAR_BIT=32`; signed/unsigned `char`, `short`,
`int`, `long`, and pointers occupy one word, while signed/unsigned `long long`
occupy two low-word-first words. `cs-byte8-v1`, selected with `-mbyte8`, uses
8-bit char, 16-bit short, 32-bit int/long/pointers, 64-bit long long, and
natural little-endian byte layout. Pointer arithmetic, `sizeof`, alignment,
arrays, structs, unions, promotion, truncation, initialized data, and NUL
strings derive only from the declared model. Word strings remain 32-bit code
points; byte strings are packed bytes. Both layouts are bounded Computer System
ABIs, not native x86 ABIs. Rootfs v19 installs model-aware headers and per-model
libc/libcurses/libm static libraries; v17 and the pre-floating v18 payload
remain immutable.

CS C `float` is binary32 and `double` is binary64; `long double` aliases
`double`. Both data models use little-endian bits and four-byte alignment. The
bounded software core in `deterministicFloat.ts` performs parsing, packing,
arithmetic, conversions, comparison, classification, decomposition, scaling,
fixed-decimal formatting, and square root with BigInt integer/rational work and
round-to-nearest ties-to-even. Host `Number` arithmetic, host libm, locale,
WebAssembly, and native addons are not result authorities. Compiler folding and
runtime `cs.fp.*` operations call the same core. The latter run inside the
admitted CS486 process, charge fixed operation cycles plus modeled guest-memory
access, and retain process-local invalid/divide-by-zero/overflow/underflow/
inexact status.

Rootfs v19 `<float.h>` and `<math.h>` expose the exact limits and the initial
guest libm surface: `fabs`, `copysign`, integral rounding, `fmod`, `sqrt`,
`ldexp`, `frexp`, `modf`, and classification, including appropriate `f`
variants. libc `%f` default-promotes `float` to a two-word `double`, defaults to
six fractional places, and caps precision at 18. Trigonometric, exponential,
logarithmic, `pow`, complex, mutable `<fenv.h>`, x87/SIMD, and fast-math remain
explicitly unsupported.

`csAbi.ts` owns hosted startup and syscall state. Validate the complete guest
memory range before admission, then perform every terminal or filesystem atom
inside exactly one `runHostWork` call. A rejected admission returns `EAGAIN`
without changing a descriptor position, guest result buffer, terminal frame, or
filesystem revision. Open, seek, stat, remove, rename, and file reads/writes all
belong to the block-I/O lane. Standard output is line-buffered; guest `fflush`
uses a zero-unit write to descriptor 1, while stderr is unbuffered. The
64,000-unit output ceiling counts admitted stdout and stderr over the whole
process, not merely the currently buffered string. `ComputerRuntime` is the only
finalization owner: normal return, `exit`, signal, terminal close, shutdown, and
detach clear waits/descriptors and release the executable RAM lease once.

Rootfs v17 extends that ABI with selectors 16–25 for wall-clock time, working
directories, directory creation/removal, access checks, bounded directory
iteration, and extended stat metadata. Wall-clock time is injected separately
from deterministic guest CPU ticks. CWD, directory snapshots, and metadata
operations stay inside the block-I/O admission lane: opening a directory takes
one bounded O(N) snapshot (at most 256 entries), `readdir` is then O(1), and a
process may own at most eight directory descriptors. Rootfs v16 remains an
immutable historical image and does not acquire the v17 headers or sources.

The v17 hosted library adds bounded `qsort` (O(N log N) heapsort), `bsearch`
(O(log N)), `atexit`, getopt, filesystem/time wrappers, a synchronous
`signal`/`raise` subset, and fixed-format printing. The CS ABI cannot yet return
or pass aggregates by value, so `div` writes through a caller-provided `div_t *`
and `vsnprintf` accepts `va_list *`; document these profile deviations rather
than implying native ISO C compatibility. The linker bootstrap runs registered
exit handlers after a normal `main` return. `libcs-curses` is likewise bounded:
an 80×25 screen, `stdscr` plus seven allocated windows, 16 color pairs, a
1,024-word format buffer, one terminal frame per refresh, and explicit
`ENOMEM`/`ERR` results when a limit is reached.

The C-family frontend begins with the bounded token preprocessor in
`cs486CPreprocessor.ts`. Include callbacks are injected by the shell and read
only through the credentialed guest filesystem. Both direct shell compilation
and deferred ComputerRuntime compilation must pass identical `-I/-D/-U` or DOS
`/I,/D,/U` options, `INCLUDE` directories, source names, provenance, and work
accounting. Dynamic `__FILE__` and `__LINE__`, variadic macros, `#pragma once`,
and `#line` retain authored spans and normalized include identities. Never add a
host include fallback or live host `__DATE__`/`__TIME__`. Macro rescan,
conditional, include, source, token, and diagnostic limits must be checked
before an array or recursive path grows. Unsupported syntax must terminate
explicitly.

`cs486Archive.ts` owns current version 2 `CS486AR`: canonical validated CS486OBJ
members, SHA-256 member digests, one bounded global-symbol index, explicit
`cs-word32-v1` or `cs-byte8-v1` identity, archive checksum, and deterministic
compressed serialization. The version-1 legacy reader fixes the archive to the
historical word model. Guest `ar` and `ranlib` trial and validate a complete
replacement before one credentialed filesystem transaction. `cc`/`ld` collect
`-L` directories once and preserve `-l` operand order; demand extraction uses
Map lookups and a capped queue rather than rescanning all members per unresolved
symbol. Full assembly transcripts remain canonical linker evidence.
Function-level pruning is allowed only for installed large-library objects
already marked with an explicitly truncated transcript.

The immutable hosted-C rootfs archives are checked-in build inputs generated by
`tools/generate-hosted-c-archives.mjs`. After changing hosted libc, curses,
libm, their headers, or archive serialization, run `npm run generate:hosted-c`
and commit the updated `generated/hostedCArchiveContents.ts`. Both
`npm run build` and the complete validation gate run `npm run check:hosted-c`
first and reject stale output. Production BDS module startup must only load
these payloads; compiling or compressing the rootfs libraries during module
evaluation exceeds the native startup watchdog.

C++ deliberately emits the same unmangled CS ABI as C. Individual `extern "C"`
declarations are accepted as an explanatory spelling; linkage blocks, other
linkages, member functions, overloads, and C++ name mangling are not
implemented. ASM interoperation uses the bounded word-argument EAX/void contract
and optional `SIGNATURE name, return[, i32 ...]`. Do not document MASM,
near/far, OMF, DOS extender, or Microsoft library compatibility.

CS-Linux Makefiles are parsed and planned by `guestMake.ts`; the implementation
must remain independent of host make, shells, processes, filesystems, and
network access. Planning is O(source bytes + indexed pattern candidates + graph
nodes + graph edges), with explicit limits on aggregate source, included files
and depth, rules/patterns, prerequisites, expansion depth, graph depth, recipes,
requested targets, output, and fingerprint input bytes. Pattern candidates are
indexed by target suffix and preserve authored order. Required and optional
includes, the documented minimal conditionals, dependency-only rule merging, and
`$*` do not open a general GNU Make evaluator. Mtime checks are reinforced by
bounded `CSMAKE2` records with SHA-256 input and output fingerprints plus an
explicit toolchain identity. Legacy `CSMAKE1`, missing, evicted, and
foreign-toolchain records are untrusted migration inputs that force rebuild;
malformed state remains an error. Each target takes a fresh pre-recipe input
snapshot, rejects inputs changed before post-build verification, and persists
its record only after recipe block I/O completes. State-write I/O failure
restores the last committed serialized state; failure of a later target does not
erase records already committed by earlier targets. After a recipe publishes a
`.d` file, the verifier reparses the bounded optional includes and commits the
resolved dependency set immediately; the next identical build is therefore a
no-op rather than a convergence rebuild.

`ComputerRuntime` owns the single foreground make PID, 128 KiB RAM lease,
bounded planning/fingerprinting after admission, one-recipe-per-tick progress,
block-I/O waits, and exactly-once completion on success, failure, interrupt,
disconnect, or shutdown. The initial planning tick may execute no recipe. A
recipe may dispatch only the documented guest toolchain, synchronous filesystem,
and output allowlist; aliases, functions, pipelines, redirects, chains,
background work, TUI/session/lifecycle commands, recursive make, and host
execution never cross that boundary. CS-DOS continues to use Program Lists and
PWB and must not gain a MAKE capsule.

The official port boundary is a checked-in or pre-generated `config.h`, one `.d`
file per object, pattern compile rules, versioned `.csa` libraries, and an
ordered final link. Autoconf, CMake, arbitrary configure scripts, recursive
Make, and parallel jobs remain unsupported. The complete executable rubric is
recorded in `docs/issues/issue-71-build-portability.md`.

CS System Git is split across `linuxGit.ts` (command/application policy),
`linuxGitRepository.ts` (validated `.git` storage), `linuxGitIgnore.ts` (bounded
pattern matching), and `linuxGitRemote.ts` (future transport port). These
modules depend only on guest/application abstractions and pure domain SHA-256;
they must never import Minecraft, Node networking, child processes, host Git, or
credential helpers. The v12 Linux image is the first immutable image containing
`/usr/bin/git`; v11 and earlier command snapshots stay frozen.

Repository work is O(scanned paths + selected content + visited history +
bounded ignore-state transitions), under explicit entry, object, byte, pattern,
output, and work ceilings. Tracked-directory membership and history queues use
sets/cursors rather than repeated serial scans. Object files are immutable and
content-addressed. Mutable index/worktree/ref changes share a bounded
synchronous filesystem transaction, and ref writes require the exact previous
OID. Reads reject unknown schemas, bad checksums/hashes, file/directory path
collisions, control paths, `.git` symlinks, and an effective UID different from
the `.git` owner. Worktree traversal never follows a symlink. The 1 MiB
transient Linux reservation is acquired before command work and released in a
`finally`; bounded payload/hash/object buffers are consumed sequentially, and
payload reads and writes go through `ShellCommandRuntime` so the Computer
block-I/O owner remains authoritative.

Remote URLs are inert local metadata today. The remote port is deliberately a
bounded, cancellable state machine with connecting, authenticating, negotiating,
transferring, verifying, and compare-and-swap ref-update phases. Requests carry
protocol/capability offers, a reconciliation ID, and total ceilings; every
`step` also receives a smaller per-tick budget and may return a minimum
guest-tick delay for bounded backoff and peer `Retry-After` handling. A terminal
result is exactly one of complete, failed, cancelled, or unknown. In particular,
lost acknowledgement after a possible non-idempotent update must end as unknown;
the caller reconciles the advertised ref before attempting another update.

Future adapters receive an injected guest repository exchange, guest credential
provider, and guest byte transport. They read content-addressed objects in
bounded chunks; incoming objects enter a guest-backed quarantine whose stepped
verification precedes one transactional promotion and ref CAS. TLS certificates,
SSH host keys, or the CS authenticated-channel peer are verified against guest
trust before credential acquisition. The session is the single finalization
owner for credential handles, object readers, quarantine, and transport leases
on success, failure, cancellation, disconnect, or unknown acknowledgement. No
credential is stored in `.git/config`, and no host helper or socket is
reachable.

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
Computer System Python 1.0 is targeting Python 3.14 syntax and core semantics
under the versioned Python 3.14 CS Profile; the current frontend/runtime remains
a partial subset. The profile contract and feature statuses are maintained in
[`python-compatibility.md`](python-compatibility.md) and
[`python-314-compatibility.json`](python-314-compatibility.json). `pip`,
`ensurepip`, `venv`, PyPI/wheel installation, and the CPython native ABI are
deliberately unavailable.

The direct frontend has instance-scoped limits: 512,000 decoded source code
units, 131,072 tokens, 512 code units per identifier, 65,536 per literal,
delimiter/indentation/block/expression/scope nesting 64, 16,384 statements, 256
parameters and arguments, 4,096 items per construct, 256 formatted-string
expressions, 1,024 scopes, and 4,096 symbols per scope. Limits are checked
before mutation; exact capacity succeeds and capacity plus one returns a located
`LanguageSyntaxError` without an AST or registered module. Scope analysis runs
for every module immediately after parsing and classifies deterministic
global/local/cell/free bindings. Unicode XID identifiers normalize to NFKC for
lookup, while AST spans retain authored locations. The compiler annotates every
name operation with its binding; the runtime creates local cells on function
entry and shares captured/free cells across nested calls. Whole-function local,
`global`, `nonlocal`, unbound-local, retained-closure, and failed-import
rollback semantics have focused runtime evidence. Function descriptors
distinguish all five Python parameter kinds and definition-time defaults. Call
operations retain source-order positional, keyword, iterable-unpack, and
mapping-unpack metadata; the runtime binds them in O(parameters + expanded
arguments), caps default expansion at 4,096 values, and rejects duplicate or
non-string mapping keys. Comparison chains retain one middle value,
short-circuit, and evaluate every operand at most once. Conditional expressions
compile the condition before two patched CS486 branches and leave only the
selected value on the managed stack. `lambda` queues the same compiled function
descriptor as `def`, uses an expression body ending in the existing return
operation, and shares parameter binding, closure cells, call-depth, and heap
ownership. A named expression compiles its RHS, copies the top managed value,
stores one copy through the scope-selected name operation, and leaves the
original as its expression result. Scope analysis records the target as a
whole-function assignment after collecting the RHS, so global/nonlocal
declarations and unbound-local behavior reuse existing rules. An assert compiles
one truthiness check and one patched CS486 success branch; only its failure lane
evaluates an optional message before an allowlisted runtime operation throws
`AssertionError` into the ordinary handler/finalizer path. Ordinary chained
assignment leaves one RHS value on the managed stack and copies it only while
later targets remain; target-side expressions run from left to right after that
RHS. Augmented attribute/subscript assignment retains the evaluated object/index
beneath the current value so it performs one lookup, then the RHS and bounded
binary operation, then one store to the same target. Starred list/tuple displays
carry a per-source-item expansion flag; dictionary display operations carry
pair/mapping-unpack metadata. Runtime expansion checks the collection ceiling
before each new element. Destructuring emits a bounded unpack operation that
pushes target values in reverse stack order so subsequent stores still execute
left to right; a starred remainder is a new accounted list. Slice operations
compile the object plus nullable start/stop/step components onto the same
managed stack. Runtime normalization clips bounded sequence indices, including
arbitrary-precision extremes, and enumerates at most the selected built-in
sequence length. List slice stores evaluate the RHS before target-side
expressions, normalize before inspecting the replacement iterable, copy the
replacement, and preflight extended arity or final capacity before mutation.
Eager list/set/dictionary comprehensions lower to ordinary managed-function
descriptors and the existing CS486 call/return path. The compiler evaluates the
leftmost iterable in the enclosing scope, passes it as the synthetic positional
parameter, and emits later iterables, filters, targets, and results inside the
implicit scope. A comprehension `:=` target resolves to the containing
non-comprehension binding. Set displays and `set()` store insertion-ordered
canonical primitive/tuple keys in a `Map`, so membership, equality, and
duplicate admission are O(1) on average. Canonical-key construction, unique
growth, and the reachable key/value graph remain bounded by the string,
collection, and managed RAM ceilings. Class definitions evaluate their bases
once from left to right in the enclosing frame, then call a compiled class-suite
target with an isolated local namespace and forwarded enclosing cells.
Successful completion constructs a bounded C3 MRO and publishes one
`RuntimeClass`; failure discards that frame and leaves the prior binding
unchanged. A class that owns methods or lambdas referencing `__class__` or
builtin `super` also owns one hidden `RuntimeCell`, separate from the class-body
and outer closure maps. Completion initializes it only after C3 and heap
admission, before `__set_name__`, and the set-name fault owner clears it before
unwinding. C3 construction is bounded to 64 retained entries; ordinary lookup
and super continuation are O(M) in that fixed MRO length. Managed functions,
properties, custom descriptors, and classmethods bind through that same path.
Calling a class resolves `__new__` through the same bounded C3 path. A plain
managed definition is wrapped as an implicit static method before publication,
receives the requested class and original arguments once, and may use strict
`object.__new__(cls)` for bare allocation. The normal CS486 after-call marker
retains the result and constructor arguments: a requested/subclass instance
continues into the returned type's inherited `__init__`, while another value
completes unchanged. `object.__init__` terminates cooperative chains, and every
managed initializer still requires a `None` return. Common name stores preflight
new global/local bindings before publication, including retained bare instances.
Classes, instances, super proxies, hidden cells, bound methods, and their
namespace graphs are accounted through `PythonHeapAccounting`. Decorated
definitions evaluate decorator expressions into the managed value stack before
function defaults or class bases. The raw definition then occupies the argument
position above the innermost decorator, so repeated ordinary
one-positional-argument call operations apply the stack from bottom to top. A
dedicated definition store preflights a new destination name and publishes only
the final value. Failed evaluation, application, class construction, or memory
admission therefore leaves the earlier binding unchanged without a second
evaluator. Built-in `iter` and `next` share the same `RuntimeIterator` cursor
used by `for`, unpacking, starred displays, iterable call expansion, slice
replacement, and `set()`. Iterator identity and current position survive
repeated `iter()` calls; every consuming path advances the cursor once, and only
`next()` converts stable exhaustion to `StopIteration` or its optional default.
Built-in advancement is O(1); full consumption is O(N) over the bounded
remaining values, whose reachable graph stays in `PythonHeapAccounting`. A
function descriptor is marked as a generator only when its directly owned body
or lambda expression contains `yield`; nested function or class suites are
excluded from the outer scan. Calling that descriptor creates a bound but
unstarted `RuntimeGenerator`. `next`, `for`, and `send` issue an ordinary CS486
call to its stored target. `yield` returns after saving the frame, value-stack
suffix, and next target; a later resume restores them and pushes `None` or the
exact sent managed value as the yield-expression result. A non-`None` first send
fails before the created state changes. Return or an escaping fault owns the
single close transition. Created/suspended frame values and a bound `send`
receiver are expanded through the reachable heap graph, so laziness does not
create an unaccounted RAM path or a second scheduler. Integer literals preserve
binary/octal/decimal/hexadecimal values exactly beyond the safe-number range.
Arithmetic, floor/modulo, powers, shifts, and bitwise operations use compact
safe numbers or arbitrary-precision integers under a default 262,144-bit ceiling
(minimum 53). Power/left-shift growth is checked before allocation. Reachable
integer limbs and other managed values are measured by `PythonHeapAccounting`.
The owner scans the value graph only on allocation pressure or an explicit usage
observation, deduplicates shared objects and maps, and reclaims unreachable
values before raising `MemoryError`. It does not acquire RAM itself: the single
`GuestProcessMemoryGrant` already includes the declared managed-runtime
residency in its `GuestRamLedger`-backed physical process lease.

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
