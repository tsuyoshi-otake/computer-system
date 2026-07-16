# CS486 toolchain guidance

## Sandbox and formats

- `as`, `cc`, `c++`, `basicc -c`, `ld`, `nm`, `objdump`, and the debugger remain
  entirely inside the guest sandbox. Never invoke a host compiler, assembler,
  linker, debugger, filesystem, or process.
- New writers emit versioned v2 `CS486OBJ`; readers retain v1 compatibility.
  Objects contain `.text`, `.rodata`, `.data`, and `.bss`, typed symbols,
  initialized data, alignment, and structured relocations. Executables use the
  validated `CS486` representation.
- Neither `CS486OBJ` nor `CS486` is ELF, OMF, native x86, DOS COM, or DOS EXE.
  Do not advertise or accidentally accept those formats.
- Dynamic linking is not implemented. Extend the versioned object/ABI boundary
  rather than dispatching to a host or inventing an unversioned side channel.

## Assembler and frontends

- Assembly flows through the dedicated tokenizer, bounded preprocessor, parser,
  constant-expression evaluator, IR, and source-span diagnostics. Do not restore
  regex rewriting of assembly text.
- Check source, character, token, definition, include, macro, expansion,
  operand, section, symbol, and diagnostic budgets before allocating/appending
  output.
- Includes read through the credentialed guest filesystem using the compiling
  process credentials. Keep cycle/circular include detection bounded.
- Keep Linux and DOS frontend syntax, path, newline, quoting, and diagnostic
  text behind their explicit profile boundary. Do not make DOS accept Linux
  paths or make Linux emit DOS output to share an implementation.
- Restricted statement-boundary inline assembly cannot introduce labels, control
  flow, stack operations, ESP/EBP access, or hidden ABI changes.

## Linker and ABI

- Version 2 symbol metadata exposes zero-argument `()->i32` and `()->void`
  functions; integer results return through EAX. Keep calling convention, stack
  bounds, instruction-zero startup, debugger, object readers, Python extensions,
  tests, and manual synchronized.
- Use Map-backed symbol and local-relocation lookup. Compute section layout
  once; do not rescan all symbols or rewrite text per relocation.
- Reject duplicate, unresolved, type-mismatched, out-of-range, misaligned,
  corrupt, excessive, or RAM-overflowing objects before emitting an executable.
  A failure must never leave a partially installed output file.
- Preserve exact source spans through preprocessing and lowering so diagnostics
  identify the authored file/line rather than a generated buffer offset.

## C/C++ IR and backend

- C/C++ use the dedicated bounded tokenizer/parser with typed AST nodes, lexical
  scopes, declared symbols, and explicit diagnostics. Do not lower by regex or
  reuse shell parsing.
- CSIR is typed single-definition SSA. Validate value type, unique definition,
  use dominance, branch target, block terminator, call signature, and return
  type before optimization and again before code emission.
- Optimization is deterministic and pass-capped. Reject malformed or oversized
  graphs before a pass; never iterate to an unbounded fixed point.
- Register allocation is bounded deterministic linear scan with checked spills.
  Never allocate ESP or EBP. Values live across calls spill according to the
  ABI; locals/spills use checked EBP-relative frames, and frame epilogues
  restore ESP and EBP before `RET`.
- Do not introduce graph-coloring/backtracking allocation or another path with
  input-dependent exponential search. A register/spill/frame overflow terminates
  explicitly before executable installation.

## Debugger

- Debugger state belongs to one validated CS486 process. Bound breakpoints,
  step/continue, register snapshots, read-only memory, disassembly, output, and
  retained state. Do not document watchpoints or expression evaluation until
  those capabilities are actually implemented.
- Pause, continue, process exit, fault, detach, terminal close, and machine stop
  must each finalize explicitly. Debug access must not bypass guest credentials,
  memory bounds, instruction validation, or scheduler admission.

## Verification

Run `npm test -- tests/runtime` for formats/execution and explicitly include
`tests/os/assemblerProfiles.test.ts`, `tests/os/cFamilyProfiles.test.ts`, and
`tests/os/cs486DebuggerProfiles.test.ts` for shell/frontend integration. Cover
v1 read compatibility, v2 round trips, malformed budgets, capacity-plus-one,
unresolved/type mismatch, stack boundaries, credentials, rollback, and
cross-profile diagnostics.
