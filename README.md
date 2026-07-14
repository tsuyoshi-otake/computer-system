# Computer System

Computer System is a ComputerCraft-inspired programmable computer add-on for
Minecraft Bedrock Edition.

The project aims to reproduce the ComputerCraft experience as closely as the
Bedrock Add-On and Script APIs allow. Programs use a sandboxed,
MicroPython-compatible language called Computer System Python, while the
computer lifecycle, terminal, filesystem, events, networking, peripherals,
pocket computers, and turtles follow ComputerCraft-style behavior.

## Status

The Phase 2 Bedrock Computer vertical slice is implemented. The language, VM,
scheduler, computer lifecycle, terminal model, filesystem, persistence, redstone
adapters, pocket computer identity, monitor fallback, and bounded Bedrock probes
are covered by host and Bedrock Dedicated Server verification.

The repository also includes a local stdio MCP companion that can build the
packs, run an isolated BDS instance, execute allowlisted Computer System probes,
return bounded server logs, acquire a computer-scoped one-use Web handoff, and
execute bounded non-TUI shell commands inside an exact `c-xxxxxx` Computer. The
real MCP-to-BDS headless workflow passes with zero diagnostics.

The native in-game terminal remains available as a bounded fallback, but the
preferred interactive experience is now the local Web Terminal companion. Using
a Pocket Computer requests a short-lived browser link and connects the browser
directly to the same fixed-cell terminal model. The Web Terminal provides a
full-width Linux-style screen, inline cursor-positioned input, physical Enter,
selection-aware copy and Ctrl+C, bounded plain-text paste, and command history
without relying on Bedrock's narrow CustomForm container. Interactive commands
use a targeted bounded snapshot path, so their visible response does not wait
for every viewer in the periodic round-robin.

The Web Terminal header also opens a searchable, keyboard-navigable 16-chapter
field manual. It is organized as a learning path rather than a command cheat
sheet: machine orientation and architecture; terminal, Bash, and storage;
MicroPython, its native API, Redstone, and a complete controller exercise;
assembly, BASIC, C/C++, and optimization; then DOS compatibility, diagnostics,
and the limits/glossary appendix. Previous/next controls and arrow keys follow
that publication order.

See [the implementation roadmap](docs/roadmap.md) for the planned compatibility
scope and executable acceptance criteria.

Development setup and Phase 0 evidence are documented in
[the development guide](docs/development.md) and
[the feasibility matrix](docs/feasibility-matrix.md). Player-experience checks
are intentionally isolated in the
[manual verification checklist](docs/manual-verification.md).

## Requirements

- Node.js 24 or later
- Minecraft Bedrock Edition 1.26.30 or later in the 1.26 release line
- The official Bedrock Dedicated Server distribution for BDS verification

The current package baseline uses `@minecraft/server` 2.8.0,
`@minecraft/server-ui` 2.1.0, and `@minecraft/vanilla-data` 1.26.33.

## Quick start

```powershell
npm install
npm run validate
```

`npm run validate` checks formatting, lint, TypeScript types, host tests, and
the production Behavior and Resource Pack build. Build artifacts are written
under `dist/`.

Useful development commands:

```powershell
npm run build
npm run deploy
npm run test:bds
npm run test:bds:disconnect
npm run test:mcp
npm run test:mcp:bds
npm run test:web
npm run dev:bds:web
```

`npm run deploy` updates only this project's development pack directories in the
local Minecraft for Windows GDK creator-content location.

## Bedrock MCP debugging

The Resource Pack is static client content and cannot host an MCP transport.
Instead, the project-scoped [`.codex/config.toml`](.codex/config.toml) registers
the `computer_system_bds` stdio companion implemented by
[`tools/bds-mcp-server.mjs`](tools/bds-mcp-server.mjs).

Set `BDS_HOME` to an extracted official BDS distribution. The tooling treats
that directory as a read-only source and copies it into a managed runtime under
`%USERPROFILE%\tmp\computer-system-bds`; it never recursively deletes
`BDS_HOME`.

```powershell
$env:BDS_HOME = "C:\path\to\bedrock-server"
npm run test:mcp:bds
```

For interactive work, start the MCP-managed server with the debug world
preserved, connect Minecraft to the reported port, and run player-scoped probes
through MCP. On Windows installations where Minecraft rejects `127.0.0.1` with
`InitialConnection-13`, use the machine's active LAN IPv4 address instead. See
[the MCP debugging guide](docs/mcp-debugging.md) for the complete workflow and
safety constraints.

`bds_execute_computer_command` provides a direct debug path for a specific
Computer without using its TUI. It returns stdout, stderr, exit code, and
modeled 486DX CPU cycles from the sandboxed shell; it never invokes host
PowerShell/Bash or arbitrary BDS administration commands.
`bds_wait_for_web_handoff` returns the next one-use URL for one exact Computer
ID while preventing browser auto-open from consuming it first. Both paths bound
input, concurrency, output, and waits. The MCP-only `python <file>` and
`micropython <file>` forms run a bounded source file with the target Computer's
MicroPython-compatible VM, filesystem, hardware profile, and RAM limit. They
reject waits and long-running work. MicroPython bytecode instructions are
reported separately from their deterministic 486DX-equivalent CPU-cycle cost;
`run --stats` uses the same CPU-cycle and 33 MHz virtual-time units.

## Browser terminal

Start the combined BDS and Web Terminal companion, then connect Minecraft to the
reported Minecraft address and port:

```powershell
$env:BDS_HOME = "C:\path\to\bedrock-server"
$env:WEB_COMPANION_AUTO_OPEN = "1"
npm run dev:bds:web
```

With `WEB_COMPANION_AUTO_OPEN=1`, using a Pocket Computer opens its one-use link
in the server machine's default browser. Automatic opening is allowed only when
both the listener and published origin are loopback; it is blocked for LAN and
Internet origins. Browser launch work is serialized, bounded, and attempted once
per handoff. The same link is always printed in Minecraft as a 60-second
fallback when automatic opening is disabled, blocked, or fails. Opening it
exchanges the handoff code for a browser-only bearer token that is never written
to BDS logs. The authenticated session lasts at most 30 minutes. If the
companion does not answer within 10 seconds, the add-on opens the native in-game
terminal instead.

Each browser link is already bound to one Computer; the companion root page does
not accept an arbitrary Computer ID. Newly created Computers use compact IDs in
the form `c-xxxxxx`, where the six-character lowercase Crockford Base32 payload
is also the stable 30-bit value returned by `os.getComputerID()`. Allocation
checks the persisted identity registry and retries collisions up to a fixed
limit before failing explicitly.

Only one browser session can type into a given Computer at a time. The first
session receives control, while additional sessions are labeled `VIEW ONLY`. A
viewer can use **Take control** to atomically demote the previous writer. Input
and interrupts from viewers are rejected by both the companion and Bedrock
bridge, and closing one view does not emit `terminal_closed` while another view
of the same Computer remains active. Different Computers remain independently
writable.

The default Web Terminal listens only on `127.0.0.1:19144`, so it does not need
an additional firewall or router rule when Minecraft and the browser run on the
server machine. For trusted LAN access, expose TCP 19144 explicitly and publish
an address that the client can reach:

```powershell
$env:WEB_COMPANION_HOST = "0.0.0.0"
$env:WEB_COMPANION_PUBLIC_HOST = "192.168.1.10"
npm run dev:bds:web
```

Minecraft/BDS and the Web Terminal use different transports: the managed BDS
defaults to UDP 19142, while the browser companion defaults to TCP 19144. For
Internet access, keep the companion bound to loopback and put an HTTPS reverse
proxy on TCP 443 in front of it:

```powershell
$env:WEB_COMPANION_HOST = "127.0.0.1"
$env:WEB_COMPANION_PUBLIC_ORIGIN = "https://terminal.example.com"
npm run dev:bds:web
```

Do not expose the plain HTTP companion port directly to the Internet. The
reverse proxy should terminate TLS and forward only to `127.0.0.1:19144`.

## Computer System OS shell

Terminal commands execute inside the Computer System sandbox, never in the host
Windows or BDS process. OS 0.3 boots a non-destructive Linux profile with
`/etc`, `/dev`, `/tmp`, `/usr`, `/var`, and `/home/computer`. Existing files are
preserved while `/tmp` is explicitly volatile. A profile boundary separates path
syntax, boot layout, command aliases, environment, and virtual devices. The
implemented DOS profile shares the same VM, terminal, filesystem, persistence,
hardware limits, and CS486 toolchain without Linux conditionals in the domain
core. It provides drive-letter paths, case-insensitive lookup, CRLF boot files,
`NUL`/`CON`, and DOS command aliases including `DIR`, `TYPE`, `COPY`, and `VER`.

```text
files:  pwd cd ls cat mkdir touch rm cp mv find stat df du quota
text:   echo printf head tail wc grep sort uniq tr cut seq
shell:  sh bash source env export unset which type
info:   whoami id hostname uname date uptime cpuinfo free
system: clear edit vi history time sleep test [ shutdown reboot exit true false
toolchain: as cc c++ basic basicc ld nm run objdump
```

The parser supports single and double quotes, backslash escapes, environment
variables, `$?`, pipelines (`|`), input/output redirection (`<`, `>`, `>>`), and
control operators (`&&`, `||`, `;`). Computer System Bash adds shebangs,
positional parameters, conditionals, bounded loops, functions,
`break`/`continue`/`return`, and `source`. It loads `/etc/bash.bashrc` and then
`~/.bashrc` without replacing existing user files. Command length, tokens,
pipeline stages, script depth/lines/iterations, and intermediate output are
limited so shell work cannot become an unbounded server load path. This is a
sandbox implementation and never invokes host Bash.

`vi <path>` uses Normal, Insert, and Command modes and supports bounded cursor
movement, `dd`, `x`, undo, `:w`, `:q`, `:wq`, `:wq!`, `:q!`, and Shift+ZZ.
Python, shell, JSON/TOML tokens are highlighted, and indentation rainbow
backgrounds are on by default. The native terminal remains 51x19; the Web
Terminal negotiates a viewport up to 160x60 from the available screen and
resizes `vi` with it. The browser subtracts terminal padding and fits both rows
and columns, so the terminal surface does not expose an internal scrollbar. The
browser coalesces up to 16 keys per relay, while the BDS boundary rejects
batches above 32 keys. Tab performs bounded command/path completion through the
same writer-authorized relay.

Computer snapshots remain canonical in Bedrock World Dynamic Properties, which
BDS stores in the world's LevelDB. Clean persistence checks compare O(1)
component revisions instead of serializing the whole snapshot. Filesystem child
lookups use a parent index, capacity is cached, and transactional storage keeps
only the current and previous complete generations. SQLite is intentionally not
the BDS source of truth because Bedrock Script API cannot access it directly; a
future non-Bedrock host can add a SQLite repository behind the same boundary.
`quota` reports the enforced capacity, per-file, and entry limits; `du` computes
bounded subtree usage from one filesystem snapshot. `date` defaults to wall UTC,
with `date --game` and `date --virtual` for Minecraft and deterministic VM time.

Each Computer also has a persisted virtual hardware profile. User-facing CPU
information and the execution model identify a Computer System 486DX at 33 MHz.
At 20 server ticks per second, one Computer receives at most 1,650,000 modeled
CPU cycles per tick, while the scheduler retains the same global cap and
round-robin fairness across Computers. Computer System Python bytecodes use a
stable, operation-specific 486DX-equivalent cost; collection and call costs
scale with their input size. Native shell commands and Bash scripts return
bounded CPU-cycle charges, so they cannot bypass the same budget. Snapshots
created with the former 20 kHz default migrate to 33 MHz when restored. The
default 1 MiB RAM limit applies to the VM's aggregate reachable runtime data and
raises `MemoryError` on overflow; unreachable values are reclaimed during
pressure checks. Linux exposes `cpuinfo`, `free`, `/proc/cpuinfo`, and
`/proc/meminfo`. The DOS profile exposes `CPU`, `MEM`, and `SYSTEMINFO`, and
`VER` includes the hardware summary. RAM, persistent disk quota, collection
size, and output bounds are independent limits.

The sandboxed CS486DX toolchain adds real 32-bit `EAX` through `EBP` registers,
checked little-endian linear memory, stack/call control flow, terminal CPU
faults, and instruction-specific cycle costs. `as`, `cc`, `c++`, and `basicc`
compile safe initial language subsets to the same validated textual executable
format. `as`, `cc`, `c++`, and `basicc` accept `-c` to emit a bounded `CS486OBJ`
relocatable object. Objects carry text symbols, text-target relocations, and
object-relative data size; `ld` resolves them into the existing validated
`CS486` executable in O(instructions + symbols + relocations) work. `nm` and
`objdump` inspect both formats. C and C++ support external and defined
zero-argument integer functions plus statement-boundary `asm("...")`; inline
assembly rejects labels, control flow, stack operations, and ESP/EBP access.
`basic` runs BASIC source directly, while `run --stats` reports instructions,
CPU cycles, and virtual microseconds at 33 MHz. No frontend invokes a host
compiler, linker, or native binary. Dynamic/shared libraries remain a follow-up
on the versioned object and ABI foundation. Compile, link, and execution work
return to the same bounded CPU-cycle debt used by shell scripts. MCP's
`cpuCycles` field uses this unit across ASM, C, C++, BASIC, and MicroPython;
bytecode or machine-instruction counts remain diagnostic values, not timing
units.

The Bedrock pack includes placeable `Computer` and `Advanced Computer` items
(`computer_system:computer_item` and `computer_system:advanced_computer_item`).
Placed blocks use internal `computer_system:computer_00..63` or
`computer_system:advanced_computer_00..63` identifiers for their six-face
redstone-output mask. The current display block is `computer_system:monitor`; it
is named Monitor rather than Display.

Examples:

```sh
ls -la /
printf 'alpha\nbeta\nalpha\n' | grep alpha | wc -l
echo 'hello world' > message.txt
cat message.txt | tr a-z A-Z
false || echo recovered
bash -c "find / -name '*.py' | sort"
```

This is an intentionally sandboxed compatibility shell, not a host process
launcher. Unsupported applets return a normal `command not found` status rather
than escaping into PowerShell, `cmd.exe`, or the BDS host.

## Repository layout

- `src/domain/`: Minecraft-independent language, VM, filesystem, terminal, and
  device rules
- `src/application/`: lifecycle, OS, runtime, and service orchestration
- `src/bedrock/`: Minecraft Script API adapters and terminal coordination
- `packs/`: Behavior Pack and Resource Pack source assets
- `tools/`: build, deploy, BDS, probe, and MCP tooling
- `tests/`: host, pack, Bedrock adapter, and tool tests
- `docs/`: roadmap, development notes, evidence, and verification checklists

## Planned platform

- Minecraft Bedrock Edition
- Behavior Pack and Resource Pack
- TypeScript compiled to the Bedrock Script API runtime
- A deterministic, instruction-budgeted Python virtual machine
- Vitest-based host-side unit and compatibility tests

## License

No license has been selected yet. All rights are reserved until a license is
added.
