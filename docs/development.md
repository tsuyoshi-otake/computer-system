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
```

`npm run build` creates development Behavior and Resource Packs under `dist/`.
`npm run deploy` replaces only the `computer_system_phase_0` development-pack
directories in the locally installed Bedrock GDK client. The deployment root is
`%APPDATA%\Minecraft Bedrock\users\shared\games\com.mojang`, which is the
current Windows creator-content location following the UWP-to-GDK migration.

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
Set `WEB_COMPANION_AUTO_OPEN=1` for the loopback-only one-action workflow: using
a Pocket Computer opens its newly minted handoff in the host's default browser.
The companion refuses automatic opening when either the listener or published
origin is non-loopback, and the in-game 60-second URL remains the fallback for
every blocked or failed launch.

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

A Computer has one Web Terminal writer lease. The first attached session is the
writer and additional sessions are viewers. Viewer input and interrupts are
rejected by both the HTTP companion and the Bedrock bridge. Input, close, and
**Take control** transitions share one bounded per-Computer operation queue, so
a successful takeover demotes the prior writer before later input can pass.
Closing one view leaves the terminal open; only the final detach emits
`terminal_closed`. Different Computers have independent writer leases.

The Web Terminal and native fallback send `terminal_line`; vi additionally uses
bounded `terminal_keys` batches. Writer-only `web-complete` and `web-resize`
requests provide command/path completion and negotiate a 51x19 through 160x60
Web viewport without changing the native fallback contract. OS 0.3 parses a
bounded Computer System Bash language with pipelines, redirects, control
operators, quoting, variables, positional parameters, conditionals, loops, and
functions. The Linux profile owns `/etc`, `/dev`, volatile `/tmp`, `/usr`,
`/var`, `/home/computer`, identity/time applets, and `/dev/null`. The shared OS
profile boundary owns path dialects, aliases, boot images, and virtual devices;
the DOS contract fixture proves drive paths, case-insensitive names, CRLF,
`DIR`/`TYPE`, and `NUL` without changing Linux semantics. Commands operate only
on `InMemoryFilesystem`; they must never spawn a host shell. Focused
verification is:

```powershell
npx vitest run tests/os tests/editor
```

`Verify:` Run `printf 'alpha\nbeta\nalpha\n' | grep alpha | wc -l > count`
through a `terminal_line` event, then run `cat count`.

`Expect:` `/home/computer/count` contains `      2\n`, the terminal shows `2`,
the runtime returns to explicit unfiltered `waiting_event` ownership for line or
key input, and no host process is created.

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
those limits before commit. `quota` exposes them, while `du` walks one bounded
snapshot rather than performing repeated recursive directory scans.

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
resource lease. The second session recovered the Pocket Computer ItemStack
identity written by the first, including placed-block and block-to-item identity
round trips. The custom item is parsed in the current direct-component format
and is verified as non-stackable before any Dynamic Property is written.

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

After activating both packs in a test world, run:

```text
/scriptevent computer_system:probe status
```

The script should acknowledge the probe in chat. The Dedicated Server console
uses `scriptevent computer_system:probe headless` for the complete automated
suite.

## Headless verification rubric

Virtual hardware is part of the Computer snapshot. Legacy snapshots receive the
33 MHz/1 MiB defaults; snapshots that stored the former 20 kHz default migrate
to 33 MHz. CPU clock is converted to per-tick CPU-cycle credit, then the global
scheduler cap arbitrates mixed-speed Computers in round-robin order. Python-
generated CS486 instructions, managed-runtime syscalls, native calls, and other
CS486 execution all return deterministic cycle debt to the same process. RAM
enforcement scans the live object graph only under allocation pressure, keeping
the common allocation path O(1) while making the uncommon reclamation check O(N)
in reachable objects. Disk quota remains an independent filesystem concern.

CS486DX programs use a separate verified register-machine executable under the
same Computer hardware limits and CPU-cycle budget. The persisted and visible
default clock is 33 MHz. `run --stats` is the deterministic optimization
measurement: compare CPU-cycle totals and virtual microseconds, not host wall
time or language-specific instruction counts. Executables are JSON preceded by
`CS486\n`, validated again at load, and never passed to a host process. Direct
execution is capped at 10,000 instructions per submission and returns exit 124
on a bounded yield.

Relocatable objects are versioned JSON preceded by `CS486OBJ\n`. They contain
normalized assembly, object-relative data size, local/global/undefined text
symbols, and text-target relocations. The static linker prefixes local symbols,
lays out data at four-byte boundaries, resolves globals through a `Map`, and
produces the existing executable format in O(instructions + symbols +
relocations) work. The current ABI supports zero-argument functions returning an
integer in EAX. Inline C/C++ assembly is a statement-boundary escape hatch and
rejects labels, branches, calls, stack operations, and ESP/EBP access. Dynamic
loading remains deliberately unsupported until this ABI has stable field
evidence.

Computer System Python no longer uses a bytecode VM. `pythonCs486.ts` resolves a
bounded module graph, compiles Python control flow to CS486 instructions, and
uses the allowlisted `python` syscall for managed values and native modules.
Same-directory `.py` files and the Linux/DOS Python library paths initialize at
most once. A valid `CS486OBJ` `.o` file can be imported as a static extension;
its global zero-argument functions execute in the caller's CS486 process and
return an integer in EAX. Module discovery and linking are linear in source,
modules, symbols, and relocations; missing, circular, oversized, corrupt, and
ABI-incompatible imports terminate explicitly.

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
