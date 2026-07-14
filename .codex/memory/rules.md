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
- A Bedrock custom item's `onUse` needs a built-in use driver. For the Pocket
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
