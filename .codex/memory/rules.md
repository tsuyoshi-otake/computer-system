# Verified project rules

- Structured VM blocks must propagate `return`, `break`, and `continue` through
  `finally` using explicit continuations; tests must observe the final target
  and every executed finalizer.
- A filtered ComputerCraft-style event pull discards queued non-matching events
  before returning the first match.
- Keep host-runtime limits instance-scoped. Built-ins such as `range` must use
  the active VM limits rather than global defaults.
- On Windows, Prettier uses `endOfLine: auto` so repository-wide checks preserve
  existing line endings while still validating content formatting.
- Do not treat generated Bedrock JSON UI structure as runtime evidence. On GDK
  26.33, `CustomForm` collection controls outside the native factory did not
  resolve indexed text, and native label/header templates ignored attempted
  factory remapping. Keep generator tests, but require a client check for
  visible layout, colors, and scrolling.
- A Bedrock custom item's `onUse` needs a built-in use driver. For the Portable
  Computer, Food plus a 0.05-second use modifier makes a click observable while
  the terminal form interrupts consumption; verify on-client that the item stays
  in its slot and keeps its dynamic identity across a world reload.
- `npm run deploy` copies the existing `dist` packs and does not rebuild source.
  After Bedrock script or pack-generator changes, run `npm run build` before
  `npm run deploy`, then restart the GDK client when module or atlas reload is
  required.
- On GDK 26.33, a custom Computer `onPlayerBreak` can be followed by a same-key
  `onPlace` before the block is visibly gone. Keep the physical key under an
  explicit break owner through the next tick, suppress reallocation, remove any
  residual Computer block, then give the identity-bearing item and release the
  guard in `finally`.
- Deferred cleanup must isolate every preparation, finalization, and failure
  reporting step so one exception cannot skip later work or leak ownership. —
  Evidence: deferred-finalization tests inject failures into all three phases
  and observe remaining steps plus guard release.
- GDK 1.26.33 native labels expose foreground formatting but no per-cell
  background API. Render non-default blank backgrounds as block glyphs and keep
  the 16-index formatting-code mapping injective; otherwise distinct terminal
  palette entries silently collapse to the same visible color.
- Relaunch Minecraft for Windows through its registered app ID
  `Microsoft.MinecraftUWP_8wekyb3d8bbwe!Game`. Immediately launching the
  `C:\XboxGames\...\Minecraft.Windows.exe` path after shutdown can be ignored
  even when no process or crash event remains.
- Treat interactive terminal completion and viewport resize as writer-owned
  operations. Validate at HTTP and Bedrock boundaries, serialize per Computer,
  and cap dimensions/candidates so viewers cannot race shared terminal state.
- A script loop budget must be shared across nested blocks and function calls.
  Per-block counters allow multiplicative nested work even when every individual
  loop appears bounded.
- Native operations that perform sandbox work must return bounded VM cycle debt;
  otherwise a low-clock Computer can bypass CPU limits through shell or host
  adapters. Keep aggregate RAM measurement pressure-triggered so the normal
  allocation path stays O(1), and scan only reachable runtime objects when
  reclamation or overflow must be decided.
- Treat nominal guest CPU identity and host-safe execution scale as separate
  concepts. Guest executables must be structurally validated at load, have
  bounded instruction/output/memory paths, and charge measured opcode cycles
  back to the owning VM rather than executing as unmetered native work.
- Reuse an already-booted `ShellSession` when constructing a secondary native
  environment for MCP/debug execution. Constructing another session re-runs the
  OS boot profile and can erase volatile paths such as `/tmp` between a compile
  command and the program that consumes its output. — Evidence: the Computer
  host integration test compiles `/tmp/fastmath.o`, imports it from Python, and
  observes `42` without losing the object during debug-environment creation.
- Keep the guest instruction schema in a stable CPU module below both the
  process and model-specific timing tables. Importing instructions from the
  process into timing creates a reverse dependency when the process selects its
  timing model. — Evidence: the architecture cycle test passes after extracting
  `instructionSet.ts` from `cs486.ts`.
- A hardware capability gate must cover every user-visible entry point: boot
  artifact selection, shell/debug dispatch, and MCP reporting. Keep the flag on
  the CPU specification so one frontend cannot silently re-enable an unavailable
  language. — Evidence: portable CS386SX tests retain C++ execution, ignore a
  user `/startup.py`, and return status 127 for MCP MicroPython.
- DOS compatibility boot must parse bounded files sequentially and surface every
  unsupported `CONFIG.SYS` directive. Store modeled HIMEM/EMM386/DOS-high flags
  in the same session environment consumed by `MEM` so startup, diagnostics, and
  batch execution cannot disagree. — Evidence: DOS profile tests verify the
  conventional/UMB/XMS map, boot variables, explicit warnings, and line/depth
  termination.
- Gate profile-specific interactive commands twice: filter discovery and
  completion in the command runtime, and guard the `ShellSession` TUI intercept
  itself. A runtime-only gate can be bypassed when the session starts an editor
  before dispatch. — Evidence: Linux returns status 127 for `edit` and status 1
  for `which edit`, while DOS opens the bounded full-screen EDIT session and MCP
  rejects it as TUI without retaining editor state.
- Treat a portable item's persistent Computer identity separately from its
  current player session owner. On an owner conflict, inspect only the bounded
  former-owner inventory, reject a true duplicate, and otherwise explicitly
  finalize that Computer's former native and Web sessions before reassignment;
  do not disconnect the player's unrelated Computers. — Evidence: lifecycle and
  Bedrock adapter tests cover duplicate rejection, transfer finalization, and
  scoped session teardown.
- Migrate persisted family hardware only from an exactly recognized former
  default. Standard Desktop, Advanced Desktop, and Portable profiles may evolve,
  but a customized CPU, clock, or RAM value remains authoritative. — Evidence:
  hardware profile tests cover CS486DX 33 MHz/2 MiB, CS486DX2 66 MHz/8 MiB,
  CS386SX 16 MHz/2 MiB, one-time migration, and customized-profile preservation.
- Keep high-resolution isometric machine plates as manual/inventory sources and
  derive purpose-built block geometry, face textures, and terrain-atlas entries
  separately. Stretching one isometric view across cube faces cannot represent a
  placed machine. — Evidence: machine asset tests cover four bounded geometries,
  six 16 px face textures, the terrain atlas, and four transparent item icons;
  the production pack builds with no new BDS diagnostics.
- Resolve hardware-gated terminal access from current physical topology at every
  entry point. A selected Desktop identity is not proof that a Monitor exists;
  require exactly one adjacent Desktop/Monitor connection and terminate missing
  or ambiguous paths explicitly. Portable machines may bypass that gate only as
  an explicit built-in-display capability. — Evidence: Bedrock adapter tests
  cover the Desktop gate, adjacent Monitor resolution, Portable held/placed
  paths, and stationary-redstone exclusion for Portable blocks.
